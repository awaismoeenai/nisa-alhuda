/**
 * The rule for a new password, in one place so the browser and the server
 * agree about it.
 *
 * A `"use server"` module may only export async functions, so the constant
 * and the check cannot live next to the server action that enforces them.
 * They live here, as a pure function with no Supabase import, which also
 * means they can be unit-tested without a database.
 */

/**
 * What the settings screen has always asked for. (The reset-password
 * screen asks for 8; that inconsistency predates card #63 and is left
 * alone deliberately rather than changed in a security fix.)
 */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Returns the message to show, or null when the password is acceptable.
 * Called in the browser for the inline hint and again on the server, which
 * is the one that counts.
 */
export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Please enter a new password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
