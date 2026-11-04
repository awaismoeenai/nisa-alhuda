-- ============================================================
-- Migration 047: Course Announcements (per-offering)
-- ============================================================
-- Adds a `course_announcements` table separate from the global
-- `announcements` table (migration 005). These are scoped to a
-- specific offering (and optionally a subject) so admins and
-- instructors can post exam dates, results, class updates, etc.
-- Only enrolled students for that offering see them.
--
-- Attachment types:
--   'text'  → plain body only; no file
--   'pdf'   → body + attachment_url pointing to a PDF
--   'image' → body + attachment_url pointing to an image
--
-- Storage: attachments go into the private `resources` bucket
-- under the `course-announcements/<offering_id>/` prefix.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.course_announcements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id      UUID        NOT NULL REFERENCES public.offerings(id)  ON DELETE CASCADE,
  subject_id       UUID        REFERENCES public.subjects(id) ON DELETE SET NULL,
  -- Nullable on purpose: ON DELETE SET NULL cannot fire against a NOT NULL
  -- column, so deleting a staff profile would fail outright. Matches the
  -- created_by / graded_by convention in migrations 035 and 042.
  author_id        UUID        REFERENCES public.profiles(id)   ON DELETE SET NULL,
  title            TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body             TEXT        NOT NULL DEFAULT '',
  attachment_type  TEXT        NOT NULL DEFAULT 'text'
                               CHECK (attachment_type IN ('text', 'pdf', 'image')),
  attachment_url   TEXT,
  attachment_name  TEXT,
  is_pinned        BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_announcements_offering_idx
  ON public.course_announcements (offering_id, created_at DESC);

CREATE INDEX IF NOT EXISTS course_announcements_subject_idx
  ON public.course_announcements (subject_id)
  WHERE subject_id IS NOT NULL;

-- ── Reconcile a pre-existing table ───────────────────────────────────────────
-- This table was created by hand in production before it reached the migration
-- history, with author_id NOT NULL. CREATE TABLE IF NOT EXISTS above is a no-op
-- there, so the column definition never gets corrected -- and the
-- ON DELETE SET NULL on author_id_fkey can never fire against a NOT NULL
-- column, which is the exact failure this column is nullable to avoid.
-- DROP NOT NULL is idempotent, so this is a no-op on a freshly created table.
ALTER TABLE public.course_announcements ALTER COLUMN author_id DROP NOT NULL;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.course_announcements ENABLE ROW LEVEL SECURITY;

-- Production received an earlier revision of this file by hand, so four of the
-- six policies below already exist there (and the two TA policies do not).
-- CREATE POLICY has no IF NOT EXISTS: without these drops the push aborts with
-- SQLSTATE 42710 and rolls back, taking the TA policies and the storage grants
-- with it. Drop-then-create also guarantees the stale definitions are replaced
-- by the ones below rather than silently kept.
DROP POLICY IF EXISTS course_announcements_select    ON public.course_announcements;
DROP POLICY IF EXISTS course_announcements_insert    ON public.course_announcements;
DROP POLICY IF EXISTS course_announcements_update    ON public.course_announcements;
DROP POLICY IF EXISTS course_announcements_delete    ON public.course_announcements;
DROP POLICY IF EXISTS course_announcements_ta_insert ON public.course_announcements;
DROP POLICY IF EXISTS course_announcements_ta_update ON public.course_announcements;

CREATE POLICY course_announcements_select ON public.course_announcements FOR SELECT
  USING (
    public.has_role('admin'::user_role)
    OR public.has_role('instructor'::user_role)
    -- A TA is scoped at the database layer (migration 039): they cannot read
    -- a course they don't assist, so has_role('ta') alone would be too wide.
    OR public.assists_offering(offering_id)
    OR public.is_enrolled(offering_id)
  );

CREATE POLICY course_announcements_insert ON public.course_announcements FOR INSERT
  WITH CHECK (
    public.has_role('admin'::user_role)
    OR public.has_role('instructor'::user_role)
  );

CREATE POLICY course_announcements_update ON public.course_announcements FOR UPDATE
  USING (
    public.has_role('admin'::user_role)
    OR (public.has_role('instructor'::user_role) AND author_id = auth.uid())
  )
  WITH CHECK (
    public.has_role('admin'::user_role)
    OR (public.has_role('instructor'::user_role) AND author_id = auth.uid())
  );

CREATE POLICY course_announcements_delete ON public.course_announcements FOR DELETE
  USING (
    public.has_role('admin'::user_role)
    OR (public.has_role('instructor'::user_role) AND author_id = auth.uid())
  );

-- ── Teaching Assistant: scoped write access (migration 039 model) ───────────
-- Posting exam dates and class updates is running the class, which is exactly
-- what a TA is for. Additive policies gated on assists_offering(), so the
-- admin/instructor paths above are untouched. No DELETE policy: per migration
-- 039 a TA may create and edit, never destroy.

CREATE POLICY course_announcements_ta_insert ON public.course_announcements FOR INSERT
  WITH CHECK (public.assists_offering(offering_id));

CREATE POLICY course_announcements_ta_update ON public.course_announcements FOR UPDATE
  USING (public.assists_offering(offering_id) AND author_id = auth.uid())
  WITH CHECK (public.assists_offering(offering_id) AND author_id = auth.uid());

-- ── Storage: announcement attachments in `resources` bucket ──────────────────
-- Path contract: course-announcements/<offering_id>/<filename>

DROP POLICY IF EXISTS "Staff can upload course announcement attachments" ON storage.objects;
CREATE POLICY "Staff can upload course announcement attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resources'
    AND (storage.foldername(name))[1] = 'course-announcements'
    AND (
      public.has_role('admin'::user_role)
      OR public.has_role('instructor'::user_role)
      OR public.has_role('ta'::user_role)
    )
  );

DROP POLICY IF EXISTS "Staff can delete course announcement attachments" ON storage.objects;
CREATE POLICY "Staff can delete course announcement attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resources'
    AND (storage.foldername(name))[1] = 'course-announcements'
    AND (
      public.has_role('admin'::user_role)
      OR public.has_role('instructor'::user_role)
    )
  );

-- Reading is covered by the existing "Authenticated users can view resources"
-- storage SELECT policy (migration 044) for non-student-submissions paths.

-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_course_announcement_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_announcements_updated_at ON public.course_announcements;
CREATE TRIGGER trg_course_announcements_updated_at
  BEFORE UPDATE ON public.course_announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_course_announcement_updated_at();
