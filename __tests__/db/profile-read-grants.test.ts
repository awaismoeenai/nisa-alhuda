/**
 * Card #65 — what an unsigned visitor may read off `profiles`.
 *
 * The publishable (anon) key is printed inside the HTML of every page on
 * the site. Anyone can read it with View Source. Migration 046 narrowed
 * the SELECT grant on `profiles` to a column list, but that list still
 * carried `phone`, `is_suspended` and `must_change_password`, so the key
 * returned every sister's mobile number, who was suspended, and who was
 * being forced to change her password — with no sign-in at all.
 *
 * RLS is row-level and cannot hide a column, so the fix is a column
 * grant, not a policy. Migration 050 takes those three columns off the
 * `anon` grant and leaves the catalogue columns (id, full_name,
 * avatar_url, role, roles, created_at, updated_at) in place.
 *
 * These tests talk HTTP to the real PostgREST on the local stack with the
 * real publishable key, exactly the way a stranger's browser would. They
 * never skip: a stack that is not answering is a red failure, because a
 * permission test that skips itself reads as green and is how a hole
 * ships.
 *
 * Every test puts a real value in the column first. A column full of
 * NULLs comes back looking clean and proves nothing.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  PROFILE_SELECT,
  PROFILE_SELECT_PUBLIC,
} from "@/lib/db/profile-columns";
import {
  createFixtureUser,
  deleteFixtureUser,
  readProfile,
  requireLocalStack,
  rest,
  setProfile,
  signIn,
} from "../../tests/support/local-stack";

const SISTER_EMAIL = "db65.sister@local.invalid";
const SISTER_PASSWORD = "Db65Sister!1";
const SISTER_NAME = "Aisha Test Sixtyfive";
/** Made up. Never a real number. */
const SISTER_PHONE = "+92-300-6500065";

const TREASURER_EMAIL = "db65.treasurer@local.invalid";
const TREASURER_PASSWORD = "Db65Treasurer!1";
const TREASURER_NAME = "Maryam Test Sixtyfive";

let sisterId = "";
let treasurerId = "";

/** The anon key with no session at all — a stranger holding View Source. */
async function asVisitor(query: string) {
  return rest(`/profiles?${query}`);
}

/** PostgREST's refusal for a column the current role may not read. */
function expectColumnRefused(
  res: { status: number; body: unknown },
  what: string
) {
  const body = res.body as { code?: string; message?: string } | null;
  expect(
    res.status,
    `${what}: expected the request to be refused, got ${res.status} with ${JSON.stringify(res.body)}`
  ).toBe(401);
  expect(body?.code, `${what}: expected SQLSTATE 42501`).toBe("42501");
  expect(body?.message ?? "").toMatch(/permission denied/i);
}

beforeAll(async () => {
  await requireLocalStack();

  sisterId = await createFixtureUser(SISTER_EMAIL, SISTER_PASSWORD, SISTER_NAME);
  treasurerId = await createFixtureUser(
    TREASURER_EMAIL,
    TREASURER_PASSWORD,
    TREASURER_NAME
  );

  // Put real values in the three columns under test. Without a value,
  // a denied read and a column of NULLs look the same from outside.
  await setProfile(sisterId, {
    full_name: SISTER_NAME,
    phone: SISTER_PHONE,
    is_suspended: true,
    must_change_password: true,
  });
  await setProfile(treasurerId, {
    full_name: TREASURER_NAME,
    role: "admin",
  });

  // Prove the fixture really is what the tests assume before asserting
  // anything about who can read it.
  const sister = await readProfile(sisterId);
  expect(sister.phone).toBe(SISTER_PHONE);
  expect(sister.is_suspended).toBe(true);
  expect(sister.must_change_password).toBe(true);
}, 60_000);

afterAll(async () => {
  await deleteFixtureUser(SISTER_EMAIL);
  await deleteFixtureUser(TREASURER_EMAIL);
});

