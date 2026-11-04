/**
 * Card #65 — the public catalogue, walked by a browser with no session.
 *
 * Migration 050 takes `phone`, `is_suspended` and `must_change_password`
 * off the `anon` SELECT grant on `profiles`. The database tests
 * (__tests__/db/profile-read-grants.test.ts) prove the grant. This file
 * proves the pages built on top of it still work and still say nothing
 * they should not — a column list that compiles is not the same as a
 * page that renders.
 *
 * It matters here more than usual: asking for a column `anon` was not
 * granted makes PostgREST refuse the WHOLE request, not drop the column.
 * A page that forgets and asks for `phone` does not show a blank field,
 * it shows nothing at all. That is exactly what `profiles(*)` had been
 * doing to the subject list on this page since migration 046.
 *
 * Happy path:  a visitor with no account opens a course page and a
 *              program page and sees the instructor's name on both.
 * Main failure: nothing she is served, and nothing the publishable key
 *              in that page can fetch, carries a phone number.
 *
 * The spec builds and removes its own accounts, offering and subject
 * with the service-role key on the local stack, so it needs no seeding
 * and leaves nothing behind. It never skips: a missing local stack is a
 * failure, because a skipped permission test reads as green.
 */
import { test, expect } from "@playwright/test";
import {
  anonKey,
  createFixtureUser,
  deleteFixtureUser,
  localStackUrl,
  readProfile,
  requireLocalStack,
  rest,
  setProfile,
} from "../support/local-stack";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const INSTRUCTOR_EMAIL = "e2e65.instructor@local.invalid";
const INSTRUCTOR_PASSWORD = "E2eSixtyFiveTeach!1";
const INSTRUCTOR_NAME = "Ustadha Hafsa Sixtyfive";
/** Made up, and deliberately unmistakable in a page of HTML. */
const INSTRUCTOR_PHONE = "+92-301-6555065";

const COURSE_SLUG = "e2e65-tajweed-course";
const PROGRAM_SLUG = "e2e65-hifz-program";

let instructorId = "";

async function removeFixtureContent() {
  await rest(`/subjects?slug=eq.e2e65-subject`, {
    service: true,
    method: "DELETE",
  });
  await rest(`/offerings?slug=in.(${COURSE_SLUG},${PROGRAM_SLUG})`, {
    service: true,
    method: "DELETE",
  });
}

test.beforeAll(async () => {
  await requireLocalStack();
  await removeFixtureContent();

  instructorId = await createFixtureUser(
    INSTRUCTOR_EMAIL,
    INSTRUCTOR_PASSWORD,
    INSTRUCTOR_NAME
  );
  await setProfile(instructorId, {
    full_name: INSTRUCTOR_NAME,
    role: "instructor",
    phone: INSTRUCTOR_PHONE,
    is_suspended: false,
    must_change_password: false,
  });

  // A phone number has to actually be there, or "the page does not show
  // one" is true for the wrong reason.
  const row = await readProfile(instructorId);
  expect(row.phone).toBe(INSTRUCTOR_PHONE);

  const course = await rest("/offerings", {
    service: true,
    method: "POST",
    prefer: "return=representation",
    body: {
      title: "E2E65 Tajweed Course",
      slug: COURSE_SLUG,
      description: "A fixture course for card #65.",
      type: "course",
      status: "published",
      instructor_id: instructorId,
    },
  });
  expect(course.status, JSON.stringify(course.body)).toBe(201);

  const program = await rest("/offerings", {
    service: true,
    method: "POST",
    prefer: "return=representation",
    body: {
      title: "E2E65 Hifz Program",
      slug: PROGRAM_SLUG,
      description: "A fixture program for card #65.",
      type: "program",
      status: "published",
      instructor_id: instructorId,
    },
  });
  expect(program.status, JSON.stringify(program.body)).toBe(201);

  const programId = (program.body as Array<{ id: string }>)[0].id;
  const subject = await rest("/subjects", {
    service: true,
    method: "POST",
    prefer: "return=representation",
    body: {
      offering_id: programId,
      title: "E2E65 Subject",
      slug: "e2e65-subject",
      instructor_id: instructorId,
      sort_order: 1,
    },
  });
  expect(subject.status, JSON.stringify(subject.body)).toBe(201);
});

test.afterAll(async () => {
  await removeFixtureContent();
  await deleteFixtureUser(INSTRUCTOR_EMAIL);
});

test("a visitor with no account sees the instructor on a course page", async ({
  page,
}) => {
  await page.goto(`/offerings/${COURSE_SLUG}`);

  await expect(page.getByText(INSTRUCTOR_NAME).first()).toBeVisible({
    timeout: 20_000,
  });

  const html = await page.content();
  expect(
    html,
    "the instructor's phone number was served to a logged-out visitor"
  ).not.toContain(INSTRUCTOR_PHONE);
  expect(html).not.toContain("6555065");
});

test("a visitor with no account sees the subject list on a program page", async ({
  page,
}) => {
  // The read that was broken: the subject list embeds the instructor's
  // profile. While it asked for `profiles(*)` the whole query was
  // refused and this page showed a visitor no subjects at all.
  await page.goto(`/offerings/${PROGRAM_SLUG}`);

  await expect(page.getByText("E2E65 Subject").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(INSTRUCTOR_NAME).first()).toBeVisible();

  const html = await page.content();
  expect(html).not.toContain(INSTRUCTOR_PHONE);
});

test("the publishable key our own pages hand out cannot fetch a phone number", async ({
  page,
}) => {
  // Where the key actually is, checked rather than assumed: it is not
  // inline in the HTML, it is built into a client chunk that /login — a
  // page open to anyone — tells the browser to download. So "anyone can
  // get this key off our site" is a measured fact here, not a claim.
  await page.goto("/login");
  const html = await page.content();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js/g) ?? [])];
  expect(
    chunks.length,
    "this page loaded no client chunks, so the walk below checks nothing"
  ).toBeGreaterThan(0);

  const key = anonKey();
  let carrier = "";
  for (const chunk of chunks) {
    const res = await page.request.get(chunk);
    if ((await res.text()).includes(key)) {
      carrier = chunk;
      break;
    }
  }
  expect(
    carrier,
    "the publishable key was not found in anything /login serves, so this test is not checking what it says it checks"
  ).not.toBe("");

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const allowed = await page.request.get(
    `${localStackUrl()}/rest/v1/profiles?select=id,full_name&id=eq.${instructorId}`,
    { headers }
  );
  expect(
    allowed.status(),
    "a visitor can no longer read a name either — that is a broken catalogue, not a closed hole"
  ).toBe(200);
  expect(await allowed.text()).toContain(INSTRUCTOR_NAME);

  for (const column of ["phone", "is_suspended", "must_change_password"]) {
    const refused = await page.request.get(
      `${localStackUrl()}/rest/v1/profiles?select=${column}`,
      { headers }
    );
    expect(refused.status(), `select=${column} was not refused`).toBe(401);
    expect(await refused.text()).toContain("42501");
  }
});
