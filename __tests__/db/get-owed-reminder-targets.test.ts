// @vitest-environment node
/**
 * Card #64 — a stranger could download the list of every sister who owes money.
 *
 * public.get_owed_reminder_targets is SECURITY DEFINER (it reads auth.users for
 * the reminder job), has no authorization check inside it, and migration 030
 * never revoked the EXECUTE that CREATE FUNCTION hands to PUBLIC. So a POST to
 * /rest/v1/rpc/get_owed_reminder_targets carrying only the publishable key that
 * ships in our own page source — no Authorization header, no session — answered
 * http 200 with every owing sister's email, name, course and amount, for any
 * cycle the caller named. Migration 049 closes it.
 *
 * The trap this test is written around: an anon call against a cycle with no
 * owing rows answers **200 with an empty list**, which looks nothing like a
 * refusal. A test that only asserted "no rows came back" would pass for free
 * the moment the fixtures stopped working. So this file:
 *
 *   1. seeds real owing rows for a far-future cycle nothing else uses,
 *   2. proves through the service role that those rows ARE what the function
 *      returns — if that count is 0 the suite fails rather than passing,
 *   3. only then asserts the anon call is REFUSED (401 / SQLSTATE 42501),
 *      and asserts explicitly that it is not a 200.
 *
 * Watched go red by name with migration 049 backed out (see card #64).
 *
 * Fixtures are made up and are deleted again afterwards. Local stack only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonFetchRpc, serviceFetchRpc, sql } from "./local-stack";

/** A cycle far enough out that no seed, fixture or e2e test uses it. */
const TEST_CYCLE = "2099-07-27";
const WANTED_ROWS = 3;

/** Columns a leak would hand a stranger. The function must return all of them. */
const LEAKY_COLUMNS = [
  "payment_id",
  "enrollment_id",
  "student_id",
  "student_email",
  "student_name",
  "offering_title",
  "amount",
  "currency",
];

function seededRowCount(): number {
  return Number(
    sql(
      `SELECT count(*) FROM public.monthly_payments WHERE cycle_month = DATE '${TEST_CYCLE}';`
    )[0]
  );
}

beforeAll(() => {
  // Never inherit someone else's leftovers.
  sql(`DELETE FROM public.monthly_payments WHERE cycle_month = DATE '${TEST_CYCLE}';`);

  // Owing rows on made-up amounts, hung off enrollments that already have an
  // auth user, a profile and an offering — all four joins the function makes.
  sql(`
    INSERT INTO public.monthly_payments
      (enrollment_id, student_id, offering_id, cycle_month, amount, currency, status, reminded_at)
    SELECT e.id, e.student_id, e.offering_id, DATE '${TEST_CYCLE}', 1234.00, 'PKR', 'owed', NULL
    FROM public.enrollments e
    JOIN auth.users u      ON u.id = e.student_id
    JOIN public.profiles p ON p.id = e.student_id
    JOIN public.offerings o ON o.id = e.offering_id
    WHERE e.status = 'approved'
    ORDER BY e.id
    LIMIT ${WANTED_ROWS}
    ON CONFLICT (enrollment_id, cycle_month) DO NOTHING;
  `);

  const seeded = seededRowCount();
  if (seeded !== WANTED_ROWS) {
    throw new Error(
      `Could not seed ${WANTED_ROWS} owing rows for ${TEST_CYCLE} (got ${seeded}). ` +
        `The local database needs at least ${WANTED_ROWS} approved enrollments whose ` +
        `student has an auth user and a profile — run \`npm run seed\`. ` +
        `Failing rather than testing against an empty cycle: an anon call against a ` +
        `cycle with no owing rows answers 200 with an empty list, which would make ` +
        `this whole file pass while the function was still wide open.`
    );
  }
});

afterAll(() => {
  sql(`DELETE FROM public.monthly_payments WHERE cycle_month = DATE '${TEST_CYCLE}';`);
  const left = seededRowCount();
  if (left !== 0) {
    throw new Error(`Left ${left} fixture rows behind for ${TEST_CYCLE}; clean them up.`);
  }
});

describe("public.get_owed_reminder_targets", () => {
  it("returns the seeded owing rows to the reminder job's service role", async () => {
    const { status, body } = await serviceFetchRpc("get_owed_reminder_targets", {
      p_cycle: TEST_CYCLE,
    });

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const rows = body as Record<string, unknown>[];

    // The fixtures must be visible through this function, or the refusal test
    // below would be asserting against an empty cycle and passing for free.
    expect(rows).toHaveLength(WANTED_ROWS);
    expect(Object.keys(rows[0]).sort()).toEqual([...LEAKY_COLUMNS].sort());
  });

  it("refuses the publishable key with no Authorization header", async () => {
    const { status, body } = await anonFetchRpc("get_owed_reminder_targets", {
      p_cycle: TEST_CYCLE,
    });

    // Say the failure out loud: a 200 here means the leak is back.
    expect(
      status,
      "anon called get_owed_reminder_targets and was not refused - the owing-sisters leak is open again"
    ).not.toBe(200);
    expect(status).toBe(401);
    expect((body as { code?: string } | null)?.code).toBe("42501");
  });

  it("holds no EXECUTE grant for PUBLIC, anon or authenticated", () => {
    const acl = sql(`
      SELECT coalesce(array_to_string(p.proacl, ','), '<default: PUBLIC can execute>')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_owed_reminder_targets';
    `);

    // One row, or the function is gone and the question is moot - fail either way.
    expect(acl).toHaveLength(1);
    const grants = acl[0];

    expect(grants).not.toMatch(/(^|,)=[a-zA-Z]*X/); // the implicit PUBLIC grant
    expect(grants).not.toMatch(/\banon=[a-zA-Z]*X/);
    expect(grants).not.toMatch(/\bauthenticated=[a-zA-Z]*X/);
    expect(grants).toMatch(/\bservice_role=[a-zA-Z]*X/);
  });

  it("pins its search_path, as every SECURITY DEFINER function here must", () => {
    const rows = sql(`
      SELECT p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '<none>')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_owed_reminder_targets';
    `);

    expect(rows).toHaveLength(1);
    const [secdef, config] = rows[0].split("|");
    expect(secdef).toBe("true");
    expect(config).toMatch(/search_path=/);
  });
});
