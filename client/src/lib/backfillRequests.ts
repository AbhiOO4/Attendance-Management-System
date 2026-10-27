// Supervisor backfill requests (server: controllers/backfillRequestController.js) — shared
// types, labels and the hours preview used by the supervisor and admin pages.
//
// A driver supervisor's document sits on the hidden Drivers pool (`isDriverPool`): its rows are
// drivers and each session names a SITE + job split (lib/jobSplit.ts) instead of one job —
// "driver mode" in the helpers below.

import { minutesFromOffset, validateSessionTimesV2 } from "@/lib/dateUtils"
import { computeAttendanceTotals, type HolidayReason } from "@/lib/attendanceUtils"
import type { WorkConfig } from "@/lib/dateUtils"
import { REQUESTS_LIVE_EVENT, type RequestsLiveDetail } from "@/lib/requestsLive"
import { placeFromSession, type DriverPlace, type SessionSplitFields } from "@/lib/jobSplit"

export type BackfillStatus = "draft" | "submitted" | "approved" | "rejected"

export type BackfillSession = SessionSplitFields & {
  jobId: string | null
  jobName?: string
  jobCode?: string
  isGlobalJob?: boolean
  // Driver mode: the editor's site + ticked jobs (seeded from servedSite/splitJobs by withPlaces).
  place?: DriverPlace | null
  checkIn: string
  checkOut: string
  checkInNextDay: boolean
  checkOutNextDay: boolean
}

export type BackfillRow = {
  employee: {
    _id: string
    name: string
    employeeId: string
    jobTitle: string
    employmentType?: string
    currentSite: { _id: string; siteName: string } | null
  } | null
  sessions: BackfillSession[]
  breaksTaken: number | null
  offRoster: boolean
  addedBy: { _id: string; name: string } | null
  outcome: "created" | "skipped" | "failed" | null
  outcomeMessage: string
  attendanceId: string | null
}

export type SiteJob = { _id: string; name: string; jobCode: string | null }

export type BackfillRequestDoc = {
  _id: string
  siteId: string
  siteName: string
  date: string
  isDriverPool: boolean
  status: BackfillStatus
  wasRejected: boolean
  rejectionReason: string
  createdBy: { _id: string; name: string } | null
  submittedBy: { _id: string; name: string } | null
  submittedAt: string | null
  reviewedBy: { _id: string; name: string } | null
  reviewedAt: string | null
  approvalSummary: { createdCount: number; skippedCount: number; failedCount: number }
  updatedAt: string
  holiday: { isHoliday: boolean; reason: HolidayReason }
  siteJobs: SiteJob[]
  submitDeadline: string | null
  permissions: { editable: boolean; canSubmit: boolean; canDiscard: boolean; canReview: boolean }
  rows: BackfillRow[]
}

export type BackfillListItem = {
  _id: string
  siteId: string
  siteName: string
  date: string
  status: BackfillStatus
  rowCount: number
  wasRejected: boolean
  rejectionReason: string
  createdBy: string | null
  submittedBy: string | null
  submittedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  approvalSummary: { createdCount: number; skippedCount: number; failedCount: number } | null
}

export type CandidateEmployee = {
  _id: string
  name: string
  employeeId: string
  jobTitle: string
  employmentType?: string
  currentSite: { _id: string; siteName: string } | null
  lastSeenHere?: string | null
}

export type RowResultEntry = { employeeId: string; name: string | null; reason?: string; message?: string }

export const STATUS_LABEL: Record<BackfillStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting approval",
  approved: "Approved",
  rejected: "Sent back",
}

export const STATUS_CLASS: Record<BackfillStatus, string> = {
  draft: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-transparent",
  submitted: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-transparent",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400 border-transparent",
}

/** Fired after any backfill-request write, so badges refetch. */
export const BACKFILL_UPDATED_EVENT = "backfill:updated"
export const notifyBackfillUpdated = () => window.dispatchEvent(new Event(BACKFILL_UPDATED_EVENT))

/**
 * Run `cb` whenever backfill state may have changed: a write in this tab, or a new
 * notification on the live stream (a backfill was sent / approved / sent back elsewhere —
 * server utils/backfillNotify.js). Returns the unsubscribe.
 */
export function onBackfillChange(cb: () => void): () => void {
  const onLive = (e: Event) => {
    const scopes = (e as CustomEvent<RequestsLiveDetail>).detail?.scopes || []
    if (scopes.includes("notifications") || scopes.includes("resync")) cb()
  }
  window.addEventListener(BACKFILL_UPDATED_EVENT, cb)
  window.addEventListener(REQUESTS_LIVE_EVENT, onLive)
  return () => {
    window.removeEventListener(BACKFILL_UPDATED_EVENT, cb)
    window.removeEventListener(REQUESTS_LIVE_EVENT, onLive)
  }
}

