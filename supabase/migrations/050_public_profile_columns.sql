-- ============================================================
-- Migration 050: a visitor reads names and photos, not phone numbers
-- ============================================================
-- Card #65. Proved by running it against a local copy of this database
-- (every migration applied, publishable key only, no session at all):
--
--   curl "$URL/rest/v1/profiles?select=phone" -H "apikey: $ANON_KEY"
--     -> http 200, every row, every number
--
-- The publishable key is printed inside the HTML of every page we serve.
-- Anyone can read it with View Source, so "a visitor" here means anyone
-- at all. It came back with every sister's mobile number, who was
-- suspended, and who was being forced to change her password.
--
-- Why it was open: migration 046 took the table-wide SELECT away from
-- `anon` and granted back a named list of columns — but `phone`,
-- `is_suspended` and `must_change_password` were on that list alongside
-- the three the public catalogue actually needs. The row policy on
-- `profiles` is USING (true), so a visitor sees every row; the column
-- list was the only limit, and these three were inside it.
--
-- RLS is row-level and cannot hide a column, so no further policy would
-- have helped. A column-level REVOKE cannot subtract from a table-level
-- grant either, so — exactly as 046 did — the grant is taken away
-- wholesale and the public columns are granted back. Verified on the
-- local database that `REVOKE SELECT ON public.profiles FROM anon` drops
-- anon's column privileges and leaves `authenticated`'s untouched.
--
-- SCOPE: `authenticated` deliberately keeps the wider list. The admin
-- payment screens (src/app/dashboard/admin/payments/page.tsx and
-- .../payments/grid/page.tsx) read `profiles(full_name, phone)` through
-- a USER-SESSION client, so narrowing `authenticated` would 401 the money
-- screens; those reads have to move to the service-role client behind
-- requireRole first. That is a separate card and a separate deep review.
-- Until it lands, a signed-in sister can still read another sister's
-- phone number — recorded on card #65, not forgotten.
--
-- MAINTENANCE, carried over from 046: the grant is column-scoped, so any
-- future `ALTER TABLE profiles ADD COLUMN` is invisible to `anon` until
-- it is named below. Decide per column whether a stranger may read it.
-- That choice being explicit is the point.

REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id,
  full_name,
  avatar_url,
  role,
  roles,
  created_at,
  updated_at
) ON public.profiles TO anon;
