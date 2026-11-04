/**
 * Seed one test account per role, and enroll them into the published programs.
 *
 * Roles in this app are two-layered (see migration 022): `profiles.role` is the
 * PRIMARY role and still drives every pre-022 RLS policy via get_user_role(),
 * while `profiles.roles[]` is additive and is what has_role() reads. A test
 * account that only set `roles[]` would pass has_role() checks and fail the
 * older policies, so each account below sets the primary role and lets the
 * trg_sync_primary_role_into_roles trigger mirror it into the array.
 *
 * Enrollment matters for more than the student: neither /dashboard/student nor
 * the learning hub is gated on role — both are gated on an APPROVED enrollment.
 * So every role account is enrolled, otherwise you cannot check what an admin
 * or treasurer actually sees in the student-facing surfaces.
 *
 * Usage: npx tsx scripts/seed-test-accounts.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing environment variables. Run: npm run env:local");
  process.exit(1);
}

// Same guard as seed-e2e-user.ts: this writes accounts with known passwords.
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error(
    `Refusing to run against a non-local backend (${supabaseUrl}).\n` +
      "This script writes known-password test accounts — local stack only."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD || "QaNisa#2026$Rx7";

type Role = "admin" | "instructor" | "ta" | "treasurer" | "student";

interface TestAccount {
  email: string;
  fullName: string;
  role: Role;
  /** Additional roles written to profiles.roles[] alongside the primary. */
  extraRoles?: Role[];
  /** "approved" for normal accounts; "pending" exercises the review queue. */
  enrollAs: "approved" | "pending";
  note: string;
}

const ACCOUNTS: TestAccount[] = [
  {
    email: "qa.admin@nisaalhuda.com",
    fullName: "QA Admin",
    role: "admin",
    enrollAs: "approved",
    note: "full admin powers",
  },
  {
    email: "qa.instructor@nisaalhuda.com",
    fullName: "QA Instructor",
    role: "instructor",
    enrollAs: "approved",
    note: "teaches the seeded Tajweed subject",
  },
  {
    email: "qa.ta@nisaalhuda.com",
    fullName: "QA Teaching Assistant",
    role: "ta",
    enrollAs: "approved",
    note: "course assistant on both programs",
  },
  {
    email: "qa.treasurer@nisaalhuda.com",
    fullName: "QA Treasurer",
    role: "treasurer",
    enrollAs: "approved",
    note: "payments + financial assistance review",
  },
  {
    email: "qa.student@nisaalhuda.com",
    fullName: "QA Student",
    role: "student",
    enrollAs: "approved",
    note: "plain approved student",
  },
  {
    email: "qa.multirole@nisaalhuda.com",
    fullName: "QA Instructor-Treasurer",
    role: "instructor",
    extraRoles: ["treasurer"],
    enrollAs: "approved",
    note: "exercises profiles.roles[] / has_role()",
  },
  {
    email: "qa.applicant@nisaalhuda.com",
    fullName: "QA Applicant",
    role: "student",
    enrollAs: "pending",
    note: "pending enrollment for the approval queue",
  },
];

/** Create the auth user, or reset the password if it already exists. */
async function ensureUser(account: TestAccount): Promise<string> {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: account.fullName },
  });

  if (created?.user) return created.user.id;

  if (!error?.message.includes("already been registered")) {
    throw new Error(`${account.email}: ${error?.message}`);
  }

  // listUsers() is paginated at 50 by default and this project already seeds
  // ~10 instructors, so ask for a page big enough to hold everyone.
  const { data: list } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const existing = list?.users.find((u) => u.email === account.email);
  if (!existing) throw new Error(`${account.email}: exists but was not listed`);

  await supabase.auth.admin.updateUserById(existing.id, { password: PASSWORD });
  return existing.id;
}

