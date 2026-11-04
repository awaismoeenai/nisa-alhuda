/**
 * User Directory — searchable, filterable user list with admin actions.
 * Client component: search, role filter, multi-role assign, reset password,
 * suspend/unsuspend, login-as-user helper.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  User,
  Shield,
  LogIn,
  Ban,
  CheckCircle,
  Loader2,
  Phone,
  Calendar,
  BookOpen,
  Wallet,
  UserCog,
  KeyRound,
  Check,
  Lock,
  LockOpen,
  ShieldOff,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Profile, UserRole } from "@/lib/types/database";
import {
  updateUserRoles,
  resetUserPassword,
  setUserPassword,
  setUserLockOverride,
  setUserSuspended,
} from "./actions";

interface UserDirectoryProps {
  profiles: Profile[];
  enrollmentCounts: Record<string, { total: number; approved: number }>;
  currentUserId: string;
}

const roleConfig: Record<
  UserRole,
  {
    label: string;
    color: string;
    bg: string;
    icon: typeof Shield;
  }
> = {
  admin: { label: "Admin", color: "text-purple-600", bg: "bg-purple-100 dark:bg-purple-950/30", icon: Shield },
  treasurer: { label: "Treasurer", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-950/30", icon: Wallet },
  instructor: { label: "Instructor", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-950/30", icon: BookOpen },
  ta: { label: "Teaching Assistant", color: "text-teal-600", bg: "bg-teal-100 dark:bg-teal-950/30", icon: UserCog },
  student: { label: "Student", color: "text-green-600", bg: "bg-green-100 dark:bg-green-950/30", icon: User },
};

const ROLE_OPTIONS: UserRole[] = ["student", "instructor", "ta", "treasurer", "admin"];

function uniqueRoles(profile: Profile): UserRole[] {
  const set = new Set<UserRole>(profile.roles || []);
  set.add(profile.role);
  return Array.from(set);
}

export function UserDirectory({
  profiles,
  enrollmentCounts,
  currentUserId,
}: UserDirectoryProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginTarget, setLoginTarget] = useState<Profile | null>(null);

  // Multi-role dialog state
  const [roleDialogTarget, setRoleDialogTarget] = useState<Profile | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<UserRole>>(new Set());
  const [selectedPrimary, setSelectedPrimary] = useState<UserRole>("student");
  const [savingRoles, startSavingRoles] = useTransition();

  // Reset-password dialog state
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resettingPwd, startResetPwd] = useTransition();

  // Set-password dialog state
  const [setPwdTarget, setSetPwdTarget] = useState<Profile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [settingPwd, startSetPwd] = useTransition();

  // Lock override dialog state
  const [lockTarget, setLockTarget] = useState<Profile | null>(null);
  const [lockAction, setLockAction] = useState<"lock" | "unlock" | "auto">("lock");
  const [lockNote, setLockNote] = useState("");
  const [settingLock, startSetLock] = useTransition();

  // Filter profiles — match against primary OR any assigned role.
  const filtered = profiles.filter((p) => {
    const matchesSearch =
      search === "" ||
      p.full_name.toLowerCase().includes(search.toLowerCase()) ||
      p.phone?.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase());

    const matchesRole =
      roleFilter === "all" || uniqueRoles(p).includes(roleFilter as UserRole);

    return matchesSearch && matchesRole;
  });

  async function handleToggleSuspend(profile: Profile) {
    const action = profile.is_suspended ? "unsuspend" : "suspend";
    if (
      !confirm(
        `Are you sure you want to ${action} ${profile.full_name}?${
          action === "suspend"
            ? " They will not be able to access the platform."
            : ""
        }`
      )
    )
      return;

    setSuspendingId(profile.id);
    try {
      // Server action, not the browser client: `is_suspended` is no longer
      // writable by a signed-in session (migration 049, card #63).
      const res = await setUserSuspended(profile.id, !profile.is_suspended);
      if (!res.success) throw new Error(res.error);
      toast.success(
        profile.is_suspended
          ? `${profile.full_name} has been unsuspended.`
          : `${profile.full_name} has been suspended.`
      );
      router.refresh();
    } catch {
      toast.error(`Failed to ${action} user.`);
    } finally {
      setSuspendingId(null);
    }
  }

  function openRoleDialog(profile: Profile) {
    setRoleDialogTarget(profile);
    setSelectedRoles(new Set(uniqueRoles(profile)));
    setSelectedPrimary(profile.role);
  }

  function toggleRole(role: UserRole) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        // Don't allow removing the primary role — user must change primary first.
        if (role === selectedPrimary) return prev;
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  }

  function handlePrimaryChange(role: UserRole) {
    setSelectedPrimary(role);
    // Primary must be in the set.
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      next.add(role);
      return next;
    });
  }

  function confirmRoleChange() {
    if (!roleDialogTarget) return;
    const rolesArr = Array.from(selectedRoles);
    if (rolesArr.length === 0) {
      toast.error("Select at least one role.");
      return;
    }
    if (!rolesArr.includes(selectedPrimary)) rolesArr.push(selectedPrimary);

    startSavingRoles(async () => {
      const res = await updateUserRoles(
        roleDialogTarget.id,
        selectedPrimary,
        rolesArr
      );
      if (!res.success) {
        toast.error(res.error || "Failed to update roles.");
        return;
      }
      const roleLabels = rolesArr
        .map((r) => roleConfig[r]?.label || r)
        .join(", ");
      toast.success(
        `${roleDialogTarget.full_name}: ${roleLabels} (primary: ${
          roleConfig[selectedPrimary]?.label
        })`
      );
      setRoleDialogTarget(null);
      router.refresh();
    });
  }

  function openResetDialog(profile: Profile) {
    setResetTarget(profile);
  }

  function confirmResetPassword() {
    if (!resetTarget) return;
    startResetPwd(async () => {
      const res = await resetUserPassword(resetTarget.id);
      if (!res.success) {
        toast.error(res.error || "Failed to send reset link.");
        return;
      }
      toast.success(
        `Password reset link sent to ${resetTarget.full_name}. Check their email.`
      );
      setResetTarget(null);
    });
  }

  function openSetPwdDialog(profile: Profile) {
    setSetPwdTarget(profile);
    setNewPassword(generatePassword());
    setShowPassword(true);
  }

  /**
   * Generate a human-shareable 12-char password with mixed case + digits.
   * Avoids ambiguous chars (0/O, 1/l/I) so admins dictating it over a call
   * don't hit support issues.
   */
  function generatePassword(): string {
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let out = "";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }

  function confirmSetPassword() {
    if (!setPwdTarget) return;
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    startSetPwd(async () => {
      const res = await setUserPassword(setPwdTarget.id, newPassword);
      if (!res.success) {
        toast.error(res.error || "Failed to set password.");
        return;
      }
      toast.success(
        `Password set for ${setPwdTarget.full_name}. Share it with them securely.`
      );
      setSetPwdTarget(null);
      setNewPassword("");
      setShowPassword(false);
    });
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(newPassword);
      toast.success("Password copied to clipboard.");
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  }

  function openLockDialog(profile: Profile, action: "lock" | "unlock" | "auto") {
    setLockTarget(profile);
    setLockAction(action);
    setLockNote("");
  }

  function confirmLockOverride() {
    if (!lockTarget) return;
    const override =
      lockAction === "lock" ? true : lockAction === "unlock" ? false : null;
    startSetLock(async () => {
      const res = await setUserLockOverride(lockTarget.id, override, lockNote || undefined);
      if (!res.success) {
        toast.error(res.error || "Failed to update lock override.");
        return;
      }
      const label =
        override === true
          ? `${lockTarget.full_name} has been manually locked.`
          : override === false
          ? `${lockTarget.full_name} is now force-unlocked.`
          : `${lockTarget.full_name} reset to automatic mode.`;
      toast.success(label);
      setLockTarget(null);
      router.refresh();
    });
  }

  function handleLoginAs(profile: Profile) {
    setLoginTarget(profile);
    setShowLoginDialog(true);
  }

  async function confirmLoginAs() {
    if (!loginTarget) return;
    setShowLoginDialog(false);
    try {
      await navigator.clipboard.writeText(loginTarget.id);
      toast.success(
        "User ID copied. Use Supabase Dashboard → Auth → Users to impersonate."
      );
    } catch {
      toast.info("User ID: " + loginTarget.id);
    }
  }

  return (
    <div>
      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {["all", "student", "instructor", "treasurer", "admin"].map(
            (role) => (
              <Button
                key={role}
                variant={roleFilter === role ? "default" : "outline"}
                size="sm"
                onClick={() => setRoleFilter(role)}
                className="capitalize"
              >
                {role === "all" ? "All" : role}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground mb-4">
        Showing {filtered.length} of {profiles.length} users
      </p>

      {/* User list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No users match your search.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((profile) => {
            const primaryCfg = roleConfig[profile.role] || roleConfig.student;
            const RoleIcon = primaryCfg.icon;
            const enrollInfo = enrollmentCounts[profile.id];
            const isCurrentUser = profile.id === currentUserId;
            const allRoles = uniqueRoles(profile);
            const additionalRoles = allRoles.filter((r) => r !== profile.role);

            return (
              <Card
                key={profile.id}
                className={
                  profile.is_suspended ? "opacity-60 border-red-200" : ""
                }
              >
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Avatar */}
                    <div
                      className={`h-10 w-10 rounded-full ${primaryCfg.bg} flex items-center justify-center shrink-0`}
                    >
                      <RoleIcon className={`h-4 w-4 ${primaryCfg.color}`} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <h3 className="font-semibold truncate">
                          {profile.full_name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={`text-xs ${primaryCfg.color}`}
                          title="Primary role"
                        >
                          {primaryCfg.label}
                        </Badge>
                        {additionalRoles.map((r) => {
                          const cfg = roleConfig[r];
                          return (
                            <Badge
                              key={r}
                              variant="secondary"
                              className={`text-xs ${cfg.color}`}
                              title="Additional role"
                            >
                              + {cfg.label}
                            </Badge>
                          );
                        })}
                        {profile.is_suspended && (
                          <Badge variant="destructive" className="text-xs">
                            Suspended
                          </Badge>
                        )}
                        {profile.lock_override === true && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <Lock className="h-3 w-3" />
                            Admin Locked
                          </Badge>
                        )}
                        {profile.lock_override === false && (
                          <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-300">
                            <LockOpen className="h-3 w-3" />
                            Force Unlocked
                          </Badge>
                        )}
                        {isCurrentUser && (
                          <Badge variant="outline" className="text-xs">
                            You
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {profile.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {profile.phone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Joined{" "}
                          {new Date(profile.created_at).toLocaleDateString(
                            "en-PK",
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </span>
                        {enrollInfo && (
                          <span className="flex items-center gap-1">
                            <BookOpen className="h-3 w-3" />
                            {enrollInfo.approved} enrolled
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {!isCurrentUser && (
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Reset Password */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openResetDialog(profile)}
                          title="Send password reset email"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>

                        {/* Set password directly */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openSetPwdDialog(profile)}
                          title="Set password directly (no email)"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </Button>

                        {/* Change Roles */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openRoleDialog(profile)}
                          title="Edit roles"
                        >
                          <UserCog className="h-3.5 w-3.5" />
                        </Button>

                        {/* Login As */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleLoginAs(profile)}
                          title="Login as this user"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                        </Button>

                        {/* Suspend / Unsuspend */}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleToggleSuspend(profile)}
                          disabled={suspendingId === profile.id}
                          title={
                            profile.is_suspended
                              ? "Unsuspend user"
                              : "Suspend user"
                          }
                          className={
                            profile.is_suspended
                              ? "text-green-600 hover:text-green-700"
                              : "text-muted-foreground hover:text-destructive"
                          }
                        >
                          {suspendingId === profile.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : profile.is_suspended ? (
                            <CheckCircle className="h-3.5 w-3.5" />
                          ) : (
                            <Ban className="h-3.5 w-3.5" />
                          )}
                        </Button>

                        {/* Manual Lock Override */}
                        {profile.role === "student" && (
                          profile.lock_override === true ? (
                            // Currently force-locked → offer unlock or reset to auto
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openLockDialog(profile, "unlock")}
                              title="Force-unlock portal (override fee block)"
                              className="text-amber-600 hover:text-emerald-600"
                            >
                              <LockOpen className="h-3.5 w-3.5" />
                            </Button>
                          ) : profile.lock_override === false ? (
                            // Currently force-unlocked → offer lock or reset
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openLockDialog(profile, "lock")}
                              title="Remove force-unlock (revert to auto or lock)"
                              className="text-emerald-600 hover:text-amber-600"
                            >
                              <ShieldOff className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            // No override → offer manual lock
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openLockDialog(profile, "lock")}
                              title="Manually lock portal access"
                              className="text-muted-foreground hover:text-amber-600"
                            >
                              <Lock className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Multi-Role Dialog */}
      <Dialog
        open={!!roleDialogTarget}
        onOpenChange={(open) => !open && !savingRoles && setRoleDialogTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Edit roles for {roleDialogTarget?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              Tick every role this user should hold. Click{" "}
              <strong>Make primary</strong> on the row that should decide which
              dashboard they land on after login — other ticked roles simply
              grant extra feature access.
            </p>

            <div className="space-y-2">
              {ROLE_OPTIONS.map((r) => {
                const cfg = roleConfig[r];
                const RoleIcon = cfg.icon;
                const isChecked = selectedRoles.has(r);
                const isPrimary = selectedPrimary === r;
                return (
                  <div
                    key={r}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                      isChecked
                        ? "border-primary/40 bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleRole(r)}
                      disabled={isPrimary}
                      className="h-4 w-4 rounded border-input accent-primary cursor-pointer disabled:cursor-not-allowed"
                      title={
                        isPrimary
                          ? "Primary role can't be removed — change primary first."
                          : ""
                      }
                    />
                    <div
                      className={`h-8 w-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}
                    >
                      <RoleIcon className={`h-4 w-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{cfg.label}</p>
                    </div>
                    {isPrimary ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                        title="This is the user's primary role — they land here after login."
                      >
                        <Check className="h-3 w-3" />
                        Primary
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePrimaryChange(r)}
                        className="inline-flex items-center rounded-full border border-input px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                        title="Make this the user's primary role."
                      >
                        Make primary
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="outline"
                onClick={() => setRoleDialogTarget(null)}
                disabled={savingRoles}
              >
                Cancel
              </Button>
              <Button onClick={confirmRoleChange} disabled={savingRoles}>
                {savingRoles && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save roles
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && !resettingPwd && setResetTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send password reset email</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              A secure one-time link will be emailed to{" "}
              <strong>{resetTarget?.full_name}</strong>. They can use it to set
              a new password. The link expires after one use or 24 hours.
            </p>
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 inline mr-1.5 align-text-bottom" />
              The email comes from <code>noreply@nisaalhuda.org</code>. Ask the
              user to check their spam folder if it doesn't land in Inbox.
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setResetTarget(null)}
                disabled={resettingPwd}
              >
                Cancel
              </Button>
              <Button onClick={confirmResetPassword} disabled={resettingPwd}>
                {resettingPwd && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <KeyRound className="h-4 w-4 mr-2" />
                Send reset email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set Password Dialog */}
      <Dialog
        open={!!setPwdTarget}
        onOpenChange={(open) => {
          if (!open && !settingPwd) {
            setSetPwdTarget(null);
            setNewPassword("");
            setShowPassword(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set password for {setPwdTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              Sets the password immediately — no email. Useful when the user
              can&apos;t access email or you want to share a default password
              manually. The user will still be able to change it from their
              own settings after logging in.
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="new-pwd">
                New password
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="new-pwd"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    className="pr-10 font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={showPassword ? "Hide" : "Show"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyPassword}
                  title="Copy password"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewPassword(generatePassword())}
                  title="Regenerate"
                >
                  Regenerate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A random 12-character password is pre-filled. Edit it, copy it,
                or regenerate — then click Save.
              </p>
            </div>

            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
              Share the password over a secure channel (not email). The user is
              flagged to change it on next login.
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSetPwdTarget(null);
                  setNewPassword("");
                  setShowPassword(false);
                }}
                disabled={settingPwd}
              >
                Cancel
              </Button>
              <Button onClick={confirmSetPassword} disabled={settingPwd}>
                {settingPwd && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <Lock className="h-4 w-4 mr-2" />
                Save password
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lock Override Dialog */}
      <Dialog
        open={!!lockTarget}
        onOpenChange={(open) => !open && !settingLock && setLockTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {lockAction === "lock"
                ? `Lock portal for ${lockTarget?.full_name}`
                : lockAction === "unlock"
                ? `Force-unlock portal for ${lockTarget?.full_name}`
                : `Clear lock override for ${lockTarget?.full_name}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {lockAction === "lock" && (
              <>
                <p className="text-sm text-muted-foreground">
                  This will block{" "}
                  <strong>{lockTarget?.full_name}</strong>&apos;s portal access
                  immediately, even if her fees are up to date. She will see
                  an &ldquo;Access Restricted&rdquo; screen until you unlock
                  her or clear this override.
                </p>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="lock-note">
                    Reason / note <span className="text-muted-foreground font-normal">(shown to student, optional)</span>
                  </label>
                  <Input
                    id="lock-note"
                    value={lockNote}
                    onChange={(e) => setLockNote(e.target.value)}
                    placeholder="e.g. Pending document review"
                  />
                </div>
              </>
            )}
            {lockAction === "unlock" && (
              <p className="text-sm text-muted-foreground">
                This will force-unlock{" "}
                <strong>{lockTarget?.full_name}</strong>&apos;s portal,
                bypassing the automatic fee-block entirely. She will have
                full access regardless of payment status.
              </p>
            )}
            {lockAction === "auto" && (
              <p className="text-sm text-muted-foreground">
                This clears any manual override and returns{" "}
                <strong>{lockTarget?.full_name}</strong> to automatic mode —
                the fee-block logic will decide her access going forward.
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setLockTarget(null)}
                disabled={settingLock}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmLockOverride}
                disabled={settingLock}
                variant={lockAction === "lock" ? "destructive" : "default"}
              >
                {settingLock && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {lockAction === "lock" ? (
                  <><Lock className="h-4 w-4 mr-2" />Lock portal</>
                ) : lockAction === "unlock" ? (
                  <><LockOpen className="h-4 w-4 mr-2" />Force unlock
                  </>
                ) : (
                  "Clear override"
                )}
              </Button>
            </div>

            {/* If already overridden, also offer the reset-to-auto option */}
            {lockTarget?.lock_override !== null && lockTarget?.lock_override !== undefined && (
              <p className="text-center text-xs text-muted-foreground">
                Or{" "}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setLockAction("auto")}
                >
                  clear override (revert to auto)
                </button>
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Login As Dialog */}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Login as {loginTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              This copies the user&apos;s ID to your clipboard. Use the Supabase
              Dashboard (Auth → Users) to generate a magic link for this user
              to troubleshoot their account.
            </p>
            <div className="p-3 rounded-lg bg-muted text-sm font-mono break-all">
              {loginTarget?.id}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowLoginDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={confirmLoginAs}>
                <LogIn className="h-4 w-4 mr-2" />
                Copy ID & Instructions
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
