"use server";

/**
 * Course Announcements — server actions (migration 047).
 *
 * Admins and instructors can create announcements scoped to an
 * offering (and optionally a subject). Three attachment types:
 *   text  → body only
 *   pdf   → body + file upload to resources bucket
 *   image → body + file upload to resources bucket
 *
 * Path contract for storage (resources bucket):
 *   course-announcements/<offering_id>/<timestamp>-<sanitised_name>
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, assertAssistsIfTA } from "@/lib/db/auth";

type Result<T = void> = { success: boolean; error?: string; data?: T };

export type AnnouncementAttachmentType = "text" | "pdf" | "image";

export interface CourseAnnouncementRow {
  id: string;
  offering_id: string;
  subject_id: string | null;
  author_id: string | null;
  title: string;
  body: string;
  attachment_type: AnnouncementAttachmentType;
  attachment_url: string | null;
  attachment_name: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Who may post. A TA is included but course-scoped: assertAssistsIfTA() below
 * confirms they actually assist the offering before any write lands
 * (migration 039's scoped-instructor model).
 */
const STAFF = ["admin", "instructor", "ta"] as const;

/** Deleting is destructive, so it stays with admins and instructors — a TA
 *  may create and edit, never destroy (migration 039). */
const DELETERS = ["admin", "instructor"] as const;

function revalidate(subjectId: string) {
  revalidatePath(`/dashboard/instructor/subjects/${subjectId}`);
}

/**
 * Create a text-only announcement (no attachment).
 */
export async function createTextAnnouncement(
  offeringId: string,
  subjectId: string,
  title: string,
  body: string
): Promise<Result<{ id: string }>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const denied = await assertAssistsIfTA(auth, offeringId);
  if (denied) return { success: false, error: denied.error };
  if (!title.trim()) return { success: false, error: "Title is required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("course_announcements")
    .insert({
      offering_id: offeringId,
      subject_id: subjectId,
      author_id: auth.userId,
      title: title.trim(),
      body: body.trim(),
      attachment_type: "text",
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  revalidate(subjectId);
  return { success: true, data: { id: data.id } };
}

/**
 * Create an announcement with an attachment (PDF or image).
 * The file is a FormData-supplied File object, uploaded to the
 * `resources` bucket before the row is inserted.
 */
export async function createFileAnnouncement(
  offeringId: string,
  subjectId: string,
  title: string,
  body: string,
  attachmentType: "pdf" | "image",
  formData: FormData
): Promise<Result<{ id: string }>> {
  const auth = await requireRole([...STAFF]);
  if (!auth.ok) return { success: false, error: auth.error };
  const denied = await assertAssistsIfTA(auth, offeringId);
  if (denied) return { success: false, error: denied.error };
  if (!title.trim()) return { success: false, error: "Title is required." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0)
    return { success: false, error: "Please select a file to upload." };

  const MAX_MB = 20;
  if (file.size > MAX_MB * 1024 * 1024)
    return { success: false, error: `File must be under ${MAX_MB} MB.` };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `course-announcements/${offeringId}/${Date.now()}-${safeName}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("resources")
    .upload(storagePath, file, { upsert: false });

  if (uploadError)
    return { success: false, error: `Upload failed: ${uploadError.message}` };

  const { data, error } = await admin
    .from("course_announcements")
    .insert({
      offering_id: offeringId,
      subject_id: subjectId,
      author_id: auth.userId,
      title: title.trim(),
      body: body.trim(),
      attachment_type: attachmentType,
      attachment_url: storagePath,
      attachment_name: file.name,
    })
    .select("id")
    .single();

  if (error) {
    // Roll back the uploaded file if the DB insert fails.
    await admin.storage.from("resources").remove([storagePath]);
    return { success: false, error: error.message };
  }

  revalidate(subjectId);
  return { success: true, data: { id: data.id } };
}

/**
 * Delete an announcement (and its storage object if present).
 *
 * These writes go through the service-role client, which bypasses RLS — so
 * the ownership rule the `course_announcements_delete` policy states has to
 * be re-stated here or it never actually runs. An instructor may remove only
 * their own post; an admin may remove any. TAs are excluded entirely.
 */
export async function deleteAnnouncement(
  announcementId: string,
  subjectId: string
): Promise<Result> {
  const auth = await requireRole([...DELETERS]);
  if (!auth.ok) return { success: false, error: auth.error };

  const admin = createAdminClient();

  // Read first so we can authorize the caller and clean up storage.
  const { data: row } = await admin
    .from("course_announcements")
    .select("attachment_url, attachment_type, author_id")
    .eq("id", announcementId)
    .maybeSingle<{
      attachment_url: string | null;
      attachment_type: string;
      author_id: string | null;
    }>();

  if (!row) return { success: false, error: "Announcement not found." };

  if (auth.role !== "admin" && row.author_id !== auth.userId) {
    return {
      success: false,
      error: "You can only delete announcements you posted.",
    };
  }

  const { error } = await admin
    .from("course_announcements")
    .delete()
    .eq("id", announcementId);

  if (error) return { success: false, error: error.message };

  if (row?.attachment_url) {
    await admin.storage.from("resources").remove([row.attachment_url]);
  }

  revalidate(subjectId);
  return { success: true };
}
