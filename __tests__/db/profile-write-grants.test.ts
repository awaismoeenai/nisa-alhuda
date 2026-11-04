// @vitest-environment node
/**
 * Card #63 — a signed-in sister must not be able to write her own powers.
 *
 * These run against the local Supabase stack over HTTP, with the same
 * publishable key that ships inside our own pages and a real session
 * token, because that is the only thing a column grant answers to.
 *
 * Read before changing anything here:
 *   * PostgREST answers 204 to an UPDATE that matched zero rows. The
 *     status code therefore proves nothing on its own. Every assertion
 *     below compares the value before the write with the value after it,
 *     read back with the service-role key.
 *   * The first test is a POSITIVE control: she really can still edit her
 *     own name. Without it, a stack that refused every write for some
 *     unrelated reason would make this whole file pass for free.
 *   * The file does not skip itself when the database is missing. See
 *     __tests__/helpers/local-stack.ts.
 *
 * Backed out migration 049 and watched these go red by name before
 * trusting them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createFixtureUser,
  deleteFixtureUser,
  patchProfileAs,
  readProfile,
  requireLocalStack,
  setProfile,
  signIn,
  tokenClaims,
  type ProfileRow,
} from "../../tests/support/local-stack";

const HER_EMAIL = "regression63.sister@local.invalid";
const HER_PASSWORD = "RegressionSixtyThree!1";
const OTHER_EMAIL = "regression63.other@local.invalid";
const OTHER_PASSWORD = "RegressionSixtyThree!2";

let herId = "";
let otherId = "";
let herToken = "";

beforeAll(async () => {
  await requireLocalStack();
  herId = await createFixtureUser(HER_EMAIL, HER_PASSWORD, "Regression Sister");
  otherId = await createFixtureUser(
    OTHER_EMAIL,
    OTHER_PASSWORD,
    "Regression Other Sister"
  );
  herToken = await signIn(HER_EMAIL, HER_PASSWORD);
}, 60_000);

afterAll(async () => {
  await deleteFixtureUser(HER_EMAIL);
  await deleteFixtureUser(OTHER_EMAIL);
}, 60_000);

/** Put her back to a plain, locked-down student before each attempt. */
async function resetHer(): Promise<void> {
  await setProfile(herId, {
    role: "student",
    roles: ["student"],
    is_suspended: true,
    must_change_password: true,
    lock_override: true,
    full_name: "Regression Sister",
    avatar_url: null,
    phone: null,
  });
}

describe("the fixture itself", () => {
  it("signs her in as a plain student with her own token", async () => {
    await resetHer();
    const claims = tokenClaims(herToken);
    expect(claims.role).toBe("authenticated");
    expect(claims.sub).toBe(herId);

    const her = await readProfile(herId);
    expect(her.role).toBe("student");
    expect(her.roles).toEqual(["student"]);
  });
});

describe("what a sister may still write about herself", () => {
  beforeEach(resetHer);

  it("saves her own name and phone number from the settings screen", async () => {
    const before = await readProfile(herId);
    const res = await patchProfileAs(
      herId,
      {
        full_name: "Aisha Rahman",
        phone: "+92 300 1112222",
        updated_at: new Date().toISOString(),
      },
      herToken
    );
    const after = await readProfile(herId);

    expect(res.status).toBeLessThan(300);
    expect(after.full_name).toBe("Aisha Rahman");
    expect(after.phone).toBe("+92 300 1112222");
    expect(after.full_name).not.toBe(before.full_name);
  });

  it("saves her own profile photo from the avatar upload", async () => {
    const res = await patchProfileAs(
      herId,
      {
        avatar_url: `avatars/${herId}.png`,
        updated_at: new Date().toISOString(),
      },
      herToken
    );
    const after = await readProfile(herId);

    expect(res.status).toBeLessThan(300);
    expect(after.avatar_url).toBe(`avatars/${herId}.png`);
  });
});