describe("an unsigned visitor and the profiles table", () => {
  it("still reads the catalogue columns, and really does see our fixture row", async () => {
    // The positive control. If this ever matches zero rows the whole file
    // is meaningless, so it is asserted before any refusal is.
    const res = await asVisitor(
      `select=${encodeURIComponent(PROFILE_SELECT_PUBLIC)}&id=eq.${sisterId}`
    );
    expect(res.status).toBe(200);

    const rows = res.body as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(
      rows.length,
      "a visitor could not read the fixture row at all — the catalogue is broken, which is a different bug from the one under test"
    ).toBe(1);
    expect(rows[0].full_name).toBe(SISTER_NAME);
    expect(rows[0]).toHaveProperty("avatar_url");
  });

  it("cannot read a phone number", async () => {
    expectColumnRefused(await asVisitor("select=phone"), "select=phone");
  });

  it("cannot read a phone number by hiding it among allowed columns", async () => {
    expectColumnRefused(
      await asVisitor("select=id,full_name,phone"),
      "select=id,full_name,phone"
    );
  });

  it("cannot read who is suspended", async () => {
    expectColumnRefused(
      await asVisitor("select=is_suspended"),
      "select=is_suspended"
    );
  });

  it("cannot read who is being forced to change her password", async () => {
    expectColumnRefused(
      await asVisitor("select=must_change_password"),
      "select=must_change_password"
    );
  });

  it("cannot reach any of the three through a filter either", async () => {
    // A column you may not read is also a column you may not filter on,
    // otherwise a visitor could recover a number digit by digit.
    expectColumnRefused(
      await asVisitor(`select=id&phone=eq.${encodeURIComponent(SISTER_PHONE)}`),
      "filtering on phone"
    );
    expectColumnRefused(
      await asVisitor("select=id&is_suspended=eq.true"),
      "filtering on is_suspended"
    );
  });

  it("cannot ask for everything with select=*", async () => {
    expectColumnRefused(await asVisitor("select=*"), "select=*");
  });

  it("is refused the column migration 046 withheld, as it always was", async () => {
    // The live control: a column nobody ever granted to anon. It proves a
    // refusal looks different from a success on this endpoint, so the 200
    // in the first test is a real result and not an artefact.
    expectColumnRefused(
      await asVisitor("select=lock_override_note"),
      "select=lock_override_note"
    );
  });
});

describe("the select lists the app ships", () => {
  it("PROFILE_SELECT_PUBLIC names only columns a visitor may read", async () => {
    // Ties the constant in src/lib/db/profiles.ts to the grant in
    // migration 050. Putting `phone` back into the constant turns this
    // red by name instead of 401-ing a public page in production.
    const res = await asVisitor(
      `select=${encodeURIComponent(PROFILE_SELECT_PUBLIC)}&limit=1`
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("PROFILE_SELECT is now more than a visitor may read", async () => {
    // The signed-in list still carries the three columns, on purpose —
    // see the scope note below. This records that the two lists have
    // genuinely parted company, so nobody uses PROFILE_SELECT on a page
    // an anonymous visitor can reach.
    expect(PROFILE_SELECT).not.toBe(PROFILE_SELECT_PUBLIC);
    expectColumnRefused(
      await asVisitor(`select=${encodeURIComponent(PROFILE_SELECT)}&limit=1`),
      "PROFILE_SELECT as a visitor"
    );
  });

  it("the public offering page's subject embed is readable by a visitor", async () => {
    // The shape src/app/(public)/offerings/[slug]/page.tsx sends. It used
    // to ask for profiles(*), which migration 046 had already made a 401
    // for anon — so the subject list came back empty for every visitor.
    const res = await rest(
      `/subjects?select=id,title,instructor:profiles!subjects_instructor_id_fkey(${encodeURIComponent(
        PROFILE_SELECT_PUBLIC
      )})&limit=1`
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("the screens that legitimately show a phone number", () => {
  it("an admin's own session still reads a student's phone", async () => {
    // Done-when: admin and instructor screens that legitimately show a
    // phone number still show it. src/app/dashboard/admin/payments/page.tsx
    // and .../payments/grid/page.tsx read profiles(full_name, phone)
    // through the USER-SESSION client, so this is the real query they run.
    const token = await signIn(TREASURER_EMAIL, TREASURER_PASSWORD);
    const res = await rest(
      `/profiles?select=full_name,phone&id=eq.${sisterId}`,
      { token }
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body as Array<{ phone: string | null }>;
    expect(rows.length).toBe(1);
    expect(rows[0].phone).toBe(SISTER_PHONE);
  });

  it("SCOPE NOTE: a signed-in student can still read them too", async () => {
    // Not a hole this card closes, and it is recorded here rather than
    // left to be discovered. The `authenticated` grant is unchanged
    // because the money screens above read `phone` through a user
    // session; closing this half means moving those reads to the
    // service-role client behind requireRole, which is its own card and
    // its own deep review.
    //
    // When that card lands, THIS test is the one that must be rewritten
    // to expect a refusal — that is the point of it being here.
    const token = await signIn(SISTER_EMAIL, SISTER_PASSWORD);
    const res = await rest(`/profiles?select=phone&id=eq.${treasurerId}`, {
      token,
    });
    expect(
      res.status,
      "the authenticated half of #65 changed — update the money screens and this test together"
    ).toBe(200);
  });
});
