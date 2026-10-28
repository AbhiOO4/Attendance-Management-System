// Timesheet approval — the pure rules (no DB). A month's timesheet can be approved only once
// the month is over and it has no BLOCKERS; the approval stores a FINGERPRINT of the month's
// records so any later change, through any write path, revokes it (utils/timesheetMonth.js).

import { createHash } from "node:crypto";
import { getTodayLocal } from "./timeLocal.js";
import { listUnmarkedDays } from "./unmarkedDays.js";
import { hasOpenSession } from "./payrollDay.js";
import { sessionJobIds } from "./jobSplit.js";

const utcDayKey = (date) => new Date(date).toISOString().slice(0, 10);
const idOf = (v) => (v && typeof v === "object" && v._id ? v._id : v);
const idStr = (v) => (v == null ? null : String(idOf(v)));
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** Inclusive UTC-midnight bounds of a calendar month (how Attendance.date is stored). */
export function monthBounds(year, month) {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 0)),
  };
}

/** True once the month's last day is before today's business day (app timezone). */
export function isMonthClosed(year, month) {
  return utcDayKey(monthBounds(year, month).to) < getTodayLocal();
}

/** A worked session (a check-in or a check-out) that names no job. */
function sessionHasNoJob(session) {
  if (!session || (!session.checkIn && !session.checkOut)) return false;
  return sessionJobIds(session).length === 0;
}

/**
 * What stops a month from being approved, as "YYYY-MM-DD" keys:
 *   missing — days with no record at all (utils/unmarkedDays.js, the report's own rule)
 *   pending — a session checked in with no check-out (exported as Absent)
 *   noJob   — a worked session with no job (its hours never reach the ERPNext timesheet)
 */
export function timesheetBlockers(employee, records, countableDays) {
  const pending = [];
  const noJob = [];
  for (const record of records) {
    const key = utcDayKey(record.date);
    if (hasOpenSession(record)) pending.push(key);
    if ((record.sessions || []).some(sessionHasNoJob)) noJob.push(key);
  }
  return {
    missing: listUnmarkedDays(employee, records, countableDays),
    pending: pending.sort(),
    noJob: noJob.sort(),
  };
}

export const blockerCount = (blockers) =>
  blockers.missing.length + blockers.pending.length + blockers.noJob.length;

/**
 * Content hash of a month's records — only what the exports read (day status, hours,
 * holiday and leave flags, every session's place, job(s) and times). Remarks, audit fields
 * and timestamps are left out, and records/sessions are put in a fixed order, so only a real
 * change to the payroll data changes it. Accepts lean docs, populated or not.
 */
export function timesheetFingerprint(records) {
  const rows = records
    .map((record) => ({
      date: utcDayKey(record.date),
      status: record.status ?? null,
      isHoliday: !!record.isHoliday,
      holidayHours: record.holidayHours ?? 0,
      totalWorkHours: record.totalWorkHours ?? 0,
      overtimeHours: record.overtimeHours ?? 0,
      breaksTaken: record.breaksTaken ?? 0,
      isPaidLeave: !!record.isPaidLeave,
      isEmergencyLeave: !!record.isEmergencyLeave,
      isSickLeave: !!record.isSickLeave,
      isLop: !!record.isLop,
      sessions: (record.sessions || [])
        .map((s) => ({
          site: idStr(s.siteId),
          servedSite: idStr(s.servedSiteId),
          jobs: sessionJobIds(s).map(idStr).sort(),
          in: iso(s.checkIn),
          out: iso(s.checkOut),
        }))
        .sort((a, b) =>
          `${a.in}|${a.out}|${a.site}`.localeCompare(`${b.in}|${b.out}|${b.site}`)
        ),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return createHash("sha1").update(JSON.stringify(rows)).digest("hex");
}