describe("what a sister may not write about herself", () => {
  beforeEach(resetHer);

  const attempts: Array<{
    column: string;
    patch: Record<string, unknown>;
    read: (row: ProfileRow) => unknown;
  }> = [
    { column: "role", patch: { role: "admin" }, read: (r) => r.role },
    {
      column: "roles",
      patch: { roles: ["admin"] },
      read: (r) => [...r.roles].sort().join(","),
    },
    {
      column: "is_suspended",
      patch: { is_suspended: false },
      read: (r) => r.is_suspended,
    },
    {
      column: "must_change_password",
      patch: { must_change_password: false },
      read: (r) => r.must_change_password,
    },
    {
      column: "lock_override",
      patch: { lock_override: false },
      read: (r) => r.lock_override,
    },
  ];

  for (const attempt of attempts) {
    it(`refuses her own ${attempt.column}`, async () => {
      const before = await readProfile(herId);
      const res = await patchProfileAs(herId, attempt.patch, herToken);
      const after = await readProfile(herId);

      // The value is the honest signal — a 204 can mean "matched nothing".
      expect(attempt.read(after)).toEqual(attempt.read(before));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  }

  it("refuses the whole statement when a forbidden column rides along with an allowed one", async () => {
    const before = await readProfile(herId);
    const res = await patchProfileAs(
      herId,
      { full_name: "Smuggled In", role: "admin" },
      herToken
    );
    const after = await readProfile(herId);

    expect(after.role).toBe(before.role);
    expect(after.full_name).toBe(before.full_name);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("controls — so none of the above can pass for free", () => {
  beforeEach(resetHer);

  it("leaves another sister's row alone when she writes to it", async () => {
    const before = await readProfile(otherId);
    await patchProfileAs(otherId, { full_name: "Renamed By A Student" }, herToken);
    const after = await readProfile(otherId);

    expect(after.full_name).toBe(before.full_name);
  });

  it("leaves her row alone for a visitor with no session at all", async () => {
    const before = await readProfile(herId);
    await patchProfileAs(herId, { full_name: "Renamed By Nobody" });
    const after = await readProfile(herId);

    expect(after.full_name).toBe(before.full_name);
  });

  it("still lets the admin screens change roles and suspension through the service role", async () => {
    const promoted = await setProfile(herId, {
      role: "instructor",
      roles: ["student", "instructor"],
    });
    expect(promoted.status).toBeLessThan(300);
    const afterRoles = await readProfile(herId);
    expect(afterRoles.role).toBe("instructor");
    expect([...afterRoles.roles].sort()).toEqual(["instructor", "student"]);

    const suspended = await setProfile(herId, { is_suspended: false });
    expect(suspended.status).toBeLessThan(300);
    expect((await readProfile(herId)).is_suspended).toBe(false);
  });
});

describe("a demotion actually demotes", () => {
  beforeEach(resetHer);

  it("takes the old primary role out of roles[] when only role is written", async () => {
    await setProfile(herId, { role: "admin", roles: ["student", "admin"] });
    const asAdmin = await readProfile(herId);
    // Precondition, asserted rather than assumed.
    expect(asAdmin.role).toBe("admin");
    expect(asAdmin.roles).toContain("admin");

    await setProfile(herId, { role: "student" });
    const demoted = await readProfile(herId);

    expect(demoted.role).toBe("student");
    // has_role('admin') reads this array. Leaving 'admin' in it would
    // leave her every admin power while every screen showed a student.
    expect(demoted.roles).not.toContain("admin");
    expect(demoted.roles).toContain("student");
  });

  it("leaves a genuine extra role alone when roles[] is written explicitly", async () => {
    await setProfile(herId, {
      role: "instructor",
      roles: ["instructor", "treasurer"],
    });
    const before = await readProfile(herId);
    expect([...before.roles].sort()).toEqual(["instructor", "treasurer"]);

    // This is the shape updateUserRoles() sends: primary and array together.
    await setProfile(herId, { role: "ta", roles: ["ta", "treasurer"] });
    const after = await readProfile(herId);

    expect(after.role).toBe("ta");
    expect([...after.roles].sort()).toEqual(["ta", "treasurer"]);
  });

  it("keeps the primary role present in roles[] (migration 022's invariant)", async () => {
    await setProfile(herId, { role: "instructor", roles: ["instructor"] });
    await setProfile(herId, { roles: ["treasurer"] });
    const after = await readProfile(herId);

    expect(after.role).toBe("instructor");
    expect([...after.roles].sort()).toEqual(["instructor", "treasurer"]);
  });
});
