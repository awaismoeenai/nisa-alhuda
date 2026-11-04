// @vitest-environment node
/**
 * Card #64 — the other half of the proof.
 *
 * Migration 049 takes EXECUTE on get_owed_reminder_targets away from PUBLIC,
 * anon and authenticated. The one thing that legitimately calls that function
 * is the payment-reminder cron, which builds its client with the service-role
 * key. This test runs that route's real handler against the local stack and
 * asserts it still finds and reminds owing sisters, so "we closed the door"
 * cannot quietly mean "we closed it on the job too".
 *
 * Reading the route's source would prove the code exists, never that it runs.
 * This calls GET() for real: a 42501 from the revoke would surface as a 500.
 *
 * The email sender is mocked — no mail leaves the machine. Everything else
 * (the RPC, the reminded_at stamp, the cron_logs write) is real, and every
 * row this test creates is deleted again afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, stackConfig } from "./local-stack";
import { firstOfMonth } from "@/lib/monthly-payments";

const sendPaymentReminderEmail = vi.fn(async () => {});
vi.mock("@/lib/email", () => ({
  sendPaymentReminderEmail: (...args: unknown[]) => sendPaymentReminderEmail(...(args as [])),
}));

const CRON_SECRET = "test-cron-secret-for-card-64";
const WANTED_ROWS = 3;
/** The route picks the cycle itself, so the fixtures have to live in that one. */
const CYCLE = firstOfMonth(new Date());
/** Only the cron_logs rows this run creates get cleaned up, never anyone else's. */
const RUN_STARTED_AT = new Date().toISOString();

function owingRowCount(): number {
  return Number(
    sql(
      `SELECT count(*) FROM public.monthly_payments
       WHERE cycle_month = DATE '${CYCLE}' AND status = 'owed';`
    )[0]
  );
}

beforeAll(() => {
  const config = stackConfig();
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = config.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = config.serviceRoleKey;

  const preexisting = owingRowCount();
  if (preexisting !== 0) {
    throw new Error(
      `The local database already holds ${preexisting} owed rows for cycle ${CYCLE}. ` +
        `This test would remind them and then delete them. Clear them first.`
    );
  }

  sql(`
    INSERT INTO public.monthly_payments
      (enrollment_id, student_id, offering_id, cycle_month, amount, currency, status, reminded_at)
    SELECT e.id, e.student_id, e.offering_id, DATE '${CYCLE}', 4321.00, 'PKR', 'owed', NULL
    FROM public.enrollments e
    JOIN auth.users u       ON u.id = e.student_id
    JOIN public.profiles p  ON p.id = e.student_id
    JOIN public.offerings o ON o.id = e.offering_id
    WHERE e.status = 'approved'
    ORDER BY e.id
    LIMIT ${WANTED_ROWS}
    ON CONFLICT (enrollment_id, cycle_month) DO NOTHING;
  `);

  const seeded = owingRowCount();
  if (seeded !== WANTED_ROWS) {
    throw new Error(
      `Could not seed ${WANTED_ROWS} owing rows for cycle ${CYCLE} (got ${seeded}). ` +
        `Failing rather than asserting the route reminded nobody: with no fixtures the ` +
        `route answers ok with reminded:0 whether or not it can still read the function.`
    );
  }
});

afterAll(() => {
  sql(`DELETE FROM public.monthly_payments WHERE cycle_month = DATE '${CYCLE}';`);
  sql(
    `DELETE FROM public.cron_logs
     WHERE job_name = 'send-payment-reminders' AND ran_at >= TIMESTAMPTZ '${RUN_STARTED_AT}';`
  );
});

describe("GET /api/cron/send-payment-reminders", () => {
  it("turns away a caller without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/send-payment-reminders/route");
    const res = await GET(new Request("http://localhost/api/cron/send-payment-reminders"));
    expect(res.status).toBe(401);
    expect(sendPaymentReminderEmail).not.toHaveBeenCalled();
  });

  it("still reads the owing sisters through the service role and reminds them", async () => {
    const { GET } = await import("@/app/api/cron/send-payment-reminders/route");
    const res = await GET(
      new Request("http://localhost/api/cron/send-payment-reminders", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    );
    const body = (await res.json()) as {
      ok?: boolean;
      cycle?: string;
      reminded?: number;
      error?: string;
    };

    // A permission error on the RPC comes back here as a 500 carrying the
    // Postgres message, so say so rather than just failing on the status.
    expect(
      body.error ?? null,
      "the reminder job could not read get_owed_reminder_targets - migration 049 closed the door on the job itself"
    ).toBeNull();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cycle).toBe(CYCLE);
    expect(body.reminded).toBe(WANTED_ROWS);
    expect(sendPaymentReminderEmail).toHaveBeenCalledTimes(WANTED_ROWS);

    // And it did the work: every seeded row is stamped, so nobody is emailed twice.
    const unstamped = Number(
      sql(
        `SELECT count(*) FROM public.monthly_payments
         WHERE cycle_month = DATE '${CYCLE}' AND reminded_at IS NULL;`
      )[0]
    );
    expect(unstamped).toBe(0);
  });
});
