/**
 * Subject Folder — the unified per-subject view.
 *
 * One screen per subject. Lists every "Class" (a `lessons` row) with its
 * meeting link, recording, and attached resources inline. Replaces the
 * fragmented Live Hub + Resources flow as the primary instructor surface.
 *
 * Data model:
 *   subject (1) → classes (many `lessons` rows) → resources (many files
 *   per class via `resources.lesson_id`)
 *
 * Both instructors (their own subject) and admins (any subject) can use
 * this page; RLS already permits both.
 *
 * ─── Presentation ──────────────────────────────────────────────────────────
 *
 * Re-skinned onto the shared course surface (`@/components/course/*`), so an
 * admin moving from the course workspace into a subject — and a student
 * looking at the same subject in the hub — see one visual language: cream
 * page, white course cards with a hairline rose edge, Poppins headings.
 *
 * Every query, cast and prop below is untouched by that re-skin. Nothing on
 * this file reads or writes `lessons.recording_url`; it only hands the rows to
 * `LessonList`.
 */
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Calendar, ClipboardCheck, ExternalLink, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDashboardViewer } from "@/lib/auth-helpers";
import {
  CoursePageHeader,
  type CourseBadge,
} from "@/components/course/course-page-header";
import {
  courseButton,
  courseButtonPrimary,
  courseCard,
  iconTints,
} from "@/components/course/course-surface";
import { type ManagedQuiz } from "./quiz-manager";
import { SubjectTabs, type GradebookData } from "./subject-tabs";
import {
  hasRecurringSchedule,
  isLiveNow,
  scheduleDisplayLabel,
} from "@/lib/recurring-schedule";
import type { Lesson, Resource, Subject } from "@/lib/types/database";

