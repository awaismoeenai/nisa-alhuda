/**
 * Print a one-click browser login URL for a local test account.
 *
 * The login page renders a Google button and nothing else (see
 * src/app/(auth)/login/login-form.tsx), so the password on a seeded test
 * account cannot be typed in anywhere — it only works through the Supabase
 * API. Rather than add a dev-only password form to a production page, this
 * mints the magic-link token the auth callback already understands:
 * /auth/callback accepts `token_hash` + `type=magiclink` and verifies it
 * with verifyOtp, which is the same path a real magic-link email takes.
 *
 * Usage:
 *   npx tsx scripts/login-link.ts                      # every test account
 *   npx tsx scripts/login-link.ts qa.ta@nisaalhuda.com
 *   npx tsx scripts/login-link.ts qa.admin@nisaalhuda.com /dashboard/admin
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing environment variables. Run: npm run env:local");
  process.exit(1);
}

if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error(
    `Refusing to run against a non-local backend (${supabaseUrl}).\n` +
      "This mints a login token that bypasses sign-in — local stack only."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_EMAILS = [
  "qa.admin@nisaalhuda.com",
  "qa.instructor@nisaalhuda.com",
  "qa.ta@nisaalhuda.com",
  "qa.treasurer@nisaalhuda.com",
  "qa.student@nisaalhuda.com",
  "qa.multirole@nisaalhuda.com",
  "qa.applicant@nisaalhuda.com",
];

async function linkFor(email: string, next: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) throw new Error(`${email}: ${error.message}`);

  const hashed = data.properties?.hashed_token;
  if (!hashed) throw new Error(`${email}: no hashed_token returned`);

  const url = new URL("/auth/callback", siteUrl);
  url.searchParams.set("token_hash", hashed);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", next);
  return url.toString();
}

async function main() {
  const [emailArg, nextArg] = process.argv.slice(2);
  const emails = emailArg ? [emailArg] : DEFAULT_EMAILS;
  const next = nextArg || "/dashboard";

  console.log(`\nOne-click login links (site: ${siteUrl}, landing: ${next})`);
  console.log("Each token is single-use — rerun this script for a fresh one.\n");

  for (const email of emails) {
    console.log(`${email}`);
    console.log(`  ${await linkFor(email, next)}\n`);
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
