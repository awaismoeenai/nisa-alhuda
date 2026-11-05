"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNewPassword } from "@/lib/password-rules";

export interface ChangeOwnPasswordResult {
  success: boolean;
  error?: string;
}

/**
 * Set the caller's own password, and only then clear her
 * `must_change_password` flag.
 *
 * This used to be two steps: the browser called
 * `supabase.auth.updateUser({ password })` and then asked the server to
 * clear the flag on its own. Card #63 showed why that is wrong — clearing
 * the flag was a write a sister could make at any time, with or without a
 * new password, because the UPDATE policy on `profiles` is row-scoped and
 * the UPDATE grant covered every column. Migration 051 takes
 * `must_change_password` out of that grant, so the flag now moves only
 * here, and only after the password has actually changed.
 *
 * The password itself is set through the caller's OWN session, so this
 * can never touch another sister's account. The flag is cleared with the
 * service-role client, scoped to `user.id` from that same session.
 */
export async function changeOwnPassword(
  newPassword: string
): Promise<ChangeOwnPasswordResult> {
  const invalid = validateNewPassword(newPassword);
  if (invalid) return { success: false, error: invalid };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated." };

  const { error: pwError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (pwError) return { success: false, error: pwError.message };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);

  return error
    ? { success: false, error: error.message }
    : { success: true };
}