const OFFERING_STATUS_BADGES: Record<string, CourseBadge> = {
  draft: { label: "Draft", tone: "warning" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "muted" },
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function SubjectFolderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const viewer = await getDashboardViewer();
  if (!viewer) return null;

  const { data: subject } = await supabase
    .from("subjects")
    .select(
      "*, offering:offerings(id, title, slug, status), instructor:profiles!subjects_instructor_id_fkey(id, full_name)"
    )
    .eq("id", id)
    .single();

  if (!subject) notFound();

  // Hard scope: instructors enter their own subjects; a Teaching Assistant
  // enters subjects on a course they're assigned to; admins enter any. RLS
  // would reject writes anyway, but this gives a clean 404 instead of a
  // half-rendered page with empty actions.
  if (
    !viewer.isAdmin &&
    subject.instructor_id !== viewer.userId &&
    !viewer.assistedOfferingIds.includes(subject.offering_id)
  ) {
    notFound();
  }

  const { data: lessonsData } = await supabase
    .from("lessons")
    .select("*")
    .eq("subject_id", id)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .order("sort_order", { ascending: true });

  const lessons: Lesson[] = (lessonsData as Lesson[]) || [];
  const lessonIds = lessons.map((l) => l.id);

  // Pull every resource attached to these classes in one shot — the
  // client component will group them by lesson_id for inline display.
  let resources: Resource[] = [];
  if (lessonIds.length > 0) {
    const { data: resourcesData } = await supabase
      .from("resources")
      .select("*")
      .in("lesson_id", lessonIds)
      .order("created_at", { ascending: false });
    resources = (resourcesData as Resource[]) || [];
  }

  // ── Built-in quizzes on this subject (migration 034) ──
  // Staff read every quiz incl. the answer key (RLS allows it); students
  // never reach this query. attempt_count drives the "locked" state.
  const { data: quizRows } = await supabase
    .from("quizzes")
    .select(
      "id, title, instructions, is_published, quiz_questions(id, text, marks, question_type, sort_order, quiz_options(id, text, is_correct, sort_order))"
    )
    .eq("subject_id", id)
    .order("created_at", { ascending: true });

  const quizIds = (quizRows ?? []).map((q: { id: string }) => q.id);
  const attemptCounts: Record<string, number> = {};
  if (quizIds.length > 0) {
    const { data: attemptRows } = await supabase
      .from("quiz_attempts")
      .select("quiz_id")
      .in("quiz_id", quizIds);
    for (const a of (attemptRows as { quiz_id: string }[]) ?? []) {
      attemptCounts[a.quiz_id] = (attemptCounts[a.quiz_id] ?? 0) + 1;
    }
  }

  type QuizRow = {
    id: string;
    title: string;
    instructions: string | null;
    is_published: boolean;
    quiz_questions: {
      id: string;
      text: string;
      marks: number;
      question_type?: string;
      sort_order: number;
      quiz_options: { id: string; text: string; is_correct: boolean; sort_order: number }[];
    }[];
  };
  const managedQuizzes: ManagedQuiz[] = ((quizRows as QuizRow[]) ?? []).map((q) => ({
    id: q.id,
    title: q.title,
    instructions: q.instructions,
    is_published: q.is_published,
    attempt_count: attemptCounts[q.id] ?? 0,
    questions: [...(q.quiz_questions ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((qq) => ({
        id: qq.id,
        text: qq.text,
        marks: Number(qq.marks),
        question_type: (qq.question_type as any) || "multiple_choice",
        options: [...(qq.quiz_options ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((o) => ({ id: o.id, text: o.text, is_correct: o.is_correct })),
      })),
  }));

  // ── Gradebook data (module 4) ──
  // Rows = enrolled students; columns = published quizzes (read-only %) plus
  // manual assessments (editable). Marks come from assessment_grades; quiz
  // percentages come straight from quiz_attempts. Staff RLS permits all reads.
  const gbQuizzes = managedQuizzes
    .filter((q) => q.is_published)
    .map((q) => ({ id: q.id, title: q.title }));

  const { data: enrollRows } = await supabase
    .from("enrollments")
    .select("student:profiles!enrollments_student_id_fkey(id, full_name)")
    .eq("offering_id", subject.offering_id)
    .eq("status", "approved");
  type EnrolledStudent = { id: string; full_name: string };
  const gbStudents = ((enrollRows ?? []) as unknown as {
    student: EnrolledStudent | EnrolledStudent[] | null;
  }[])
    .map((r) => (Array.isArray(r.student) ? r.student[0] ?? null : r.student))
    .filter((st): st is EnrolledStudent => !!st)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const { data: assessmentRows } = await supabase
    .from("assessments")
    .select("id, title, type, max_marks")
    .eq("subject_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const gbAssessments = ((assessmentRows ?? []) as {
    id: string;
    title: string;
    type: string;
    max_marks: number;
  }[]).map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type as GradebookData["assessments"][number]["type"],
    max_marks: Number(a.max_marks),
  }));

  const assessmentIds = gbAssessments.map((a) => a.id);
  let gbGrades: GradebookData["grades"] = [];
  if (assessmentIds.length > 0) {
    const { data: gradeRows } = await supabase
      .from("assessment_grades")
      .select("assessment_id, student_id, marks")
      .in("assessment_id", assessmentIds);
    gbGrades = ((gradeRows ?? []) as {
      assessment_id: string;
      student_id: string;
      marks: number;
    }[]).map((g) => ({
      assessment_id: g.assessment_id,
      student_id: g.student_id,
      marks: Number(g.marks),
    }));
  }

  let gbQuizScores: GradebookData["quizScores"] = [];
  if (quizIds.length > 0) {
    const { data: scoreRows } = await supabase
      .from("quiz_attempts")
      .select("quiz_id, student_id, percentage")
      .in("quiz_id", quizIds);
    gbQuizScores = ((scoreRows ?? []) as {
      quiz_id: string;
      student_id: string;
      percentage: number;
    }[]).map((sc) => ({
      quiz_id: sc.quiz_id,
      student_id: sc.student_id,
      percentage: Number(sc.percentage),
    }));
  }

  // ── Assignment Papers (PDF / File Question Papers) ──
  const { data: assignmentPaperRows } = await supabase
    .from("assignment_papers")
    .select("*, submissions:assignment_submissions(id, student_id, score)")
    .eq("subject_id", id)
    .order("created_at", { ascending: true });

  const managedFileAssignments = (assignmentPaperRows ?? []).map((a: any) => ({
    id: a.id,
    subject_id: a.subject_id,
    offering_id: a.offering_id,
    title: a.title,
    instructions: a.instructions,
    question_paper_url: a.question_paper_url,
    file_name: a.file_name,
    file_size: a.file_size ? Number(a.file_size) : null,
    max_marks: Number(a.max_marks),
    due_date: a.due_date,
    is_published: a.is_published,
    submission_count: (a.submissions ?? []).length,
    created_at: a.created_at,
  }));

  // ── Course Announcements (migration 047) ──
  // Fetch all announcements scoped to this subject, pinned first.
  const { data: announcementRows } = await supabase
    .from("course_announcements")
    .select("*")
    .eq("subject_id", id)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false });

  type AnnouncementRowRaw = {
    id: string;
    offering_id: string;
    subject_id: string | null;
    author_id: string | null;
    title: string;
    body: string;
    attachment_type: string;
    attachment_url: string | null;
    attachment_name: string | null;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
  };

  const announcements = (announcementRows as AnnouncementRowRaw[] ?? []) as import("./announcement-actions").CourseAnnouncementRow[];

  // Generate signed URLs for any attachments (private bucket).
  const attachmentPaths = announcements
    .map((a) => a.attachment_url)
    .filter((p): p is string => !!p);
  const announcementSignedUrls: Record<string, string> = {};
  if (attachmentPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("resources")
      .createSignedUrls(attachmentPaths, 60 * 60);
    for (const row of signed ?? []) {
      if (row.path && row.signedUrl)
        announcementSignedUrls[row.path] = row.signedUrl;
    }
  }

  // Merge published file assignments into Gradebook as assessments
  const fileAssignmentGbAssessments = (assignmentPaperRows ?? [])
    .filter((a: any) => a.is_published)
    .map((a: any) => ({
      id: a.id,
      title: a.title,
      type: "assignment" as const,
      max_marks: Number(a.max_marks),
    }));

  const fileAssignmentGbGrades: GradebookData["grades"] = [];
  for (const a of assignmentPaperRows ?? []) {
    for (const sub of (a.submissions ?? []) as { id: string; student_id: string; score: number | null }[]) {
      if (sub.score !== null) {
        fileAssignmentGbGrades.push({
          assessment_id: a.id,
          student_id: sub.student_id,
          marks: Number(sub.score),
        });
      }
    }
  }

  const gradebookData: GradebookData = {
    students: gbStudents,
    assessments: [...fileAssignmentGbAssessments, ...gbAssessments],
    quizzes: gbQuizzes,
    grades: [...fileAssignmentGbGrades, ...gbGrades],
    quizScores: gbQuizScores,
  };

  const offering = (
    subject as { offering?: { title?: string; status?: string } }
  ).offering;
  const instructorName = (subject as { instructor?: { full_name?: string } })
    .instructor?.full_name;

  const badges: CourseBadge[] = [];
  if (offering?.status && OFFERING_STATUS_BADGES[offering.status]) {
    badges.push(OFFERING_STATUS_BADGES[offering.status]);
  }

  // "Tajweed Programme · Ustadha Maryam · 8 classes" — the header's context
  // line. The instructor name only earns its place for an admin, who may be
  // looking at somebody else's subject.
  const context = [
    offering?.title || "Subject",
    viewer.isAdmin && instructorName ? instructorName : null,
    plural(lessons.length, "class", "classes"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <CoursePageHeader
        backHref="/dashboard/instructor"
        backLabel="Back to subjects"
        code={(subject as Subject).slug}
        name={subject.title}
        context={context}
        description={subject.description}
        badges={badges}
      />

      {/* Recurring class banner — shown when admin has set the per-subject
          schedule (URL + day + time). One Join button forever. */}
      {hasRecurringSchedule(subject as Subject) && (
        <RecurringClassBanner subject={subject as Subject} />
      )}

      {/* Quiz banner — mirrors what the student sees, so admin can verify
          the link is set correctly. */}
      {(subject as Subject).quiz_url && (
        <QuizBanner quizUrl={(subject as Subject).quiz_url!} />
      )}

      {/* Classes and the built-in quiz engine, as tabs — mirrors Naseeha's
          course-page Quizzes tab so an authored quiz is never below the fold. */}
      <SubjectTabs
        subjectId={id}
        offeringId={subject.offering_id}
        lessons={lessons}
        initialResources={resources}
        subjectRecurringMeetingUrl={(subject as Subject).recurring_meeting_url ?? null}
        quizzes={managedQuizzes}
        fileAssignments={managedFileAssignments}
        gradebook={gradebookData}
        announcements={announcements}
        announcementSignedUrls={announcementSignedUrls}
        viewerId={viewer.userId}
        viewerRole={viewer.role}
      />
    </div>
  );
}