async function main() {
  console.log("Seeding role test accounts...\n");

  const { data: offerings, error: offeringError } = await supabase
    .from("offerings")
    .select("id, title, slug, price, fee_type")
    .eq("status", "published")
    .order("created_at");

  if (offeringError) throw new Error(offeringError.message);
  if (!offerings?.length) {
    console.error("No published offerings. Run: npm run seed");
    process.exit(1);
  }

  console.log(`Programs found: ${offerings.length}`);
  offerings.forEach((o) => console.log(`   - ${o.title} (${o.fee_type})`));
  console.log();

  const ids: Record<string, string> = {};

  // ─── 1. Accounts ────────────────────────────────────────────
  for (const account of ACCOUNTS) {
    const userId = await ensureUser(account);
    ids[account.email] = userId;

    // The trigger appends the primary role, so roles[] only needs the extras.
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: account.fullName,
        role: account.role,
        roles: [account.role, ...(account.extraRoles ?? [])],
      })
      .eq("id", userId);

    if (error) throw new Error(`${account.email} profile: ${error.message}`);

    const roleLabel = account.extraRoles
      ? `${account.role} + ${account.extraRoles.join(", ")}`
      : account.role;
    console.log(`   ✓ ${account.email.padEnd(34)} ${roleLabel}`);
  }

  const adminId = ids["qa.admin@nisaalhuda.com"];

  // ─── 2. Enrollments ─────────────────────────────────────────
  console.log("\nEnrolling accounts into programs...");

  for (const account of ACCOUNTS) {
    for (const offering of offerings) {
      const approved = account.enrollAs === "approved";

      const row = {
        student_id: ids[account.email],
        offering_id: offering.id,
        applicant_email: account.email,
        status: account.enrollAs,
        payment_amount: offering.price ?? 0,
        payment_method: "bank_transfer",
        payment_currency: "PKR",
        payment_receipt_url: "test/receipt.jpg",
        student_details: {
          full_name: account.fullName,
          phone: "+920000000000",
          city: "Karachi",
          country: "Pakistan",
        },
        reviewed_by: approved ? adminId : null,
        reviewed_at: approved ? new Date().toISOString() : null,
      };

      // The unique key is (applicant_email, offering_id), not (student_id, …) —
      // migration 011 swapped it when guest enrollment made student_id nullable.
      const { error } = await supabase
        .from("enrollments")
        .upsert(row, { onConflict: "applicant_email,offering_id" });

      if (error) {
        throw new Error(
          `${account.email} → ${offering.slug}: ${error.message}`
        );
      }
    }
    console.log(
      `   ✓ ${account.email.padEnd(34)} ${offerings.length} × ${account.enrollAs}`
    );
  }

  // ─── 3. Role-specific wiring ────────────────────────────────
  console.log("\nWiring role-specific access...");

  // A TA is only meaningful once scoped to a course (migrations 038 / 039).
  for (const offering of offerings) {
    const { error } = await supabase.from("course_assistants").upsert(
      {
        offering_id: offering.id,
        assistant_id: ids["qa.ta@nisaalhuda.com"],
        assigned_by: adminId,
      },
      { onConflict: "offering_id,assistant_id" }
    );
    if (error) throw new Error(`TA → ${offering.slug}: ${error.message}`);
  }
  console.log(`   ✓ TA assigned as course assistant on ${offerings.length} program(s)`);

  // The instructor RLS policy keys off subjects.instructor_id, so the test
  // instructor needs to own a subject before they can see any enrollment.
  const tajweed = offerings.find((o) => o.slug === "treasures-of-tajweed");
  if (tajweed) {
    await ensureInstructorSubject(tajweed.id, ids["qa.instructor@nisaalhuda.com"]);
  }

  // ─── 4. Summary ─────────────────────────────────────────────
  console.log("\n" + "─".repeat(62));
  console.log(`Test accounts ready — password for all: ${PASSWORD}\n`);
  for (const account of ACCOUNTS) {
    console.log(`   ${account.email.padEnd(34)} ${account.note}`);
  }
  console.log("─".repeat(62));
}

/**
 * Give the test instructor a subject with published, scheduled lessons.
 *
 * scheduled_at is not optional here: partitionLessons() treats a lesson with
 * neither a schedule nor a live link as a downloadable-resource holder rather
 * than a class, so an unscheduled lesson never reaches the lesson list.
 */
async function ensureInstructorSubject(offeringId: string, instructorId: string) {
  const { data: existing } = await supabase
    .from("subjects")
    .select("id")
    .eq("offering_id", offeringId)
    .eq("slug", "tajweed-foundations")
    .maybeSingle();

  let subjectId = existing?.id;

  if (!subjectId) {
    const { data, error } = await supabase
      .from("subjects")
      .insert({
        offering_id: offeringId,
        title: "Tajweed — Foundations",
        slug: "tajweed-foundations",
        description: "Seeded subject owned by the QA instructor account.",
        instructor_id: instructorId,
        sort_order: 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(`subject: ${error.message}`);
    subjectId = data.id;
  } else {
    await supabase
      .from("subjects")
      .update({ instructor_id: instructorId })
      .eq("id", subjectId);
  }

  const { count } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .eq("subject_id", subjectId);

  if ((count ?? 0) > 0) {
    console.log(`   ✓ Instructor owns "Tajweed — Foundations" (${count} lessons)`);
    return;
  }

  const start = new Date("2026-11-09T10:00:00.000Z");
  const lessons = [1, 2, 3, 4].map((n) => {
    const scheduledAt = new Date(start);
    scheduledAt.setUTCDate(start.getUTCDate() + (n - 1) * 7);
    return {
      offering_id: offeringId,
      subject_id: subjectId,
      title: `Tajweed Lesson ${n}`,
      description: `Seeded lesson ${n} for role testing.`,
      scheduled_at: scheduledAt.toISOString(),
      live_class_link: "https://example.com/live/seeded-class",
      sort_order: n,
      is_published: true,
    };
  });

  const { error } = await supabase.from("lessons").insert(lessons);
  if (error) throw new Error(`lessons: ${error.message}`);

  console.log(`   ✓ Instructor owns "Tajweed — Foundations" (${lessons.length} lessons)`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
