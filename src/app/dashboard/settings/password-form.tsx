/**
 * Password Form — change password with current + new password confirmation.
 */
"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { changeOwnPassword } from "./actions";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-rules";

export function PasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleChangePassword() {
    const invalid = validateNewPassword(newPassword);
    if (invalid) {
      toast.error(invalid);
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      // One server action sets the password AND clears the
      // must_change_password gate. The gate is no longer something the
      // browser can clear on its own (card #63, migration 051).
      const res = await changeOwnPassword(newPassword);
      if (!res.success) throw new Error(res.error);

      toast.success("Password updated successfully!");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to change password."
      );
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        {/* New Password */}
        <div className="space-y-2">
          <Label>New Password</Label>
          <PasswordInput
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
          />
        </div>

        {/* Confirm Password */}
        <div className="space-y-2">
          <Label>Confirm New Password</Label>
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
          />
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          )}
        </div>

        {/* Submit */}
        <div className="pt-2">
          <Button
            onClick={handleChangePassword}
            disabled={saving || !canSubmit}
            className="press"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Lock className="h-4 w-4 mr-2" />
            )}
            Update Password
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
