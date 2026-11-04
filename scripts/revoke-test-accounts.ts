/**
 * Revoke the first generation of test credentials.
 *
 * Two different things are called "revoking" here, because the accounts are
 * not equivalent:
 *
 *   DELETE  — the `test.*` accounts. Pure test artifacts: nothing in the
 *             catalog depends on them once their own enrollments, course
 *             assistant rows and seeded subject are removed.
 *
 *   ROTATE  — the seed accounts. Six of them are the instructor of record on
 *             an offering or a subject, and both FKs are NO ACTION, so a
 *             delete would either fail or force stripping the instructor off
 *             your courses. Replacing the password with a long random string
 *             nobody holds retires the published credential while leaving the
 *             program structure intact.
 *
 * Deletion order matters: enrollments.student_id, enrollments.reviewed_by,
 * course_assistants.assigned_by and subjects.instructor_id are all NO ACTION,
 * so every one of them has to be cleared before auth.admin.deleteUser() can
 * cascade the profile away.
 *
 * Usage: npx tsx scripts/revoke-test-accounts.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing environment variables. Run: npm run env:local");
  process.exit(1);
}

if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error(
    `Refusing to run against a non-local backend (${supabaseUrl}).\n` +
      "This deletes accounts and rotates passwords — local stack only."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Generation-1 test accounts — removed entirely. */
const DELETE_EMAILS = [
  "test.admin@nisaalhuda.com",
  "test.instructor@nisaalhuda.com",
  "test.ta@nisaalhuda.com",
  "test.treasurer@nisaalhuda.com",
  "test.student@nisaalhuda.com",
  "test.multirole@nisaalhuda.com",
  "test.applicant@nisaalhuda.com",
];

/** Seed accounts that own program data — password retired, account kept. */
const ROTATE_EMAILS = [
  "admin@nisaalhuda.com",
  "instructor@nisaalhuda.com",
  "hafizah.binte.faisal@nisaalhuda.com",
  "neelam.ijaz@nisaalhuda.com",
  "sana.ahmed@nisaalhuda.com",
  "kareemunnisa@nisaalhuda.com",
  "sana.areeba@nisaalhuda.com",
  "binte.ashfaque@nisaalhuda.com",
  "binte.nisar@nisaalhuda.com",
];

async function allUsers() {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(error.message);
  return data.users;
}

async function main() {
  const users = await allUsers();
  const idFor = (email: string) => users.find((u) => u.email === email)?.id;

  const doomed = DELETE_EMAILS.map((e) => ({ email: e, id: idFor(e) })).filter(
    (x): x is { email: string; id: string } => Boolean(x.id)
  );
  const doomedIds = doomed.map((d) => d.id);

  console.log("Revoking generation-1 test credentials...\n");

  // ─── 1. Clear blocking references ───────────────────────────
  if (doomedIds.length) {
    // reviewed_by first: an enrollment reviewed by a doomed admin may belong
    // to someone who is NOT being deleted, so null the reviewer rather than
    // deleting the row.
    const { error: revErr } = await supabase
      .from("enrollments")
      .update({ reviewed_by: null, reviewed_at: null })
      .in("reviewed_by", doomedIds);
    if (revErr) throw new Error(`clear reviewed_by: ${revErr.message}`);

    const { error: caErr } = await supabase
      .from("course_assistants")
      .delete()
      .or(
        `assistant_id.in.(${doomedIds.join(",")}),assigned_by.in.(${doomedIds.join(",")})`
      );
    if (caErr) throw new Error(`course_assistants: ${caErr.message}`);

    const { error: enrErr } = await supabase
      .from("enrollments")
      .delete()
      .in("student_id", doomedIds);
    if (enrErr) throw new Error(`enrollments: ${enrErr.message}`);

    // Subjects owned by a doomed instructor, and their lessons.
    const { data: subjects } = await supabase
      .from("subjects")
      .select("id, title")
      .in("instructor_id", doomedIds);

    for (const subject of subjects ?? []) {
      const { error: lessonErr } = await supabase
        .from("lessons")
        .delete()
        .eq("subject_id", subject.id);
      if (lessonErr) throw new Error(`lessons: ${lessonErr.message}`);

      const { error: subErr } = await supabase
        .from("subjects")
        .delete()
        .eq("id", subject.id);
      if (subErr) throw new Error(`subject "${subject.title}": ${subErr.message}`);

      console.log(`   cleared subject "${subject.title}" and its lessons`);
    }
  }

  // ─── 2. Delete ──────────────────────────────────────────────
  console.log("\nDeleted:");
  for (const { email, id } of doomed) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw new Error(`${email}: ${error.message}`);
    console.log(`   ✓ ${email}`);
  }
  for (const email of DELETE_EMAILS) {
    if (!doomed.find((d) => d.email === email)) {
      console.log(`   - ${email} (was not present)`);
    }
  }

  // ─── 3. Rotate ──────────────────────────────────────────────
  console.log("\nPasswords rotated to random values (accounts kept):");
  for (const email of ROTATE_EMAILS) {
    const id = idFor(email);
    if (!id) {
      console.log(`   - ${email} (was not present)`);
      continue;
    }
    // 32 random bytes, base64url — not stored, not printed, not recoverable.
    const fresh = randomBytes(32).toString("base64url");
    const { error } = await supabase.auth.admin.updateUserById(id, {
      password: fresh,
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    console.log(`   ✓ ${email}`);
  }

  console.log(
    "\nRotated passwords were generated in memory and discarded — nobody holds them."
  );
  console.log("Use scripts/login-link.ts if you ever need into one of those accounts.");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
