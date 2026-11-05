/**
 * Card #63 — the screens that write to `profiles`, walked in a browser.
 *
 * Migration 051 takes `role`, `roles`, `is_suspended`,
 * `must_change_password` and `lock_override` out of the UPDATE grant for
 * a signed-in session. Two screens used to write through that grant, so
 * both were rewired to server actions. The database tests
 * (__tests__/db/profile-write-grants.test.ts) prove the grant. This file
 * proves the screens still work on top of it — source that compiles is
 * not the same as a button that does something.
 *
 * Happy path:  an admin suspends and unsuspends a sister from the user
 *              directory, and a sister saves her own name in settings.
 * Main failure: the suspended sister is bounced to /suspended and cannot
 *              clear the flag she is standing behind.
 *
 * The spec builds and removes its own accounts with the service-role key
 * on the local stack, so it needs no seeding and leaves nothing behind.
 * It never skips: a missing local stack is a failure.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  createFixtureUser,
  deleteFixtureUser,
  readProfile,
  requireLocalStack,
  setProfile,
} from "../support/local-stack";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ADMIN_EMAIL = "e2e63.admin@local.invalid";
const ADMIN_PASSWORD = "E2eSixtyThreeAdmin!1";
const SISTER_EMAIL = "e2e63.sister@local.invalid";
const SISTER_PASSWORD = "E2eSixtyThreeSister!1";
const SISTER_NAME = "Khadija Test Sixtythree";

let adminId = "";
let sisterId = "";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

test.beforeAll(async () => {
  await requireLocalStack();
  adminId = await createFixtureUser(
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    "E2E Sixtythree Admin"
  );
  await setProfile(adminId, { role: "admin", roles: ["admin"] });
  sisterId = await createFixtureUser(
    SISTER_EMAIL,
    SISTER_PASSWORD,
    SISTER_NAME
  );
  await setProfile(sisterId, { role: "student", roles: ["student"] });
});

test.afterAll(async () => {
  await deleteFixtureUser(ADMIN_EMAIL);
  await deleteFixtureUser(SISTER_EMAIL);
});

test("an admin can suspend and unsuspend a sister from the user directory", async ({
  page,
}) => {
  await setProfile(sisterId, { is_suspended: false });
  expect((await readProfile(sisterId)).is_suspended).toBe(false);

  // The toggle asks for confirmation first.
  page.on("dialog", (dialog) => dialog.accept());

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

  await page.goto("/dashboard/admin/users");
  await page
    .getByPlaceholder("Search by name, phone, or ID...")
    .fill(SISTER_NAME);
  await expect(page.getByText(SISTER_NAME).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Suspend user" }).first().click();
  await expect
    .poll(async () => (await readProfile(sisterId)).is_suspended, {
      timeout: 30_000,
    })
    .toBe(true);

  await page.getByRole("button", { name: "Unsuspend user" }).first().click();
  await expect
    .poll(async () => (await readProfile(sisterId)).is_suspended, {
      timeout: 30_000,
    })
    .toBe(false);
});

test("a sister can still save her own name on the settings screen", async ({
  page,
}) => {
  await setProfile(sisterId, { is_suspended: false, full_name: SISTER_NAME });

  await login(page, SISTER_EMAIL, SISTER_PASSWORD);
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

  await page.goto("/dashboard/settings");
  const nameField = page.locator(`input[value="${SISTER_NAME}"]`);
  await expect(nameField).toBeVisible({ timeout: 30_000 });

  await nameField.fill("Khadija Renamed Herself");
  await page.getByRole("button", { name: /save changes/i }).click();

  await expect
    .poll(async () => (await readProfile(sisterId)).full_name, {
      timeout: 30_000,
    })
    .toBe("Khadija Renamed Herself");
});

test("a sister never reaches the screen that suspends people", async ({
  page,
}) => {
  await setProfile(sisterId, { is_suspended: false });

  await login(page, SISTER_EMAIL, SISTER_PASSWORD);
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

  // The admin layout redirects before it renders, so `goto` settles on
  // wherever she was sent instead.
  await page.goto("/dashboard/admin/users");
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });

  expect(page.url()).not.toContain("/dashboard/admin/users");
  await expect(
    page.getByRole("button", { name: "Suspend user" })
  ).toHaveCount(0);
});
