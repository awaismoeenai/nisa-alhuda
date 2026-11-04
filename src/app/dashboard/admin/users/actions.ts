"use server";

/**
 * Admin Users Actions.
 *
 * Server actions for user management: multi-role assignment and password
 * reset. Kept on the server because:
 *   - Role writes need admin-client privileges to bypass RLS cleanly.
 *   - Password reset uses `admin.auth.admin.generateLink()` which only
 *     works with the service_role key.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/db/auth";
import { logAudit } from "@/lib/db/audit";
import { sendCredentialsEmail } from "@/lib/email";
import type { UserRole } from "@/lib/types/database";

const ALL_ROLES: readonly UserRole[] = [
  "student",
  "instructor",
  "ta",
  "treasurer",
  "admin",
] as const;


function isValidRole(r: string): r is UserRole {
  return (ALL_ROLES as readonly string[]).includes(r);
}

export interface UpdateUserRolesResult {
  success: boolean;
  error?: string;
}

/**
 * Replace a user's roles. `primaryRole` must be one of `roles` (it drives
 * which dashboard the user lands on after login). The DB trigger enforces
 * that primary is always present in roles[] — but we assert here too so
 * the UI gets a clean error instead of a cryptic constraint failure.
 */
export async function updateUserRoles(
  targetUserId: string,
  primaryRole: string,
  roles: string[]
): Promise<UpdateUserRolesResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!targetUserId) return { success: false, error: "Missing user id." };
  if (targetUserId === auth.userId) {
    return {
      success: false,
      error: "You cannot change your own roles — ask another admin.",
    };
  }

  if (!isValidRole(primaryRole)) {
    return { success: false, error: `Invalid primary role: ${primaryRole}.` };
  }

  // Dedupe + validate the full set.
  const uniqueRoles = Array.from(new Set(roles));
  for (const r of uniqueRoles) {
    if (!isValidRole(r)) {
      return { success: false, error: `Invalid role: ${r}.` };
    }
  }
  if (!uniqueRoles.includes(primaryRole)) {
    uniqueRoles.push(primaryRole);
  }
  if (uniqueRoles.length === 0) {
    return { success: false, error: "At least one role is required." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: primaryRole, roles: uniqueRoles })
    .eq("id", targetUserId);

  if (error) {
    console.error("[updateUserRoles] DB error:", error);
    return { success: false, error: error.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "user.roles_updated",
    entityType: "profile",
    entityId: targetUserId,
    summary: `Set roles to ${uniqueRoles.join(", ")} (primary: ${primaryRole})`,
    metadata: { primaryRole, roles: uniqueRoles },
  });

  return { success: true };
}

export interface ResetUserPasswordResult {
  success: boolean;
  error?: string;
  /** True if we sent a fresh-account "invite" link; false if it was a password recovery. */
  isInvite?: boolean;
}

/**
 * Issue a password reset (or account-setup invite for guests) to any
 * registered user by id. The user receives a branded email with a single
 * magic link that lands on /reset-password.
 */
export async function resetUserPassword(
  targetUserId: string
): Promise<ResetUserPasswordResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!targetUserId) return { success: false, error: "Missing user id." };

  const admin = createAdminClient();

  // Look up the user's email + display name.
  const { data: authUser, error: authErr } =
    await admin.auth.admin.getUserById(targetUserId);
  if (authErr || !authUser?.user?.email) {
    return {
      success: false,
      error: authErr?.message || "User has no email on file.",
    };
  }
  const email = authUser.user.email;

  const { data: prof } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", targetUserId)
    .single();
  const name = prof?.full_name || "";

  // Admin-initiated resets always send a `recovery` link because the account
  // already exists (invites are for never-logged-in guests, covered by the
  // Credentials feature).
  // Route through /auth/callback so the PKCE code is exchanged for a
  // session BEFORE the user lands on /reset-password — otherwise the form
  // can't actually call updateUser({password}). This mirrors the
  // user-initiated /forgot-password flow.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://www.nisaalhuda.org";
  const redirectTo = `${siteUrl}/auth/callback?next=/reset-password`;

  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

  if (linkErr || !linkData?.properties?.action_link) {
    return {
      success: false,
      error: linkErr?.message || "Failed to generate reset link.",
    };
  }

  const emailResult = await sendCredentialsEmail(
    email,
    name,
    linkData.properties.action_link,
    false,
    undefined
  );
  if (!emailResult.ok) {
    return { success: false, error: emailResult.error };
  }

  await logAudit({
    actorId: auth.userId,
    action: "user.password_reset_sent",
    entityType: "profile",
    entityId: targetUserId,
    summary: `Sent a password-reset link to ${email}`,
    metadata: { email },
  });

  return { success: true, isInvite: false };
}

export interface SetUserPasswordResult {
  success: boolean;
  error?: string;
  /** Email of the affected user — useful so the UI can remind the admin what to share. */
  email?: string;
}

