"use client";

/**
 * AnnouncementsPanel — instructor / admin view for per-subject announcements.
 *
 * Three content modes:
 *   Text  → rich text body only
 *   PDF   → body + PDF attachment (opens in a new tab)
 *   Image → body + image preview inline
 *
 * Attachments are uploaded to Supabase Storage via createFileAnnouncement().
 * Signed URLs for existing attachments are generated server-side and passed in
 * as a map, so private-bucket objects are accessible without exposing the
 * storage path directly.
 */

import { useRef, useState, useTransition } from "react";
import {
  Megaphone,
  Plus,
  Trash2,
  FileText,
  Image as ImageIcon,
  AlignLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  courseCard,
  courseButton,
  courseButtonPrimary,
} from "@/components/course/course-surface";
import {
  createTextAnnouncement,
  createFileAnnouncement,
  deleteAnnouncement,
  type CourseAnnouncementRow,
  type AnnouncementAttachmentType,
} from "./announcement-actions";

const TYPE_LABELS: Record<AnnouncementAttachmentType, string> = {
  text: "Text",
  pdf: "PDF",
  image: "Image",
};

const TYPE_ICONS: Record<AnnouncementAttachmentType, React.ElementType> = {
  text: AlignLeft,
  pdf: FileText,
  image: ImageIcon,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface Props {
  subjectId: string;
  offeringId: string;
  announcements: CourseAnnouncementRow[];
  /** signed URL keyed by the storage path (attachment_url) */
  signedUrls: Record<string, string>;
  /** Who is looking — used to decide whose Delete buttons are shown. */
  viewerId: string;
  viewerRole: string;
}

export function AnnouncementsPanel({
  subjectId,
  offeringId,
  announcements,
  signedUrls,
  viewerId,
  viewerRole,
}: Props) {
  // Mirrors deleteAnnouncement(): admins remove anything, instructors remove
  // only their own, TAs remove nothing. Showing a button that the server will
  // refuse is worse than not showing it at all.
  const canDeleteAny = viewerRole === "admin";
  const canDeleteOwn = viewerRole === "instructor";
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function handleDelete(id: string) {
    if (!window.confirm("Delete this announcement? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAnnouncement(id, subjectId);
      if (!res.success) setError(res.error ?? "Could not delete.");
    });
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className={cn(courseCard, "flex flex-wrap items-center justify-between gap-3 px-[18px] py-3.5")}>
        <div className="flex items-center gap-2.5">
          <Megaphone className="h-[18px] w-[18px] text-rose-500" />
          <div>
            <p className="text-[13.5px] font-medium text-stone-800 dark:text-stone-100">
              Announcements
            </p>
            <p className="text-[12px] text-stone-500 dark:text-stone-400">
              Post exam dates, results, or updates. Students see these in their course hub.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={cn(courseButtonPrimary, "gap-1.5")}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-4 w-4" />
          {adding ? "Cancel" : "New announcement"}
        </button>
      </div>

      {/* Compose form */}
      {adding && (
        <ComposeForm
          subjectId={subjectId}
          offeringId={offeringId}
          onDone={() => setAdding(false)}
          onError={setError}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Announcement list */}
      {announcements.length === 0 ? (
        <div className={cn(courseCard, "px-[18px] py-10 text-center text-[13.5px] text-stone-500 dark:text-stone-400")}>
          No announcements yet. Post your first one above.
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <AnnouncementCard
              key={a.id}
              item={a}
              signedUrl={a.attachment_url ? (signedUrls[a.attachment_url] ?? null) : null}
              onDelete={() => handleDelete(a.id)}
              canDelete={canDeleteAny || (canDeleteOwn && a.author_id === viewerId)}
              disabled={pending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Compose Form ─────────────────────────────────────────────────────────── */

function ComposeForm({
  subjectId,
  offeringId,
  onDone,
  onError,
}: {
  subjectId: string;
  offeringId: string;
  onDone: () => void;
  onError: (msg: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<AnnouncementAttachmentType>("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function submit() {
    onError(null);
    startTransition(async () => {
      let res;
      if (mode === "text") {
        res = await createTextAnnouncement(offeringId, subjectId, title, body);
      } else {
        const fd = new FormData();
        const file = fileRef.current?.files?.[0];
        if (!file) { onError("Please select a file."); return; }
        fd.append("file", file);
        res = await createFileAnnouncement(offeringId, subjectId, title, body, mode, fd);
      }
      if (!res.success) { onError(res.error ?? "Could not save."); return; }
      setTitle(""); setBody("");
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    });
  }

  const inputCls =
    "rounded-[8px] border border-stone-200 bg-white px-3 py-1.5 text-[13px] text-stone-800 focus:border-rose-400 focus:outline-none focus:ring-1 focus:ring-rose-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100";

  return (
    <div className={cn(courseCard, "space-y-4 px-[18px] py-5")}>
      {/* Mode selector */}
      <div className="flex gap-2">
        {(["text", "pdf", "image"] as AnnouncementAttachmentType[]).map((m) => {
          const Icon = TYPE_ICONS[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                mode === m
                  ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300"
                  : "border-stone-200 bg-white text-stone-600 hover:border-rose-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {TYPE_LABELS[m]}
            </button>
          );
        })}
      </div>

      {/* Title */}
      <label className="flex flex-col gap-1 text-[12px] text-stone-500 dark:text-stone-400">
        Title *
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Exam Results — Tajweed Paper 1"
          className={cn(inputCls, "w-full")}
        />
      </label>

      {/* Body */}
      <label className="flex flex-col gap-1 text-[12px] text-stone-500 dark:text-stone-400">
        Message
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={
            mode === "text"
              ? "Write your announcement here…"
              : "Optional message to accompany the attachment…"
          }
          className={cn(inputCls, "w-full resize-y")}
        />
      </label>

      {/* File picker (PDF / image) */}
      {(mode === "pdf" || mode === "image") && (
        <label className="flex flex-col gap-1 text-[12px] text-stone-500 dark:text-stone-400">
          {mode === "pdf" ? "PDF file *" : "Image file *"}
          <input
            ref={fileRef}
            type="file"
            accept={mode === "pdf" ? "application/pdf" : "image/*"}
            className={cn(inputCls, "cursor-pointer file:mr-3 file:cursor-pointer file:rounded-[6px] file:border-0 file:bg-rose-50 file:px-3 file:py-1 file:text-[12px] file:font-medium file:text-rose-700 dark:file:bg-rose-950/30 dark:file:text-rose-300")}
          />
          <span className="text-[11px] text-stone-400">Max 20 MB</span>
        </label>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !title.trim()}
          onClick={submit}
          className={cn(courseButtonPrimary)}
        >
          {pending ? "Posting…" : "Post announcement"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onDone}
          className={cn(courseButton)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Single announcement card ─────────────────────────────────────────────── */

function AnnouncementCard({
  item,
  signedUrl,
  onDelete,
  canDelete,
  disabled,
}: {
  item: CourseAnnouncementRow;
  signedUrl: string | null;
  onDelete: () => void;
  canDelete: boolean;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const Icon = TYPE_ICONS[item.attachment_type];

  return (
    <div className={cn(courseCard, "overflow-hidden p-0", item.is_pinned && "border-rose-200 dark:border-rose-900")}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-[18px] py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]",
            item.attachment_type === "text"
              ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
              : item.attachment_type === "pdf"
                ? "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300"
                : "bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-300"
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-heading text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
                {item.title}
              </p>
              {item.is_pinned && (
                <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">
                  <Pin className="h-3 w-3" /> Pinned
                </span>
              )}
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                {TYPE_LABELS[item.attachment_type]}
              </span>
            </div>
            <p className="text-[12px] text-stone-400 dark:text-stone-500">
              {relativeTime(item.created_at)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-[6px] p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {canDelete && (
            <button
              type="button"
              disabled={disabled}
              onClick={onDelete}
              className="rounded-[6px] p-1 text-stone-300 transition-colors hover:text-rose-500 dark:text-stone-600"
              aria-label="Delete announcement"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body + attachment */}
      {expanded && (
        <div className="border-t border-stone-100 px-[18px] py-3.5 dark:border-stone-800">
          {item.body && (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-stone-700 dark:text-stone-300">
              {item.body}
            </p>
          )}
          {item.attachment_type === "pdf" && signedUrl && (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                courseButton,
                "mt-3 inline-flex items-center gap-1.5 text-[12.5px]"
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              {item.attachment_name ?? "Open PDF"}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {item.attachment_type === "image" && signedUrl && (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={signedUrl}
                alt={item.attachment_name ?? item.title}
                className="max-h-[360px] rounded-[10px] border border-stone-200 object-contain dark:border-stone-700"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
