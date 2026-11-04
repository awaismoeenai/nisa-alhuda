/**
 * The column lists the app may ask `profiles` for, by caller.
 *
 * These live in their own module, with no imports, so a test can read them
 * without pulling in `@/lib/supabase/server` (which reaches for
 * `next/headers`) or the service-role client. `src/lib/db/profiles.ts`
 * re-exports all three, so existing imports keep working.
 *
 * Each list mirrors a column GRANT in the migrations exactly. RLS is
 * row-level and cannot hide a column, so the grant is the only thing
 * standing between a column and whoever holds the key:
 *
 *   migration 046 — narrowed SELECT on `profiles` to a column list
 *   migration 050 — took `phone`, `is_suspended` and
 *                   `must_change_password` off that list for `anon`
 *
 * Ask for a column your role was not granted and PostgREST refuses the
 * WHOLE request with 401 / SQLSTATE 42501 — not the row, not the column,
 * the request. That is why the public pages need their own list.
 */

/**
 * What an unsigned visitor may read: the catalogue columns and nothing
 * else. Use this on every page under `src/app/(public)/`, and anywhere
 * else a logged-out caller can reach — including inside an embedded
 * resource (`instructor:profiles!fk(...)`), which is subject to the same
 * grant as a top-level select.
 */
export const PROFILE_SELECT_PUBLIC =
  "id, full_name, avatar_url, role, roles, created_at, updated_at";

/**
 * What a signed-in caller may read. The three private columns are still
 * here because the admin payment screens read `phone` through a
 * user-scoped session; narrowing this list means moving those reads to
 * the service-role client first.
 */
export const PROFILE_SELECT =
  "id, full_name, avatar_url, role, roles, phone, is_suspended, must_change_password, created_at, updated_at";

/**
 * The above plus the admin lock-override columns. ONLY valid on a
 * service-role (admin) client — a user-scoped query with these columns is
 * rejected by the column grant.
 */
export const PROFILE_SELECT_ADMIN =
  "id, full_name, avatar_url, role, roles, phone, is_suspended, must_change_password, created_at, updated_at, lock_override, lock_override_note, lock_override_at, lock_override_by";
