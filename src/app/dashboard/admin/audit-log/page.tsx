/**
 * Admin Audit Log — the single "who changed this?" trail.
 *
 * Reads public.audit_log (migration 033), newest first. Every sensitive
 * admin mutation writes here: role changes, password resets, enrollment
 * approvals/rejections, financial-assistance decisions, and offline
 * payment records. Admin-only — enforced twice: the admin layout bounces
 * non-admins off /dashboard/admin/audit-log, and the audit_log RLS policy
 * only lets admins SELECT.
 *
 * Read-only. This screen never writes anything, least of all to the trail
 * it displays — the log is append-only from trusted server code.
 */
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  courseCard,
  pillBase,
  pillTones,
  type PillTone,
} from "@/components/course/course-surface";

interface AuditRow {
  id: string;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
}

// Pakistan Standard Time is UTC+5 with no DST — a fixed offset is correct.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function formatPkt(iso: string): string {
  const d = new Date(new Date(iso).getTime() + PKT_OFFSET_MS);
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
  return `${date} · ${time} PKT`;
}

// Map an action's top-level group to a pill tone + readable label so the
// table scans by colour: role/user changes rose, money warning-sand,
// enrollment decisions steel.
function actionTone(action: string): PillTone {
  if (action.startsWith("user.")) return "brand";
  if (action.startsWith("monthly_payment.")) return "warning";
  if (action.startsWith("enrollment.")) return "steel";
  if (action.startsWith("quiz.")) return "success";
  return "muted";
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "user.roles_updated": "Roles changed",
    "user.password_reset_sent": "Reset link sent",
    "user.password_set": "Password set",
    "user.suspension_set": "Suspension changed",
    "user.lock_override_set": "Portal lock changed",
    "enrollment.approved": "Enrollment approved",
    "enrollment.rejected": "Enrollment rejected",
    "enrollment.manual_created": "Manual enrollment",
    "enrollment.removed": "Enrollment removed",
    "enrollment.deleted": "Enrollment deleted",
    "enrollment.fa_approved": "Aid approved",
    "enrollment.fa_rejected": "Aid rejected",
    "monthly_payment.manual_approved": "Payment recorded",
    "quiz.created": "Quiz created",
    "quiz.updated": "Quiz edited",
    "quiz.published": "Quiz published",
    "quiz.unpublished": "Quiz unpublished",
    "quiz.deleted": "Quiz deleted",
    "quiz.attempted": "Quiz taken",
  };
  return map[action] ?? action;
}

export default async function AuditLogPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, actor_email, actor_name, action, entity_type, entity_id, summary, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as AuditRow[];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <ScrollText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every sensitive change &mdash; who did it and when. Newest first,
            latest 200. Times shown in PKT.
          </p>
        </div>
      </div>

      {error ? (
        <div className={`${courseCard} p-6 text-sm text-muted-foreground`}>
          Could not load the audit log: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className={`${courseCard} p-10 text-center`}>
          <p className="text-sm font-medium">No activity recorded yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Role changes, enrollment decisions, and recorded payments will
            appear here as they happen.
          </p>
        </div>
      ) : (
        <div className={`${courseCard} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border-soft text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground dark:border-border">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">What happened</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border-soft last:border-0 dark:border-border"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatPkt(r.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {r.actor_name || "Unknown"}
                      </div>
                      {r.actor_email ? (
                        <div className="text-xs text-muted-foreground">
                          {r.actor_email}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`${pillBase} ${pillTones[actionTone(r.action)]}`}
                      >
                        {actionLabel(r.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
