"use client";

/**
 * Subject workspace tabs — Classes · Quizzes · Gradebook · Announcements.
 *
 * Ported from Naseeha's course-page tab structure (see
 * `@/components/course/course-tabs`). The subject page used to stack the
 * lesson list and the quiz manager on one long scroll; a quiz authored below
 * the fold was easy to miss. Naseeha surfaces quizzes and grading as their own
 * tabs, so a Nisa subject now does too.
 *
 * This is presentation only: `LessonList`, `QuizManager`, `GradebookPanel`
 * and `AnnouncementsPanel` are unchanged and receive exactly the props they
 * always did. No query, no write, and nothing touching `recording_url` lives
 * here — it only chooses which existing panel is on screen.
 */

import { useState, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { BookOpen, FileQuestion, GraduationCap, Megaphone } from "lucide-react";
import { CourseTabs, type CourseTab } from "@/components/course/course-tabs";
import { LessonList } from "./lesson-list";
import { QuizManager, type ManagedQuiz } from "./quiz-manager";
import {
  GradebookPanel,
  type GbStudent,
  type GbAssessment,
  type GbQuiz,
  type GbGrade,
  type GbQuizScore,
} from "./gradebook-panel";
import { FileAssignmentManager } from "./file-assignment-manager";
import { AnnouncementsPanel } from "./announcements-panel";
import type { CourseAnnouncementRow } from "./announcement-actions";
import type { AssignmentPaperRow } from "./assignment-actions";
import type { Lesson, Resource } from "@/lib/types/database";

export interface GradebookData {
  students: GbStudent[];
  assessments: GbAssessment[];
  quizzes: GbQuiz[];
  grades: GbGrade[];
  quizScores: GbQuizScore[];
}

type SubjectTabKey = "classes" | "quizzes" | "gradebook" | "announcements";

export function SubjectTabs({
  subjectId,
  offeringId,
  lessons,
  initialResources,
  subjectRecurringMeetingUrl,
  quizzes,
  fileAssignments = [],
  gradebook,
  announcements = [],
  announcementSignedUrls = {},
  viewerId,
  viewerRole,
}: {
  subjectId: string;
  offeringId: string;
  lessons: Lesson[];
  initialResources: Resource[];
  subjectRecurringMeetingUrl?: string | null;
  quizzes: ManagedQuiz[];
  fileAssignments?: AssignmentPaperRow[];
  gradebook: GradebookData;
  announcements?: CourseAnnouncementRow[];
  announcementSignedUrls?: Record<string, string>;
  viewerId: string;
  viewerRole: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab") as SubjectTabKey | null;
  const validTabs: SubjectTabKey[] = ["classes", "quizzes", "gradebook", "announcements"];
  const [active, setActive] = useState<SubjectTabKey>(
    tabParam && validTabs.includes(tabParam) ? tabParam : "classes"
  );

  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam)) {
      setActive(tabParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  function handleTabChange(tab: SubjectTabKey) {
    setActive(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const totalAssessments = quizzes.length + fileAssignments.length;
  const tabs: readonly CourseTab<SubjectTabKey>[] = [
    { key: "classes", label: "Classes", icon: BookOpen },
    {
      key: "quizzes",
      label: totalAssessments > 0 ? `Quizzes & Papers · ${totalAssessments}` : "Quizzes",
      icon: FileQuestion,
    },
    { key: "gradebook", label: "Gradebook", icon: GraduationCap },
    {
      key: "announcements",
      label: announcements.length > 0 ? `Announcements · ${announcements.length}` : "Announcements",
      icon: Megaphone,
    },
  ];

  return (
    <div className="space-y-5">
      <CourseTabs
        tabs={tabs}
        active={active}
        onChange={handleTabChange}
        label="Subject section"
      />

      {active === "classes" && (
        <LessonList
          subjectId={subjectId}
          offeringId={offeringId}
          lessons={lessons}
          initialResources={initialResources}
          subjectRecurringMeetingUrl={subjectRecurringMeetingUrl}
        />
      )}

      {active === "quizzes" && (
        <div className="space-y-6">
          <QuizManager
            subjectId={subjectId}
            offeringId={offeringId}
            quizzes={quizzes}
          />

          <FileAssignmentManager
            subjectId={subjectId}
            offeringId={offeringId}
            assignments={fileAssignments}
          />
        </div>
      )}

      {active === "gradebook" && (
        <GradebookPanel
          subjectId={subjectId}
          offeringId={offeringId}
          students={gradebook.students}
          assessments={gradebook.assessments}
          quizzes={gradebook.quizzes}
          grades={gradebook.grades}
          quizScores={gradebook.quizScores}
        />
      )}

      {active === "announcements" && (
        <AnnouncementsPanel
          subjectId={subjectId}
          offeringId={offeringId}
          announcements={announcements}
          signedUrls={announcementSignedUrls}
          viewerId={viewerId}
          viewerRole={viewerRole}
        />
      )}
    </div>
  );
}
