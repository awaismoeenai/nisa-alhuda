-- ============================================================
-- Migration 049: close get_owed_reminder_targets to everyone but the job
-- ============================================================
-- Migration 030 created public.get_owed_reminder_targets as SECURITY DEFINER
-- so the payment-reminder cron could read student emails out of auth.users.
-- It has no authorization check inside it and its default PUBLIC EXECUTE was
-- never revoked, so anyone holding the publishable (anon) key that ships in
-- our own page source could POST to /rest/v1/rpc/get_owed_reminder_targets
-- with no session at all and get back, for any cycle, every owing sister's
-- email, name, course and amount. Confirmed by running it (card #64).
--
-- The only caller in the codebase is
-- src/app/api/cron/send-payment-reminders/route.ts, which builds its client
-- with SUPABASE_SERVICE_ROLE_KEY. Nothing on the site calls it with the anon
-- or the signed-in-user client, so closing it breaks nothing.
--
-- Scope: this migration touches exactly one function. The wider sweep of the
-- other thirteen SECURITY DEFINER functions in `public` is card #104.
-- ============================================================

-- 0. Fail loudly rather than silently doing nothing if 030 never ran.
DO $$
BEGIN
  IF to_regprocedure('public.get_owed_reminder_targets(date)') IS NULL THEN
    RAISE EXCEPTION
      'public.get_owed_reminder_targets(date) is missing - migration 030 must run before 049';
  END IF;
END $$;

-- 1. Pin the search path. Project rule: every SECURITY DEFINER function gets
--    one, so the definer's rights cannot be aimed at a caller-planted schema.
--    Every table the body reads is already schema-qualified, and the built-in
--    types resolve from pg_catalog, which is always searched.
ALTER FUNCTION public.get_owed_reminder_targets(DATE) SET search_path = '';

-- 2. Take the execute privilege away from the public key, the signed-in key
--    and the implicit PUBLIC grant that CREATE FUNCTION hands out.
--    Idempotent: revoking a privilege that is already gone is a no-op.
REVOKE EXECUTE ON FUNCTION public.get_owed_reminder_targets(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_owed_reminder_targets(DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_owed_reminder_targets(DATE) FROM authenticated;

-- 3. Leave the door open for the reminder job only. Proved at runtime: with
--    the three revokes above in place the anon call answers 401 / 42501 and
--    the service-role call still returns every row.
GRANT EXECUTE ON FUNCTION public.get_owed_reminder_targets(DATE) TO service_role;

COMMENT ON FUNCTION public.get_owed_reminder_targets(DATE) IS
  'Reminder-job only. SECURITY DEFINER, reads auth.users, and has no caller '
  'check inside it, so EXECUTE is granted to service_role alone (migration 049, card #64). '
  'Do not grant it to anon or authenticated.';
