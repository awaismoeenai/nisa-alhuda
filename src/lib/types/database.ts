/**
 * TypeScript types matching our Supabase database schema.
 * These ensure type safety across the entire application.
 *
 * In a production app, you'd auto-generate these with:
 *   npx supabase gen types typescript --project-id mcatnaujwuuqymbtotnr
 * For now, we define them manually to match our migration.
 */

export type UserRole = "admin" | "instructor" | "student" | "treasurer" | "ta";
export type OfferingType = "program" | "course" | "workshop" | "class";
export type FeeType = "one_time" | "monthly";
export type OfferingMode = "online" | "onsite" | "hybrid";
export type OfferingStatus = "draft" | "published" | "archived";
export type EnrollmentStatus = "pending" | "approved" | "rejected";
export type NotificationType =
  | "enrollment_approved"
  | "enrollment_rejected"
  | "fa_approved"
  | "fa_rejected"
  | "new_lesson"
  | "new_announcement"
  | "general";

export type QuizQuestionType =
  | "multiple_choice"
  | "true_false"
  | "multi_select"
  | "ordering"
  | "fill_in_blank";

// ─── Row Types (what you GET from the database) ───

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  /** Primary role — drives landing dashboard and existing RLS. Always present in `roles[]`. */
  role: UserRole;
  /** All roles the user holds (includes primary). Use for feature-access checks. */
  roles: UserRole[];
  phone: string | null;
  is_suspended: boolean;
  must_change_password: boolean;
  /**
   * Admin manual lock override.
   *  null  → auto (payment-block logic decides)
   *  true  → force-locked regardless of payment status
   *  false → force-unlocked regardless of payment status
   *
   * The four lock_override_* fields are `undefined` on every user-scoped
   * read: migration 046 revoked them from anon/authenticated, so only
   * service-role queries (PROFILE_SELECT_ADMIN) populate them. A student
   * reads her own via the `my_lock_state()` RPC.
   */
  lock_override?: boolean | null;
  /** Optional admin note explaining why the override was set. */
  lock_override_note?: string | null;
  /** When the override was last changed. */
  lock_override_at?: string | null;
  /** Which admin set the override. */
  lock_override_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The part of a profile an unsigned visitor may read — the public
 * catalogue columns and nothing else. Mirrors `PROFILE_SELECT_PUBLIC`
 * and the `anon` column GRANT in migration 050, which deliberately
 * leaves out `phone`, `is_suspended` and `must_change_password`.
 *
 * Any query a logged-out caller can reach must select this shape. Asking
 * for a column `anon` was not granted makes PostgREST refuse the whole
 * request with 401, not just drop the column.
 */
export type PublicProfile = Pick<
  Profile,
  "id" | "full_name" | "avatar_url" | "role" | "roles" | "created_at" | "updated_at"
>;

/**
 * Returns true if the given profile holds `target` role in either the
 * primary `role` slot or the additional `roles[]` array. Mirrors the
 * server-side `has_role()` SQL function for client-side capability checks.
 */
export function profileHasRole(
  profile: Pick<Profile, "role" | "roles"> | null | undefined,
  target: UserRole
): boolean {
  if (!profile) return false;
  if (profile.role === target) return true;
  return Array.isArray(profile.roles) && profile.roles.includes(target);
}

/** A TA ↔ course assignment row (migration 038). Scopes a TA to a course. */
export interface CourseAssistant {
  id: string;
  offering_id: string;
  assistant_id: string;
  assigned_by: string | null;
  created_at: string;
}

