/**
 * Creating ONE past-day Attendance record from already-built sessions — shared by the
 * admin bulk backfill (attendanceController.bulkBackfillAttendance) and the approval of a
 * supervisor backfill request (controllers/backfillRequestController.js), so both price a
 * backfilled day identically.
 *
 * Callers do the cheap skips (no record yet, driver rules, cross-day overlap) first; this
 * only computes totals, saves, syncs the roster job and hands back the audit row for the
 * caller's single recordAttendanceAuditBatch.
 */
import Attendance from "../models/attendanceModel.js"
import { computeAttendanceTotals } from "./attendanceMath.js"
import { combineFromOffset, MAX_SHIFT_HOURS } from "./timeLocal.js"
import { holidayInfoForEmployee } from "./holidayInfo.js"
import { detectCrossedMidnight } from "./crossedMidnight.js"
import { syncCurrentJobFromLatestSession } from "./currentJobSync.js"
import { buildAuditRow } from "./attendanceAudit.js"

/**
 * Build a record's sessions from raw "HH:mm" times + EXPLICIT day offsets on business day
 * `dateStr`. Returns `{ sessions, error }`: sessions carry Dates, workedHours and
 * isNightShift, sorted by check-in; `error` is a message when a session is incomplete, out of
 * bounds, or two sessions overlap (same rule as the single backfill's within-record check).
 */
export function buildSessionsFromRaw(dateStr, siteId, rawSessions, markedBy) {
  if (!Array.isArray(rawSessions) || rawSessions.length === 0) {
    return { sessions: [], error: "Add at least one session" }
  }

  const sessions = []
  for (const raw of rawSessions) {
    if (!raw?.checkIn || !raw?.checkOut) {
      return { sessions: [], error: "Every session needs a check-in and a check-out" }
    }
    const checkIn = combineFromOffset(dateStr, raw.checkIn, !!raw.checkInNextDay)
    const checkOut = combineFromOffset(dateStr, raw.checkOut, !!raw.checkOutNextDay)
    if (!checkIn || !checkOut || isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      return { sessions: [], error: "Invalid check-in/check-out time" }
    }
    const workedHours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60)
    if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
      return {
        sessions: [],
        error: `Invalid shift duration ${raw.checkIn}–${raw.checkOut} — check the times or the next-day markers (max ${MAX_SHIFT_HOURS}h).`,
      }
    }
    sessions.push({
      siteId,
      jobId: raw.jobId || null,
      // A Drivers-pool session's job split (already resolved by the caller), else empty.
      servedSiteId: raw.servedSiteId || null,
      splitJobIds: Array.isArray(raw.splitJobIds) ? raw.splitJobIds : [],
      checkIn,
      checkOut,
      workedHours: Number(workedHours.toFixed(2)),
      markedBy,
      isNightShift: !!raw.checkInNextDay || !!raw.checkOutNextDay,
    })
  }

  sessions.sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())
  for (let i = 0; i < sessions.length - 1; i++) {
    if (sessions[i].checkOut.getTime() > sessions[i + 1].checkIn.getTime()) {
      return { sessions: [], error: "Sessions overlap — each session must end before the next one starts" }
    }
  }
  return { sessions, error: null }
}

/**
 * Save one backfilled record. `sessions` are built sessions (Dates + workedHours, as from
 * buildSessionsFromRaw); the record's site/job are the first session's. `holidayInfo` is
 * the day's (checkHolidayForDate) — the employee's employmentType is applied here.
 * Returns `{ doc, auditRow }`.
 */
export async function createBackfilledRecord({
  employee,
  attendanceDate,
  sessions,
  breaksTaken = null,
  workConfig,
  holidayInfo,
  markedBy,
  auditActor,
  auditSummary,
  timezoneOffset = null,
}) {
  const rawHours = Number(sessions.reduce((sum, s) => sum + (s.workedHours || 0), 0).toFixed(2))

  // Temporary workers get no holiday treatment (normal day + OT, no holiday credit).
  const effHolidayInfo = holidayInfoForEmployee(holidayInfo, employee.employmentType)
  const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
    rawHours,
    workConfig,
    breaksTaken,
    effHolidayInfo
  )
  const hasCrossedMidnight = detectCrossedMidnight(sessions, timezoneOffset)
  const first = sessions[0]

  const doc = new Attendance({
    employee: employee._id,
    date: attendanceDate,
    siteId: first.siteId,
    jobId: first.jobId || null,
    markedBy,
    isHoliday: effHolidayInfo.isHoliday,
    holidayReason: effHolidayInfo.reason,
    holidayHours,
    isSickLeave: false,
    status,
    totalWorkHours: netWorkHours,
    overtimeHours,
    breaksTaken: breaksTaken !== undefined ? breaksTaken : null,
    shiftType: hasCrossedMidnight ? "night" : "day",
    crossedMidnight: hasCrossedMidnight,
    sessions,
  })

  await doc.save()

  // A no-op unless this is the employee's latest record AND the site is their current site.
  await syncCurrentJobFromLatestSession({
    empId: String(employee._id),
    siteId: first.siteId,
    recordDate: attendanceDate,
    doc,
  })

  return { doc, auditRow: buildAuditRow(doc, auditActor, "backfilled", auditSummary) }
}
