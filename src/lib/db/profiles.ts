/**
 * Centralised profile query functions.
 *
 * All profile reads/writes go through here so the field selection and
 * error handling are consistent across the codebase.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile, UserRole } from "@/lib/types/database";
import { PROFILE_SELECT, PROFILE_SELECT_ADMIN } from "./profile-columns";

/**
 * The three column lists live in `./profile-columns`, which imports
 * nothing, so a test can read them without booting a Supabase client.
 * They are re-exported here because this is where the rest of the code
 * already imports them from.
 *
 * `select("*")` on profiles does not work from a user-scoped client: the
 * lock_override columns are revoked from anon/authenticated, and `*`
 * expands to every column including those. Always use one of these.
 *
 * `PROFILE_SELECT` is the SIGNED-IN list, and migration 050 means a
 * visitor may not read it. Anything an anonymous caller can reach must
 * use `PROFILE_SELECT_PUBLIC`.
 */
export {
  PROFILE_SELECT,
  PROFILE_SELECT_ADMIN,
  PROFILE_SELECT_PUBLIC,
} from "./profile-columns";

/** Fetch the caller's own profile. Returns null if not authenticated or not found. */
export async function getOwnProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .single<Profile>();

  return data ?? null;
}

/** Fetch any profile by user ID (service role — bypasses RLS). Returns null if not found. */
export async function getProfileById(userId: string): Promise<Profile | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select(PROFILE_SELECT_ADMIN)
    .eq("id", userId)
    .single<Profile>();

  return data ?? null;
}

/** Fetch all profiles with a given role (service role). */
export async function getProfilesByRole(role: UserRole): Promise<Profile[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select(PROFILE_SELECT_ADMIN)
    .eq("role", role)
    .order("full_name");

  return data ?? [];
}

/** Update mutable profile fields for the caller's own profile. */
export async function updateOwnProfile(
  patch: Partial<Pick<Profile, "full_name" | "phone" | "avatar_url">>
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);

  return error ? { success: false, error: error.message } : { success: true };
}

/** Clear the must_change_password flag for the caller (service role not needed — own profile). */
export async function clearMustChangePassword(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", userId);

  return error ? { success: false, error: error.message } : { success: true };
}

/** Suspend or unsuspend a user (admin only — call after role check). */
export async function setUserSuspension(
  userId: string,
  suspended: boolean
): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_suspended: suspended })
    .eq("id", userId);

  return error ? { success: false, error: error.message } : { success: true };
}