export interface Offering {
  id: string;
  title: string;
  slug: string;
  description: string;
  short_description: string | null;
  type: OfferingType;
  price: number;
  /** India INR fee. When set, the 🇮🇳 India region charges this amount instead of PKR. */
  price_inr: number | null;
  /** International USD fee. When set, the wizard surfaces a 3rd payment region. */
  price_usd: number | null;
  thumbnail_url: string | null;
  status: OfferingStatus;
  instructor_id: string | null;
  schedule_start: string | null;
  fee_type: FeeType;
  mode: OfferingMode;
  schedule_end: string | null;
  live_class_link: string | null;
  is_featured: boolean;
  is_new: boolean;
  /** Marks a class that is already running but still accepting new joiners — renders an "On-going" badge. */
  is_ongoing: boolean;
  /** WhatsApp group invite link — displayed prominently to enrolled students on the offering page. */
  whatsapp_link: string | null;
  /** When true, new enrollments are blocked and an "Admission Closed!" label replaces "Enroll Now". */
  admission_closed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  offering_id: string;
  title: string;
  slug: string;
  description: string | null;
  instructor_id: string;
  sort_order: number;
  /** Stable Zoom/Meet URL used for every weekly class. */
  recurring_meeting_url: string | null;
  /** Free-text human label like "Mondays 6–7 PM PKT". Shown to students. */
  recurring_schedule_label: string | null;
  /** 0=Sun, 1=Mon, … 6=Sat. Same as JS Date.getDay(). */
  recurring_day_of_week: number | null;
  /** Local-time start, e.g. "18:00:00". */
  recurring_start_time: string | null;
  /** Defaults to 60. Used for live-now detection. */
  recurring_duration_minutes: number | null;
  /** External quiz link (e.g. Google Form). Renders a "Take Quiz" button. */
  quiz_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  id: string;
  offering_id: string;
  subject_id: string | null;
  title: string;
  description: string | null;
  scheduled_at: string | null;
  live_class_link: string | null;
  recording_url: string | null;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  lesson_id: string;
  title: string;
  file_url: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export interface StudentDetails {
  first_name: string;
  last_name: string;
  phone: string;
  city: string;
  /** Country name (ISO-ish). Drives auto currency selection: Pakistan → PKR, India → INR, other → USD. */
  country?: string;
  age: string;
  education_level: string;
  referral_source: string;
  message: string;
}

export interface Enrollment {
  id: string;
  student_id: string | null;
  offering_id: string;
  applicant_email: string;
  status: EnrollmentStatus;
  payment_receipt_url: string | null;
  payment_amount: number;
  payment_method: string;
  /** Currency the student paid in: 'PKR' | 'INR' | 'USD'. Defaults to 'PKR'. */
  payment_currency: string;
  student_details: StudentDetails | null;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // Financial Assistance fields
  fa_requested: boolean;
  fa_reason: string | null;
  fa_income_range: string | null;
  fa_offered_amount: number | null;
  fa_approved_amount: number | null;
  fa_decision_note: string | null;
  fa_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatRoom {
  id: string;
  offering_id: string;
  subject_id: string | null;
  name: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Announcement {
  id: string;
  author_id: string;
  title: string;
  body: string;
  offering_id: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface LessonProgress {
  id: string;
  student_id: string;
  lesson_id: string;
  offering_id: string;
  completed_at: string;
}

export interface LiveSession {
  id: string;
  instructor_id: string;
  offering_id: string;
  title: string;
  description: string | null;
  meeting_url: string;
  scheduled_at: string;
  duration_minutes: number;
  created_at: string;
  updated_at: string;
}

export type MonthlyPaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  /**
   * Cron-created placeholder — the cycle has started but the student
   * hasn't uploaded a receipt yet. Flips to 'pending' when she submits.
   */
  | "owed";

export interface MonthlyPayment {
  id: string;
  enrollment_id: string;
  student_id: string;
  offering_id: string;
  /** First-of-month date the cycle covers (e.g. "2026-04-01"). */
  cycle_month: string;
  amount: number;
  currency: string;
  payment_method: string;
  receipt_url: string | null;
  /**
   * Name used on the bank transfer — captured on the monthly payment
   * upload page so admin can match the bank reference even when the
   * sister sent via a relative's account. Pre-filled from
   * profile.full_name on the form.
   */
  sender_name: string | null;
  status: MonthlyPaymentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  /**
   * Free-text note recorded when admin approved this cycle WITHOUT a
   * receipt (payment_method='admin_recorded'). Audit trail only —
   * never shown to the sister.
   */
  manual_note: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Joined / Extended Types (for queries with relations) ───

export interface OfferingWithSubjects extends Offering {
  subjects: (Subject & { instructor: Profile })[];
}

export interface OfferingWithInstructor extends Offering {
  instructor: Profile | null;
}

export interface EnrollmentWithDetails extends Enrollment {
  student: Profile;
  offering: Offering;
}

export interface ChatMessageWithSender extends ChatMessage {
  sender: Profile;
}

export interface AnnouncementWithAuthor extends Announcement {
  author: Profile;
  offering: Offering | null;
}

export interface LiveSessionWithDetails extends LiveSession {
  instructor: Profile;
  offering: Offering;
}
