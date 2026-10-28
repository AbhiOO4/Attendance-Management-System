import { CheckCircle2, History, Loader2, Undo2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  HISTORY_LABELS,
  STATUS_META,
  approvalDetail,
  fmtDateTime,
  type ApprovalView,
  type TimesheetBlockers,
} from "@/lib/timesheetApproval"
import { cn } from "@/lib/utils"

interface Props {
  approval: ApprovalView | null
  blockers: TimesheetBlockers
  monthClosed: boolean
  canWrite: boolean
  busy: boolean
  onApprove: () => void
  onRevoke: () => void
}

const dayLabel = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })

// The month's approval band on the employee timesheet: status, who/when, history, and —
// for admins — Approve (only a closed month with nothing blocking it) or Revoke.
export default function TimesheetApprovalBar({
  approval,
  blockers,
  monthClosed,
  canWrite,
  busy,
  onApprove,
  onRevoke,
}: Props) {
  const status = approval?.status ?? "pending"
  const meta = STATUS_META[status]
  const blocking = [
    { key: "missing", label: "missing (no record)", days: blockers.missing },
    { key: "pending", label: "open check-out", days: blockers.pending },
    { key: "noJob", label: "session with no job", days: blockers.noJob },
  ].filter((b) => b.days.length > 0)

  const approveBlockedReason = !monthClosed
    ? "A month can be approved only after it ends"
    : blocking.length > 0
      ? "Fix the flagged days first"
      : null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Timesheet</span>
        <Badge variant="outline" className={cn(meta.className)}>
          {meta.label}
        </Badge>
        {approval && (
          <span className="text-xs text-muted-foreground">{approvalDetail(approval)}</span>
        )}
        {approval && approval.history.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <History className="h-3.5 w-3.5" />
                History
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <ul className="space-y-1.5 text-sm">
                {[...approval.history].reverse().map((entry, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {HISTORY_LABELS[entry.action]}
                      {entry.byName ? ` · ${entry.byName}` : ""}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {fmtDateTime(entry.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {status !== "approved" && blocking.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-rose-700 dark:text-rose-400">
          {blocking.map((b) => (
            <span key={b.key} title={b.days.map(dayLabel).join(", ")}>
              {b.days.length} {b.label}
              {b.days.length <= 4 && `: ${b.days.map(dayLabel).join(", ")}`}
            </span>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="ml-auto flex items-center gap-2">
          {status === "approved" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onRevoke}>
              {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
              Revoke
            </Button>
          ) : (
            // A disabled button swallows hover, so the reason sits on the wrapper.
            <span title={approveBlockedReason ?? undefined}>
              <Button size="sm" disabled={busy || !!approveBlockedReason} onClick={onApprove}>
                {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                Approve
              </Button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
