-- ============================================================
-- Migration 048: Treasurers can read payment receipts
-- ============================================================
-- The `payment-receipts` bucket got its read policy in migration 001, which
-- predates the treasurer role (added in migration 018). That policy allows
-- the uploader herself or an admin, and nobody added treasurer to it:
--
--   "Users can view own receipts"  →  folder = auth.uid()  OR  role = 'admin'
--
-- Receipt images are signed in the browser with the signed-in user's own
-- token (see src/app/dashboard/admin/payments/payment-actions.tsx, the
-- monthly equivalent, and the billing grid), so storage RLS is the only
-- thing deciding this. A treasurer is simply refused and every receipt in
-- the ledger and the lightbox reads "Failed to load receipt." Reviewing
-- receipts is the whole of a treasurer's job, so the product does not work
-- for that role at all.
--
-- Fix, following the shape migration 019 used for the other treasurer gaps:
-- add a PARALLEL permissive SELECT policy rather than rewriting the 001 one.
-- Permissive policies are OR'd, so this widens reads for treasurers and
-- changes nothing for anyone else — the existing policy is left untouched,
-- which keeps the blast radius to the one role named on the card.
--
-- `public.has_role` (migration 022) is used rather than `get_user_role()`
-- so a sister who holds treasurer as an additional role — an instructor who
-- also does the books — is covered too. Migration 044, the most recent
-- storage-policy migration, uses the same helper. The enum literal is
-- schema-qualified because this policy is evaluated on `storage.objects`,
-- where `public` is not reliably on the search_path.
--
-- Students are unaffected: they keep the own-folder arm of the 001 policy.
-- Instructors still have no read path into this bucket at all.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE, so a re-run is a no-op.
-- No new function, so there is no SECURITY DEFINER / search_path to set.
-- No COMMENT ON POLICY here: the migration role is not the owner of
-- storage.objects, so commenting on it aborts the run (migrations 001 and
-- 044 set storage policies without comments for the same reason).

DROP POLICY IF EXISTS "Treasurers can view payment receipts" ON storage.objects;
CREATE POLICY "Treasurers can view payment receipts"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'payment-receipts'
        AND public.has_role('treasurer'::public.user_role)
    );
