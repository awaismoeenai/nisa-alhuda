-- ============================================================
-- Migration 051: a sister may edit her own details, not her own powers
-- ============================================================
-- Card #63. Proved by running it against a local copy of this database
-- (all migrations applied, publishable key only, her own session):
--
--   PATCH /rest/v1/profiles?id=eq.<her own id>  {"role":"admin"}   -> accepted
--   ... and with the same token, no re-login, she then changed
--   another sister's row. The same worked for `roles`, `is_suspended`,
--   `must_change_password` and `lock_override`.
--
-- Why nothing stopped her:
--   * The UPDATE policies on `profiles` are ROW-scoped. "Users can update
--     own profile" checks that the row is hers; "Staff can update any
--     profile" checks that she is admin or instructor. Neither one looks
--     at WHICH COLUMN is being written, and RLS cannot — it is row-level.
--   * The table-level UPDATE grant to `authenticated` therefore covered
--     every column. Migration 046 narrowed SELECT to a column list for
--     exactly this reason but left UPDATE table-wide.
--
-- Column privileges are the only lever that works, the same lever 046
-- used for SELECT. A column-level REVOKE cannot subtract from a
-- table-level grant, so we revoke UPDATE wholesale and grant back the
-- columns a sister legitimately writes about herself.
--
-- The grant-back list was taken from the code, not guessed. Every
-- user-scoped (non service-role) write to `profiles` in the app is:
--   src/app/dashboard/settings/profile-form.tsx  full_name, phone, updated_at
--   src/app/dashboard/settings/avatar-upload.tsx avatar_url, updated_at
-- `updated_at` is on the list because both forms send it; it is inert
-- either way, because the `profiles_updated_at` BEFORE UPDATE trigger
-- overwrites it with now() on every write.
--
-- Two writes that used to go through a user session had to move to the
-- server in this card, because they are staff powers and not self-edits:
--   * the admin suspend/unsuspend toggle  -> setUserSuspended() server
--     action, requireRole(["admin"]) + service-role client + audit log
--   * clearing must_change_password       -> changeOwnPassword() server
--     action, which now sets the new password itself, so the flag can
--     only be cleared by actually changing the password
--
-- `anon` loses UPDATE entirely: no UPDATE policy on `profiles` can ever
-- match an anonymous caller (auth.uid() is null and has_role() is false),
-- so the grant was reachable by nothing and is better gone.
--
-- MAINTENANCE: as with the SELECT grant in 046, any future
-- `ALTER TABLE profiles ADD COLUMN` is NOT writable by a signed-in user
-- until it is named below. Decide per column — that choice is the point.

REVOKE UPDATE ON public.profiles FROM anon, authenticated;

GRANT UPDATE (
  full_name,
  avatar_url,
  phone,
  updated_at
) ON public.profiles TO authenticated;

-- ============================================================
-- A demotion has to actually demote
-- ============================================================
-- `has_role()` reads `profiles.roles[]`, not `profiles.role`. The trigger
-- from migration 022 only ever ADDS the primary role to that array, so
--
--   UPDATE profiles SET role = 'student' WHERE id = <an admin>
--
-- left 'admin' sitting in roles[] and left has_role('admin') true. The
-- sister looked demoted on every screen and kept every power.
--
-- From here: when an UPDATE changes the primary `role` and does not write
-- `roles` in the same statement, the OLD primary role is taken out of the
-- array. A statement that writes `roles` itself still wins outright —
-- that is the path the admin screen uses (updateUserRoles sends both), and
-- it is how a genuine multi-role sister keeps her extra roles.
CREATE OR REPLACE FUNCTION public.sync_primary_role_into_roles()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NEW.roles IS NOT DISTINCT FROM OLD.roles
     AND OLD.role IS NOT NULL THEN
    NEW.roles := array_remove(NEW.roles, OLD.role);
  END IF;

  IF NEW.role IS NOT NULL AND NOT (NEW.role = ANY(NEW.roles)) THEN
    NEW.roles := array_append(NEW.roles, NEW.role);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_primary_role_into_roles() IS
  'Keeps profiles.roles[] honest. The primary role is always present in the array; and changing the primary role on its own removes the role it replaced, so a demotion written as "SET role = ..." really does take the power away (has_role() reads the array). An UPDATE that writes roles[] explicitly is left alone.';