/**
 * Directly set a user's password. Admin-only.
 *
 * Unlike `resetUserPassword` (which emails a magic link), this overwrites the
 * password immediately and flags `must_change_password = true` on the profile
 * so the student is nudged to change it after first login. Useful for:
 *   - students with no email access
 *   - sharing a default/temp password verbally or over WhatsApp
 *   - quick internal testing
 */
export async function setUserPassword(
  targetUserId: string,
  newPassword: string
): Promise<SetUserPasswordResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!targetUserId) return { success: false, error: "Missing user id." };
  if (!newPassword || newPassword.length < 8) {
    return {
      success: false,
      error: "Password must be at least 8 characters.",
    };
  }

  const admin = createAdminClient();

  const { data: authUser, error: getErr } =
    await admin.auth.admin.getUserById(targetUserId);
  if (getErr || !authUser?.user) {
    return {
      success: false,
      error: getErr?.message || "User not found.",
    };
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(
    targetUserId,
    { password: newPassword }
  );
  if (updErr) {
    console.error("[setUserPassword] updateUserById error:", updErr);
    return { success: false, error: updErr.message };
  }

  // Flag the profile so a future "force change on login" gate has the signal
  // to act on. Non-fatal if it fails — the password change already landed.
  await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", targetUserId);

  await logAudit({
    actorId: auth.userId,
    action: "user.password_set",
    entityType: "profile",
    entityId: targetUserId,
    summary: `Directly set a new password for ${authUser.user.email || "a user"}`,
    metadata: { email: authUser.user.email || null },
  });

  return { success: true, email: authUser.user.email || undefined };
}

export interface SetUserLockOverrideResult {
  success: boolean;
  error?: string;
}

/**
 * Admin manual lock/unlock override.
 *
 * Sets `lock_override` on the target student's profile:
 *   true  → force-lock (blocks portal even if they've paid)
 *   false → force-unlock (bypasses auto payment-block)
 *   null  → clear override, revert to automatic behaviour
 *
 * Note is stored as `lock_override_note` and is shown on the
 * student's blocked screen when override=true.
 */
export async function setUserLockOverride(
  targetUserId: string,
  override: boolean | null,
  note?: string
): Promise<SetUserLockOverrideResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!targetUserId) return { success: false, error: "Missing user id." };
  if (targetUserId === auth.userId) {
    return {
      success: false,
      error: "You cannot change your own lock override.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      lock_override: override,
      lock_override_note: override === true ? (note ?? null) : null,
      lock_override_at: new Date().toISOString(),
      lock_override_by: auth.userId,
    })
    .eq("id", targetUserId);

  if (error) {
    console.error("[setUserLockOverride] DB error:", error);
    return { success: false, error: error.message };
  }

  const actionLabel =
    override === true ? "force-locked" : override === false ? "force-unlocked" : "override cleared (auto)";

  await logAudit({
    actorId: auth.userId,
    action: "user.lock_override_set",
    entityType: "profile",
    entityId: targetUserId,
    summary: `Portal access ${actionLabel}${note ? `: ${note}` : ""}`,
    metadata: { override, note: note ?? null },
  });

  return { success: true };
}


export interface SetUserSuspendedResult {
  success: boolean;
  error?: string;
}

/**
 * Suspend or unsuspend a sister. Admin only.
 *
 * This used to be written straight from the browser with the signed-in
 * user's own session. That worked because the "Staff can update any
 * profile" RLS policy is row-scoped, which also meant any signed-in user
 * could clear her OWN `is_suspended` flag (card #63). Migration 049 takes
 * `is_suspended` out of the UPDATE grant for `authenticated`, so the write
 * belongs here: role checked on the server, service-role client, audited.
 */
export async function setUserSuspended(
  targetUserId: string,
  suspended: boolean
): Promise<SetUserSuspendedResult> {
  const auth = await requireRole(["admin"]);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!targetUserId) return { success: false, error: "Missing user id." };
  if (typeof suspended !== "boolean") {
    return { success: false, error: "Missing suspension state." };
  }
  if (targetUserId === auth.userId) {
    return {
      success: false,
      error: "You cannot suspend yourself — ask another admin.",
    };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", targetUserId)
    .single();
  if (!target) return { success: false, error: "User not found." };

  const { error } = await admin
    .from("profiles")
    .update({ is_suspended: suspended })
    .eq("id", targetUserId);

  if (error) {
    console.error("[setUserSuspended] DB error:", error);
    return { success: false, error: error.message };
  }

  await logAudit({
    actorId: auth.userId,
    action: "user.suspension_set",
    entityType: "profile",
    entityId: targetUserId,
    summary: `${suspended ? "Suspended" : "Unsuspended"} ${target.full_name || "a sister"}`,
    metadata: { suspended },
  });

  return { success: true };
}