function RecurringClassBanner({ subject }: { subject: Subject }) {
  const live = isLiveNow(subject);
  const label = scheduleDisplayLabel(subject) ?? "Recurring class";
  return (
    <div
      className={cn(
        courseCard,
        "flex flex-col gap-3 px-[18px] py-4 sm:flex-row sm:items-center",
        live && "border-sage-200 bg-sage-50 dark:border-emerald-900 dark:bg-emerald-950/20"
      )}
    >
      <div
        className={cn(
          "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px]",
          live ? iconTints.success : iconTints.brand
        )}
      >
        {live ? (
          <Radio className="h-[18px] w-[18px]" />
        ) : (
          <Calendar className="h-[18px] w-[18px]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-[13.5px] font-semibold">
            Recurring live class
          </h2>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-700 px-2 py-0.5 text-[10px] font-bold tracking-[0.05em] uppercase text-white dark:bg-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Live now
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          Same link every week:{" "}
          <span className="font-mono">{subject.recurring_meeting_url}</span>
        </p>
      </div>
      <a
        href={subject.recurring_meeting_url!}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          courseButtonPrimary,
          "press justify-center",
          live &&
            "border-sage-700 bg-sage-700 hover:border-sage-700/90 hover:bg-sage-700/90 dark:border-emerald-700 dark:bg-emerald-700"
        )}
      >
        Join Live
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function QuizBanner({ quizUrl }: { quizUrl: string }) {
  return (
    <div
      className={cn(
        courseCard,
        "flex flex-col gap-3 px-[18px] py-4 sm:flex-row sm:items-center"
      )}
    >
      <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-steel-50 text-steel-700 dark:bg-sky-950/50 dark:text-sky-300">
        <ClipboardCheck className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-[13.5px] font-semibold">Quiz</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Students see a “Take Quiz” button on this subject that opens in a new
          tab.
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          <span className="font-mono">{quizUrl}</span>
        </p>
      </div>
      <a
        href={quizUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(courseButton, "press justify-center")}
      >
        <ClipboardCheck className="h-4 w-4" />
        Open Quiz
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
