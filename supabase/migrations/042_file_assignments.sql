-- ============================================================
-- Migration 042: PDF / File Upload Assignments & Grading
-- ============================================================
-- Enables instructors to upload Question Papers (PDF/Docs),
-- and students to submit completed Answer Sheets for grading.

CREATE TABLE IF NOT EXISTS public.assignment_papers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id          UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  offering_id         UUID NOT NULL REFERENCES public.offerings(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  instructions        TEXT,
  question_paper_url  TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  file_size           BIGINT,
  max_marks           NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK (max_marks > 0),
  due_date            TIMESTAMPTZ,
  is_published        BOOLEAN NOT NULL DEFAULT false,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignment_papers_subject_idx ON public.assignment_papers (subject_id);
CREATE INDEX IF NOT EXISTS assignment_papers_offering_idx ON public.assignment_papers (offering_id);

CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id       UUID NOT NULL REFERENCES public.assignment_papers(id) ON DELETE CASCADE,
  student_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answer_sheet_url    TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  file_size           BIGINT,
  score               NUMERIC(7,2) CHECK (score >= 0),
  feedback            TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  graded_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  graded_at           TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS assignment_submissions_assignment_idx ON public.assignment_submissions (assignment_id);
CREATE INDEX IF NOT EXISTS assignment_submissions_student_idx ON public.assignment_submissions (student_id);

-- RLS Security
ALTER TABLE public.assignment_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;

-- Production had these tables and policies created by hand, outside the
-- migration history, so a push that reached this file aborted on
-- `policy "assignment_papers_select" ... already exists` (SQLSTATE 42710)
-- and rolled the whole migration back -- which also silently skipped the four
-- indexes above, leaving them absent in production. CREATE POLICY has no
-- IF NOT EXISTS, so drop-then-create is the only idempotent form; 044 and 047
-- already use this pattern. Dropping is safe: every policy is recreated
-- verbatim below, in the same transaction.
DROP POLICY IF EXISTS assignment_papers_select ON public.assignment_papers;
DROP POLICY IF EXISTS assignment_papers_staff_write ON public.assignment_papers;
DROP POLICY IF EXISTS assignment_submissions_select ON public.assignment_submissions;
DROP POLICY IF EXISTS assignment_submissions_student_write ON public.assignment_submissions;
DROP POLICY IF EXISTS assignment_submissions_student_update ON public.assignment_submissions;
DROP POLICY IF EXISTS assignment_submissions_staff_all ON public.assignment_submissions;

-- Assignment Papers policies
CREATE POLICY assignment_papers_select ON public.assignment_papers FOR SELECT
  USING (
    has_role('admin') OR has_role('instructor')
    OR (is_published AND is_enrolled(offering_id))
  );

CREATE POLICY assignment_papers_staff_write ON public.assignment_papers FOR ALL
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));

-- Assignment Submissions policies
-- Student sees only their own submission; staff see all submissions
CREATE POLICY assignment_submissions_select ON public.assignment_submissions FOR SELECT
  USING (
    student_id = auth.uid()
    OR has_role('admin') OR has_role('instructor')
  );

-- Enrolled students can insert/update their own submission
CREATE POLICY assignment_submissions_student_write ON public.assignment_submissions FOR INSERT
  WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.assignment_papers a
      WHERE a.id = assignment_submissions.assignment_id
        AND a.is_published
        AND is_enrolled(a.offering_id)
    )
  );

CREATE POLICY assignment_submissions_student_update ON public.assignment_submissions FOR UPDATE
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY assignment_submissions_staff_all ON public.assignment_submissions FOR ALL
  USING (has_role('admin') OR has_role('instructor'))
  WITH CHECK (has_role('admin') OR has_role('instructor'));
