import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAdminArrivalIssues, useAdminDisputes, useAdminUsers } from "@/lib/admin-queries";
import { resolveDisputeAsAdminFn } from "@/lib/disputes.functions";
import { issueLabel, ownerMinutesLeft, type DisputeAction } from "@/lib/disputes-window";
import { AdminSection, AdminCard, AdminButton, Pill, inr } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/disputes")({
  head: () => ({
    meta: [
      { title: "Disputes & support | Usop admin" },
      {
        name: "description",
        content: "Work through Usop support requests and disputes between drivers and hosts.",
      },
    ],
  }),
  component: AdminDisputes,
});

/** Free-form support queue. "Can't Park" reports live in ArrivalDisputes, further down the page. */
function AdminDisputes() {
  const { data: rows = [], isLoading } = useAdminDisputes();
  const { data: users = [] } = useAdminUsers();
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);

  const nameOf = (userId: string) =>
    users.find((u) => u.user_id === userId)?.name || "Unknown user";

  async function resolve(id: string, status: "open" | "resolved" | "rejected") {
    const note = status === "open" ? null : (prompt("Resolution note (optional)") ?? null);
    const { error } = await supabase
      .from("support_requests")
      .update({
        status,
        admin_note: note,
        resolved_at: status === "open" ? null : new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    qc.invalidateQueries({ queryKey: ["admin-overview"] });
  }

  const visibleRequests = openOnly ? rows.filter((r) => r.status === "open") : rows;

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;

  return (
    <>
      <AdminSection title={`Support requests (${visibleRequests.length})`}>
        <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Show open only
        </label>
        {visibleRequests.map((r) => (
          <AdminCard key={r.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{r.subject}</span>
              <Pill
                tone={r.status === "open" ? "warn" : r.status === "resolved" ? "success" : "danger"}
              >
                {r.status}
              </Pill>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {nameOf(r.user_id)} | {r.category} | {new Date(r.created_at).toLocaleDateString()}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{r.message}</p>
            {r.admin_note && (
              <p className="mt-2 text-xs text-muted-foreground">Resolution: {r.admin_note}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.status !== "resolved" && (
                <AdminButton onClick={() => resolve(r.id, "resolved")}>Resolve</AdminButton>
              )}
              {r.status !== "rejected" && (
                <AdminButton variant="danger" onClick={() => resolve(r.id, "rejected")}>
                  Reject
                </AdminButton>
              )}
              {r.status !== "open" && (
                <AdminButton variant="ghost" onClick={() => resolve(r.id, "open")}>
                  Reopen
                </AdminButton>
              )}
            </div>
          </AdminCard>
        ))}
        {visibleRequests.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing to resolve.</p>
        )}
      </AdminSection>

      <ArrivalDisputes />
    </>
  );
}

/**
 * Pending "Can't Park" reports: what the driver said, the booking the report froze, what the driver
 * is still owed, and the three ways to close it. It reads the same `arrival_issues` rows the rest of
 * the console uses (adminArrivalIssuesQuery joins the booking, its spot, payments and refunds, so the
 * amount on the button is exactly what a full refund would send).
 *
 * Every button goes through `resolveDisputeAsAdminFn` instead of a table update: `authenticated`
 * only has SELECT on `arrival_issues` (drizzle/migrations/0015_arrival_issues.sql), so the refund
 * row and the booking change have to be written by the service-role path.
 */
function ArrivalDisputes() {
  const { data: reports = [], isLoading } = useAdminArrivalIssues();
  const { data: users = [] } = useAdminUsers();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const resolveReport = useServerFn(resolveDisputeAsAdminFn);

  /** Only reports still waiting for an answer; closed ones live in the booking/audit history. */
  const pending = reports.filter((r) => r.status === "pending");

  const nameOf = (userId: string) =>
    users.find((u) => u.user_id === userId)?.name || "Unknown driver";

  /**
   * `refund` returns everything still captured and cancels the booking (the server keys the refund on
   * the report id, so a double click cannot pay twice); `remediate` and `reject` keep the booking and
   * only close the report.
   */
  async function resolve(issueId: string, action: DisputeAction, duePaise: number) {
    if (
      action === "refund" &&
      !confirm(`Refund ${inr(duePaise / 100)} to the driver and close this booking?`)
    )
      return;
    const asked = action === "reject" ? prompt("Why is no refund due? (optional)") : null;
    setBusyId(issueId);
    try {
      // The server decides who may do this and refuses a report someone else already closed.
      const res = await resolveReport({
        data: { issueId, action, note: asked?.trim() || undefined },
      });
      toast.success(
        res.refundedPaise > 0
          ? `Refunded ${inr(res.refundedPaise / 100)} and closed the booking`
          : "Report closed",
      );
      qc.invalidateQueries({ queryKey: ["admin-arrival-issues"] });
      qc.invalidateQueries({ queryKey: ["admin-overview"] });
      qc.invalidateQueries({ queryKey: ["admin-transactions"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve the report");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminSection title={`Can't Park reports (${pending.length})`}>
      {pending.map((report) => {
        const when = report.start_time
          ? new Date(report.start_time).toLocaleString()
          : "no booking";
        const until = report.end_time ? new Date(report.end_time).toLocaleTimeString() : "-";
        const busy = busyId === report.id;
        return (
          <AdminCard key={report.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{issueLabel(report.issue_type)}</span>
              <Pill tone={report.owner_expired ? "danger" : "warn"}>
                {report.owner_expired ? "needs a refund" : "with the host"}
              </Pill>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {nameOf(report.driver_id)} | {report.slot_name} | {when} to {until}
            </div>
            {report.note && <p className="mt-2 whitespace-pre-wrap text-sm">{report.note}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Pill tone={report.booking_status === "disputed" ? "warn" : "muted"}>
                booking {report.booking_status}
              </Pill>
              <span>
                {report.owner_expired
                  ? "The host's 15 minutes are up."
                  : `Host has ${ownerMinutesLeft(report)} min left.`}
              </span>
              <span className={report.due_paise > 0 ? "font-bold text-foreground" : undefined}>
                {report.due_paise > 0
                  ? `refund due ${inr(report.due_paise / 100)}`
                  : "nothing left to refund"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <AdminButton
                disabled={busy || report.due_paise <= 0}
                onClick={() => resolve(report.id, "refund", report.due_paise)}
              >
                Resolve &amp; Refund {inr(report.due_paise / 100)}
              </AdminButton>
              <AdminButton
                variant="ghost"
                disabled={busy}
                onClick={() => resolve(report.id, "remediate", 0)}
              >
                Host fixed it
              </AdminButton>
              <AdminButton
                variant="danger"
                disabled={busy}
                onClick={() => resolve(report.id, "reject", 0)}
              >
                Dismiss, no refund
              </AdminButton>
            </div>
          </AdminCard>
        );
      })}
      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && pending.length === 0 && (
        <p className="text-sm text-muted-foreground">No driver reports waiting.</p>
      )}
    </AdminSection>
  );
}