export const emptySession = (): BackfillSession => ({
  jobId: null,
  checkIn: "",
  checkOut: "",
  checkInNextDay: false,
  checkOutNextDay: false,
})

/** First problem with a session list (client-side mirror of the server checks), or null. */
export function sessionsError(sessions: BackfillSession[], jobRequired: boolean, driverMode = false): string | null {
  if (sessions.length === 0) return "Add at least one session"
  for (const [i, s] of sessions.entries()) {
    const n = sessions.length > 1 ? ` ${i + 1}` : ""
    if (!s.checkIn || !s.checkOut) return `Session${n}: enter both check-in and check-out`
    const err = validateSessionTimesV2(s.checkIn, s.checkOut, s.checkInNextDay, s.checkOutNextDay)
    if (err) return `Session${n}: ${err}`
    if (driverMode && !s.place?.jobIds.length) return `Session${n}: pick a site and its jobs`
    if (!driverMode && jobRequired && !s.jobId) return `Session${n}: pick a job`
  }
  // Overlap: minutes from the business day's midnight, sorted by start.
  const spans = sessions
    .map((s) => {
      const [ih, im] = s.checkIn.split(":").map(Number)
      const [oh, om] = s.checkOut.split(":").map(Number)
      return { start: (s.checkInNextDay ? 1440 : 0) + ih * 60 + im, end: (s.checkOutNextDay ? 1440 : 0) + oh * 60 + om }
    })
    .sort((a, b) => a.start - b.start)
  for (let i = 0; i < spans.length - 1; i++) {
    if (spans[i].end > spans[i + 1].start) return "Sessions overlap — each must end before the next starts"
  }
  return null
}

export type DayPreview = {
  rawHours: number
  breaks: number
  netHours: number
  overtimeHours: number
  holidayHours: number
  status: "fullday" | "halfday" | "absent"
  isNight: boolean
}

/** The day's totals as the server will compute them (computeAttendanceTotals mirror). */
export function previewDay(
  sessions: BackfillSession[],
  breaksTaken: number | null,
  workConfig: WorkConfig | null | undefined,
  holidayReason: HolidayReason = null
): DayPreview {
  const cfg = {
    fullDayHours: workConfig?.fullDayHours ?? 8,
    halfDayHours: workConfig?.halfDayHours ?? 4,
    overtimeThreshold: workConfig?.overtimeThreshold ?? 8,
    breakDurationMinutes: workConfig?.breakDurationMinutes ?? 60,
    breakMinHours: workConfig?.breakMinHours ?? null,
  }

  // Exact minutes summed, rounded once — the server's sumRawHours (never Σ rounded hours).
  const minutes = sessions.reduce(
    (sum, s) => sum + Math.max(minutesFromOffset(s.checkIn, s.checkOut, s.checkInNextDay, s.checkOutNextDay), 0),
    0
  )
  const rawHours = Math.round((minutes / 60) * 100) / 100
  const isHoliday = holidayReason === "public" || holidayReason === "weekly"
  const totals = computeAttendanceTotals(rawHours, cfg, breaksTaken, isHoliday)
  return {
    rawHours,
    breaks: totals.breaksApplied,
    netHours: totals.netWorkHours,
    overtimeHours: totals.overtimeHours,
    holidayHours: totals.holidayHours,
    status: totals.status,
    isNight: sessions.some((s) => s.checkInNextDay || s.checkOutNextDay),
  }
}

/** Holiday reason for an employee on that day: temporary workers get none. */
export const holidayReasonFor = (
  holiday: { isHoliday: boolean; reason: HolidayReason } | null | undefined,
  employmentType?: string
): HolidayReason => (holiday?.isHoliday && employmentType !== "temporary" ? holiday.reason : null)

/** Saved sessions ready for the editor: driver sessions get their `place` from the stored split. */
export const withPlaces = (sessions: BackfillSession[]): BackfillSession[] =>
  sessions.map((s) => ({ ...s, place: s.place !== undefined ? s.place : placeFromSession(s) }))

export const toSessionPayload = (sessions: BackfillSession[], driverMode = false) =>
  sessions.map((s) => ({
    jobId: driverMode ? null : s.jobId,
    ...(driverMode ? { splitJobIds: s.place?.jobIds ?? [] } : {}),
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    checkInNextDay: s.checkInNextDay,
    checkOutNextDay: s.checkOutNextDay,
  }))
