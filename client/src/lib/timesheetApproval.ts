// Monthly timesheet approval (server utils/timesheetApproval.js + utils/timesheetMonth.js).
// Only APPROVED timesheets may be exported anywhere; an approval whose records changed is
// revoked by the server ("records_changed") the next time it is read.

import axios from "axios"
import { MONTH_NAMES, currentMonthYear, type MonthYear } from "@/lib/monthYear"

export type ApprovalStatus = "approved" | "pending" | "revoked"

export interface ApprovalHistoryEntry {
  action: "approved" | "revoked" | "auto_revoked"
  byName: string | null
  at: string
}

export interface ApprovalView {
  status: ApprovalStatus
  approvedByName: string | null
  approvedAt: string | null
  revokedByName: string | null
  revokedAt: string | null
  revokeReason: "manual" | "records_changed" | null
  history: ApprovalHistoryEntry[]
}

/** What blocks approval — "YYYY-MM-DD" days (counts on the Timesheets list). */
export interface TimesheetBlockers {
  missing: string[]
  pending: string[]
  noJob: string[]
}

export interface NotApprovedEmployee {
  _id: string
  name: string | null
  employeeId: string | null
}

export const STATUS_META: Record<ApprovalStatus, { label: string; className: string }> = {
  approved: {
    label: "Approved",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40",
  },
  pending: {
    label: "Pending",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40",
  },
  revoked: {
    label: "Revoked",
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/40",
  },
}

/** "3 missing · 1 open check-out · 2 no job", or "" when clean. */
export function blockerSummary(counts: { missing: number; pending: number; noJob: number }): string {
  return [
    counts.missing > 0 && `${counts.missing} missing`,
    counts.pending > 0 && `${counts.pending} open check-out${counts.pending === 1 ? "" : "s"}`,
    counts.noJob > 0 && `${counts.noJob} no job`,
  ]
    .filter(Boolean)
    .join(" · ")
}

export const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : ""

/** One line about who approved / revoked it and when. */
export function approvalDetail(view: {
  status: ApprovalStatus
  approvedByName: string | null
  approvedAt: string | null
  revokedByName: string | null
  revokedAt: string | null
  revokeReason: string | null
}): string {
  if (view.status === "approved") {
    return `Approved by ${view.approvedByName || "unknown"} · ${fmtDateTime(view.approvedAt)}`
  }
  if (view.status === "revoked") {
    return view.revokeReason === "records_changed"
      ? `Revoked automatically — records changed after approval · ${fmtDateTime(view.revokedAt)}`
      : `Revoked by ${view.revokedByName || "unknown"} · ${fmtDateTime(view.revokedAt)}`
  }
  return "Not approved yet"
}

export const HISTORY_LABELS: Record<ApprovalHistoryEntry["action"], string> = {
  approved: "Approved",
  revoked: "Revoked",
  auto_revoked: "Revoked (records changed)",
}

/** The month before the current one — the latest that can be approved. */
export function previousMonthYear(): MonthYear {
  const { month, year } = currentMonthYear()
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year }
}

export const monthLabel = ({ month, year }: MonthYear) => `${MONTH_NAMES[month - 1]} ${year}`

/**
 * The server's 409 TIMESHEET_NOT_APPROVED list from an export error — the body is a Blob
 * when the request asked for one (file downloads). Null for any other error.
 */
export async function notApprovedFromError(error: unknown): Promise<NotApprovedEmployee[] | null> {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null
  let body: unknown = error.response.data
  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text())
    } catch {
      return null
    }
  }
  const data = body as { code?: string; notApproved?: NotApprovedEmployee[] }
  return data?.code === "TIMESHEET_NOT_APPROVED" ? data.notApproved ?? [] : null
}
