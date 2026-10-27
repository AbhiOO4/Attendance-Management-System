import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import attendanceAuditModel from '../models/attendanceAuditModel.js'
import Employee from '../models/empModel.js';
import empModel from '../models/empModel.js';
import mongoose from 'mongoose';
import workModel from '../models/workModel.js';
import Site from '../models/siteModel.js';
import siteModel from '../models/siteModel.js';
import { escapeRegExp } from '../utils/escapeRegExp.js';
import userModel from '../models/userModel.js';
import Job from '../models/jobModel.js';
import customHolidayModel from '../models/holidayModel.js';
import { getStaffEmployeeIds } from '../utils/collar.js';
import { recordNetFactor } from '../utils/manHours.js';
import { combineFromOffset, deriveOffsets, resolveDayOffsets, validateSessionTimesV2, MAX_SHIFT_HOURS, getDateLocal, getTodayLocal, isWithinCarryoverWindow } from '../utils/timeLocal.js';
import { hasSessionOverlap, buildCrossDayOverlapChecker, crossDayOverlapMessage } from '../utils/sessionOverlap.js';
import { computeAttendanceTotals, sumRawHours } from '../utils/attendanceMath.js';
import { buildAttendanceCsv, buildTimesheetCsv, DEFAULT_COMPANY, DEFAULT_ACTIVITY_TYPE } from '../utils/erpnextExport.js';
import { classifyPayrollDay, hasOpenSession } from '../utils/payrollDay.js';
import { buildCountableDays, countUnmarkedDays, unmarkedAsAbsent } from '../utils/unmarkedDays.js';
import { isAssignableSite, findAssignableJob, siteHasLiveJobs } from '../utils/siteAssignable.js';
import { findSessionJob } from '../utils/globalJobs.js';
import { supervisorMayCloseCarryover } from '../utils/carryoverAccess.js';
import { notifySiteSupervisors, findSiteSupervisors, notifyAdmins, notifyUser } from '../utils/notify.js';
import { placeMiddayArrival, assertNotMovedOn } from '../utils/handover.js';
import { supersedePendingRequests, notifySuperseded } from '../utils/transferRequests.js';
import TransferRequest from '../models/transferRequestModel.js';
import Leave from '../models/leaveModel.js';
import { normalizeUtcDay, utcDayKey, eachUtcDay, allocationSummaries, checkAnnualAgainstAllocations, matchEmployeeIds, MAX_LEAVE_RANGE_DAYS } from '../utils/leaveBalance.js';
import { recordAttendanceAudit, recordAttendanceAuditBatch, resolveActor, buildAuditRow, breaksChangeSummary, summarizeAttendanceEdit, joinChangeParts } from '../utils/attendanceAudit.js';
import { recordSiteActivity } from '../utils/siteActivity.js';
import { computeExpectedDraftRoster, touchSiteRosters, isWriteConflict } from '../utils/draftRoster.js';
import AttendanceDraftRow from '../models/attendanceDraftRowModel.js';
import { isCloudDraftEnabled } from '../utils/features.js';
import { isDriverPool, getDriverPoolId, driverEmployeeFilter, isDriverEmployee, validateDriverPoolSessions, DRIVER_TITLE_REGEX, isDriverTitle, DRIVER_ONLY_MESSAGE, nonPoolDriverSessionError } from '../utils/driverPool.js';
import { resolveDriverSplit, sessionJobIds, sameJobSet, hasSplitKey, buildSplitLookup } from '../utils/jobSplit.js';
import { isSiteScopedRole } from '../middlewares/rbac.js';
import { syncCurrentJobFromLatestSession } from '../utils/currentJobSync.js';
import { detectCrossedMidnight } from '../utils/crossedMidnight.js';
import { checkHolidayForDate, holidayInfoForEmployee } from '../utils/holidayInfo.js';
import { createBackfilledRecord } from '../utils/backfillRecord.js';

// Shape of the auto-remark written when a record is toggled to LOP (Loss of Pay):
// "Deduct <amount> OMR". Used to recognise (and clear) a previously auto-filled LOP
// remark on toggle-off regardless of the configured amount, while leaving a genuine
// manual supervisor remark untouched.
const LOP_REMARK_RE = /^Deduct\b.*\bOMR$/;

// Apply (or clear) the LOP auto-remark on a record. Toggling LOP on writes
// "Deduct <amount> OMR"; toggling it off clears the remark only when it still matches
// the auto shape, so a manually edited note is preserved. Mirrors the inline logic in
// updateAttendance for the other (submit/bulk/backfill) write paths.
const applyLopRemark = (doc, lopOn, amount) => {
  if (lopOn) {
    doc.remark = `Deduct ${amount ?? 3.5} OMR`;
  } else if (LOP_REMARK_RE.test(doc.remark || "")) {
    doc.remark = "";
  }
};




// --- SHIFT HELPERS ---
// Combining a time onto a business day lives in utils/timeLocal.js (combineFromOffset /
// deriveOffsets) — cross-midnight is an explicit per-session day offset, not a cutoff.

function toLocalTimeString(dateVal, offsetVal) {
  if (!dateVal) return null;
  const dateObj = new Date(dateVal);
  if (isNaN(dateObj.getTime())) return null;
  const localTime = new Date(dateObj.getTime() - offsetVal * 60 * 1000);
  const h = String(localTime.getUTCHours()).padStart(2, '0');
  const m = String(localTime.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}


// ---------------------------------------------------------------------------
// LEAVE helpers — annual PAID leave and (unpaid, excused) EMERGENCY leave. The
// date helpers and the annual balance (date-range allocations) live in
// utils/leaveBalance.js.
// ---------------------------------------------------------------------------

// Leave grant type → the Attendance flag its days carry. Annual leave is PAID (and
// draws on the employee's allocations); emergency leave is EXCUSED but UNPAID (no cap).
const LEAVE_FLAG = { annual: "isPaidLeave", emergency: "isEmergencyLeave" };
const LEAVE_LABEL = { annual: "annual leave", emergency: "emergency leave" };

// A day already carrying a granted leave of EITHER type. A day holds at most one
// grant — cancel it to grant the other type. (A function so each query gets its own
// filter object.)
const grantedLeaveFilter = () => ({ $or: [{ isPaidLeave: true }, { isEmergencyLeave: true }] });
const isGrantedLeaveDay = (record) => !!(record && (record.isPaidLeave || record.isEmergencyLeave));

// Message for a write refused because the day is a granted leave day.
const leaveLockedMessage = (record) =>
  record?.isEmergencyLeave
    ? "This day is approved emergency leave. Edit or cancel it on the Leave page."
    : "This day is approved annual leave. Edit or cancel it on the Leave page.";

// The app's current calendar year — from the LOCAL business day, not UTC (which is
// still last year between 00:00 and the offset on 1 January).
const currentLocalYear = () => Number(getTodayLocal().slice(0, 4));

// A validation failure raised inside a leave transaction callback: the handler turns
// it into the HTTP reply after withTransaction has aborted.
class LeaveHttpError extends Error {
  constructor(status, body) {
    super(body?.message || "Leave request failed");
    this.status = status;
    this.body = { success: false, ...body };
  }
}

// Emergency leave days an employee took in a calendar year, minus `ignoreDates` (the
// days of a leave being edited). Informational only — emergency leave has no cap.
async function emergencyDaysInYear(employeeId, year, ignoreDates = null) {
  const docs = await Attendance.find(
    {
      employee: employeeId,
      isEmergencyLeave: true,
      date: {
        $gte: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
        $lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      },
    },
    "date"
  ).lean();
  if (!ignoreDates) return docs.length;
  return docs.filter((d) => !ignoreDates.has(utcDayKey(d.date))).length;
}

// Whether a UTC-midnight date is a weekly holiday under this config.
function isWeeklyHolidayUtc(date, weeklyHolidays) {
  if (!Array.isArray(weeklyHolidays) || weeklyHolidays.length === 0) return false;
  const dayName = new Date(date)
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase();
  return weeklyHolidays.includes(dayName);
}

// Classify every day in [from, to] for a leave grant, using ONE attendance query
// and ONE custom-holiday query (rather than per-day lookups). Returns the days to
// mark plus the buckets that are skipped and why. `existingRecords` maps a UTC day
// key → the (lean or full) Attendance doc so callers can update in place.
//   - toMark:        [{ date, key, created }]  working days that will become leave
//   - holidayDays:   [dates]  weekly or public holidays (never consume a day)
//   - conflictDays:  [dates]  the employee already worked (has a check-in) — protected
//   - alreadyLeave:  [dates]  already a granted leave day, of either type (no re-count)
// `ignoreDates` (a Set of day keys) are leave days to treat as free — the days of the
// leave being edited, for the read-only edit preview.
async function classifyLeaveRange({ employeeId, from, to, workConfig, session = null, ignoreDates = null }) {
  const days = eachUtcDay(from, to);
  const start = days[0];
  const end = days[days.length - 1];

  const holidayQuery = customHolidayModel
    .find({
      date: { $gte: start, $lte: new Date(new Date(end).setUTCHours(23, 59, 59, 999)) },
    })
    .lean();
  // Attendance docs are fetched as full documents (not lean) so a grant can
  // update an existing record in place and .save() it through the invariant hook.
  const attendanceQuery = Attendance.find({
    employee: employeeId,
    date: { $gte: start, $lte: end },
  });

  let customHolidays;
  let attendanceDocs;
  if (session) {
    // Inside a transaction the reads MUST run one at a time: parallel operations on
    // a transaction's session are unsupported by the driver and intermittently fail
    // (NoSuchTransaction when the command carrying startTransaction loses the race).
    customHolidays = await holidayQuery.session(session);
    attendanceDocs = await attendanceQuery.session(session);
  } else {
    [customHolidays, attendanceDocs] = await Promise.all([holidayQuery, attendanceQuery]);
  }

  const holidayKeys = new Set(customHolidays.map((h) => utcDayKey(h.date)));
  const recordByKey = new Map();
  for (const doc of attendanceDocs) recordByKey.set(utcDayKey(doc.date), doc);

  const weeklyHolidays = workConfig?.weeklyHolidays || [];

  const toMark = [];
  const holidayDays = [];
  const conflictDays = [];
  const alreadyLeave = [];

  for (const date of days) {
    const key = utcDayKey(date);

    if (isWeeklyHolidayUtc(date, weeklyHolidays) || holidayKeys.has(key)) {
      holidayDays.push(date);
      continue;
    }

    const record = recordByKey.get(key);
    if (record) {
      const hasFilledSession = Array.isArray(record.sessions)
        ? record.sessions.some((s) => s && (s.checkIn || s.checkOut))
        : false;
      if (hasFilledSession) {
        conflictDays.push(date);
        continue;
      }
      if (isGrantedLeaveDay(record) && !ignoreDates?.has(key)) {
        alreadyLeave.push(date);
        continue;
      }
    }

    toMark.push({ date, key, created: !record });
  }

  return { toMark, holidayDays, conflictDays, alreadyLeave, recordByKey };
}

/**
 * Automatically sets the check-out time of a previous session at a different site
 * to the check-in time of the current session, if the previous session is check-in only.
 */
function autoClosePreviousSiteSessions(sessions, timezoneOffset = null) {
  if (!Array.isArray(sessions) || sessions.length <= 1) return sessions;

  // 1. Sort sessions chronologically by checkIn time. Empty check-ins go last.
  const sorted = [...sessions].sort((a, b) => {
    if (!a.checkIn && !b.checkIn) return 0;
    if (!a.checkIn) return 1;
    if (!b.checkIn) return -1;
    return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
  });

  let fallbackOffset = -330;
  if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
    const parsedFallback = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
    if (!isNaN(parsedFallback)) {
      fallbackOffset = parsedFallback;
    }
  }

  let offsetVal = fallbackOffset;
  if (timezoneOffset !== null && timezoneOffset !== undefined) {
    const parsed = parseInt(timezoneOffset, 10);
    if (!isNaN(parsed)) {
      offsetVal = parsed;
    }
  }

  // 2. Process sessions
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (!current.checkIn) continue;

    // Search backwards for the most recent session from a different site that is open
    for (let j = i - 1; j >= 0; j--) {
      const prev = sorted[j];
      if (!prev.checkIn) continue; // Skip empty check-ins

      const diffSite = prev.siteId && current.siteId && prev.siteId.toString() !== current.siteId.toString();
      const prevIsOpen = !prev.checkOut;

      if (diffSite && prevIsOpen) {
        // Set prev checkout to current checkin
        prev.checkOut = current.checkIn;

        // Recalculate worked hours
        const inTime = new Date(prev.checkIn);
        const outTime = new Date(prev.checkOut);
        let workedHours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);
        if (workedHours < 0) workedHours = 0;
        prev.workedHours = Number(workedHours.toFixed(2));

        // Recalculate the cross-midnight flag cutoff-free: the closed session spans
        // midnight when its check-out wall time reads earlier than its check-in. The
        // pre-save hook re-derives the authoritative raw+offset from the Dates.
        let sessionIsNight = prev.isNightShift || false;
        const inStr = toLocalTimeString(prev.checkIn, offsetVal);
        const outStr = toLocalTimeString(prev.checkOut, offsetVal);
        if (inStr && outStr) {
          const [prevInH, prevInM] = inStr.split(":").map(Number);
          const [prevOutH, prevOutM] = outStr.split(":").map(Number);
          if (prevOutH * 60 + prevOutM < prevInH * 60 + prevInM) {
            sessionIsNight = true;
          }
        }
        prev.isNightShift = sessionIsNight;

        break; // Only close the most recent previous session
      }
    }
  }

  return sorted;
}



// --- ADMINS ---


// POST /api/attendance/submit



//PATCH /api/attendance/unlock
export const unlockAttendance = async (req, res) => {
  try {
    const { siteId, date } = req.body

    const parsedDate = new Date(date)
    parsedDate.setUTCHours(0, 0, 0, 0)

    const lock = await AttendanceLock.findOneAndUpdate(
      { siteId, date: parsedDate },
      {
        isLocked: false,
        unlockedBy: req.user?.id || '69f33152d121b1a10b175d46',
        unlockedAt: new Date()
      },
      { new: true }
    )

    res.json({ message: "Attendance unlocked", lock })

  } catch (err) {
    res.status(500).json({ message: "Failed to unlock", error: err.message })
  }
} //

// Longest span the date-range report accepts (a year, leap-safe).
const MAX_REPORT_RANGE_DAYS = 366;

// Per-employee hours report over an inclusive span of business days. `fromDay` and
// `toDay` are UTC midnights (how Attendance.date is stored). Shared by the monthly
// report and the date-range report. Returns `{ report, unmarkedAsAbsent }`, or null when
// the work schedule is missing.
async function buildAttendanceReport(fromDay, toDay) {
  const [employees, attendances, workConfig, customHolidays] =
    await Promise.all([
      empModel.find({}).lean(),

      Attendance.find({
        date: {
          $gte: fromDay,
          $lte: toDay,
        },
      }).lean(),

      workModel.findOne({ type: "default" }).lean(),

      customHolidayModel.find({
        date: {
          $gte: fromDay,
          $lte: new Date(toDay.getTime() + 86400000 - 1),
        },
      }).lean(),
    ]);

  if (!workConfig) return null;

  // Working days = EVERY calendar day of the span, holidays included — like ERPNext's
  // "Include holidays in Total no. of Working Days" — and the whole span, not just the
  // days so far, so a month's figure is the one its salary slip will show.
  const spanDays = eachUtcDay(fromDay, toDay);
  const workingDays = spanDays.length;

  // Unmarked days (no record at all) are only checked up to YESTERDAY — see
  // utils/unmarkedDays.js. countUnmarkedAsAbsent decides whether they are deducted.
  const countableDays = buildCountableDays(
    spanDays,
    workConfig.weeklyHolidays || [],
    customHolidays
  );
  const countUnmarked = unmarkedAsAbsent(workConfig);

  const attendanceMap = new Map();

  for (const attendance of attendances) {
    const employeeId =
      attendance.employee.toString();

    if (!attendanceMap.has(employeeId)) {
      attendanceMap.set(employeeId, []);
    }

    attendanceMap
      .get(employeeId)
      .push(attendance);
  }

  const round = (num) =>
    Number(num.toFixed(2));

  const report = employees.map(
    (employee) => {
      const records =
        attendanceMap.get(
          employee._id.toString()
        ) || [];

      let fullDays = 0;
      let halfDays = 0;
      let overtimeHours = 0;
      let holidayHours = 0;
      let leaveDays = 0;
      let noReasonAbsentDays = 0;
      let emergencyLeaveDays = 0;
      let sickLeaveDays = 0;
      let lopDays = 0;
      let pendingDays = 0;

      // Temporary workers have no days off: their records are never holidays, so a
      // holiday they don't work is an absence like any other day.
      const isTemporary = employee.employmentType === "temporary";

      // Every record is classified exactly as the ERPNext Attendance CSV classifies it
      // (classifyPayrollDay), so Payment Days here equals the salary slip's.
      for (const record of records) {
        // Hours: a holiday's net worked hours are tracked as holidayHours (overtime
        // is already forced to 0 upstream on holidays); a working day adds its OT.
        if (record.isHoliday) {
          holidayHours += record.holidayHours || 0;
        } else {
          overtimeHours += record.overtimeHours || 0;
        }

        const day = classifyPayrollDay(record);
        if (day.kind === "annual") leaveDays += 1;
        else if (day.kind === "full") fullDays += 1;
        else if (day.kind === "half") halfDays += 1;
        else if (day.kind === "absent") {
          if (day.reason === "emergency") emergencyLeaveDays += 1;
          else if (day.reason === "sick") sickLeaveDays += 1;
          else if (day.reason === "lop") lopDays += 1;
          else {
            noReasonAbsentDays += 1;
            // Checked in, no check-out yet: counted as absent, flagged so it can be
            // closed before the export.
            if (hasOpenSession(record)) pendingDays += 1;
          }
        }
        // "holiday" — a paid day off, or holiday work paid as holiday hours: no day bucket.
      }

      // Days before today with no record at all — not in the ERPNext CSV, so ERPNext
      // treats them per its "Consider Unmarked Attendance As" setting, mirrored by
      // countUnmarkedAsAbsent: Absent → they are plain absences (in "no reason", so the
      // four reasons still sum to absentDays); Present → they count as paid.
      const unmarkedDays = countUnmarkedDays(employee, records, countableDays);
      if (countUnmarked) noReasonAbsentDays += unmarkedDays;

      // The unpaid days: everything ERPNext counts as "Absent".
      const absentDays =
        noReasonAbsentDays + emergencyLeaveDays + sickLeaveDays + lopDays;

      // A half day deducts half a day (ERPNext: Half Day + Leave Without Pay).
      const paymentDays = Math.max(
        workingDays - absentDays - 0.5 * halfDays,
        0
      );

      // OT and holiday hours are paid at the same rate, so they combine into a
      // single "total OT" figure for reporting.
      const totalOvertimeHours = overtimeHours + holidayHours;

      const attendancePercentage = workingDays > 0
        ? (paymentDays / workingDays) * 100
        : 0;

      return {
        // Mongo id — the Reports page sends these to pick employees for the ERPNext export.
        _id: employee._id,
        employeeName: employee.name,
        employeeId: employee.employeeId,
        jobTitle: employee.jobTitle,
        isActive: employee.isActive !== false,
        // Anything not temporary is permanent (same rule as the job report's filter).
        employmentType: isTemporary ? "temporary" : "permanent",

        workingDays,
        paymentDays: round(paymentDays),
        fullDays,
        halfDays,
        // Total unpaid absence, and its composition.
        absentDays,
        noReasonAbsentDays,
        emergencyLeaveDays,
        sickLeaveDays,
        lopDays,
        // Subset of noReasonAbsentDays: open check-ins.
        pendingDays,
        // Annual (paid) leave — never in absentDays.
        leaveDays,
        // Days with no record; part of noReasonAbsentDays when unmarkedAsAbsent.
        unmarkedDays,

        attendancePercentage: round(
          attendancePercentage
        ),

        overtimeHours: round(
          overtimeHours
        ),

        holidayHours: round(
          holidayHours
        ),

        totalOvertimeHours: round(
          totalOvertimeHours
        ),
      };
    }
  );

  report.sort((a, b) => {
    const aActive = a.isActive !== false;
    const bActive = b.isActive !== false;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return a.employeeName.localeCompare(b.employeeName);
  });

  return { report, unmarkedAsAbsent: countUnmarked };
}

//GET /api/attendance/reports/monthly/:month/:year
export const monthlyReport = async (req, res) => {
  try {
    const { month, year } = req.params;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year are required",
      });
    }

    const monthNum = Number(month);
    const yearNum = Number(year);

    if (
      isNaN(monthNum) ||
      isNaN(yearNum) ||
      monthNum < 1 ||
      monthNum > 12
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid month or year",
      });
    }

    // First and last day of the month, as UTC midnights.
    const fromDay = new Date(Date.UTC(yearNum, monthNum - 1, 1));
    const toDay = new Date(Date.UTC(yearNum, monthNum, 0));

    const built = await buildAttendanceReport(fromDay, toDay);

    if (!built) {
      return res.status(404).json({
        success: false,
        message: "Work schedule configuration not found",
      });
    }

    return res.status(200).json({
      success: true,
      month: monthNum,
      year: yearNum,
      report: built.report,
      // Whether unmarked days are already counted in absentDays (WorkSchedule setting).
      unmarkedAsAbsent: built.unmarkedAsAbsent,
    });
  }

  catch (error) {
    console.error(
      "monthlyReport error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to generate monthly report",
      error: error.message,
    });
  }
}; //

// GET /api/attendance/reports/range?from=YYYY-MM-DD&to=YYYY-MM-DD
// The monthly report over any inclusive span of business days (at most a year).
export const rangeReport = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: "from and to are required",
      });
    }

    // Strict "YYYY-MM-DD": the round trip rejects impossible days like 2026-02-31,
    // which Date would otherwise roll over into March.
    const parseDay = (value) => {
      const text = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
      const day = normalizeUtcDay(text);
      return day && utcDayKey(day) === text ? day : null;
    };
    const fromDay = parseDay(from);
    const toDay = parseDay(to);

    if (!fromDay || !toDay) {
      return res.status(400).json({
        success: false,
        message: "from and to must be YYYY-MM-DD dates",
      });
    }

    if (fromDay.getTime() > toDay.getTime()) {
      return res.status(400).json({
        success: false,
        message: "'from' must be on or before 'to'",
      });
    }

    const spanDays =
      Math.round((toDay.getTime() - fromDay.getTime()) / 86400000) + 1;

    if (spanDays > MAX_REPORT_RANGE_DAYS) {
      return res.status(400).json({
        success: false,
        message: `Range too large (max ${MAX_REPORT_RANGE_DAYS} days)`,
      });
    }

    const built = await buildAttendanceReport(fromDay, toDay);

    if (!built) {
      return res.status(404).json({
        success: false,
        message: "Work schedule configuration not found",
      });
    }

    return res.status(200).json({
      success: true,
      from: utcDayKey(fromDay),
      to: utcDayKey(toDay),
      report: built.report,
      unmarkedAsAbsent: built.unmarkedAsAbsent,
    });
  } catch (error) {
    console.error("rangeReport error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate attendance report",
      error: error.message,
    });
  }
};


export const jobReport = async (req, res) => {
  try {
    // Optional month scope. No params → all-time ("entire life cycle", the default).
    // Both present → restrict to that calendar month; anything else is a bad request.
    const { month, year } = req.query;
    const hasMonth = month !== undefined && month !== "";
    const hasYear = year !== undefined && year !== "";

    let dateMatch = [];
    let scopeMonth = null;
    let scopeYear = null;

    if (hasMonth || hasYear) {
      const monthNum = Number(month);
      const yearNum = Number(year);
      if (
        !hasMonth ||
        !hasYear ||
        isNaN(monthNum) ||
        isNaN(yearNum) ||
        monthNum < 1 ||
        monthNum > 12 ||
        yearNum < 2000 ||
        yearNum > 3000
      ) {
        return res.status(400).json({
          success: false,
          message: "Provide both a valid month (1-12) and year, or omit both for all-time.",
        });
      }

      // Attendance.date is stored at UTC midnight of the business day (see the mark
      // controller), so build the range with Date.UTC to match it regardless of the
      // server's own timezone. End is exclusive: first instant of the next month.
      const startDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
      const endDate = new Date(Date.UTC(yearNum, monthNum, 1));
      dateMatch = [{ $match: { date: { $gte: startDate, $lt: endDate } } }];
      scopeMonth = monthNum;
      scopeYear = yearNum;
    }

    // Optional employment-type scope ("temporary" | "permanent"); absent = everyone.
    // Uses the employee's CURRENT type. Permanent is "not temporary" so legacy docs
    // without the field still count.
    const { employmentType } = req.query;
    let employeeMatch = [];
    if (employmentType !== undefined && employmentType !== "") {
      if (employmentType !== "temporary" && employmentType !== "permanent") {
        return res.status(400).json({
          success: false,
          message: 'employmentType must be "temporary" or "permanent", or omitted for everyone.',
        });
      }
      const empFilter = employmentType === "temporary"
        ? { employmentType: "temporary" }
        : { employmentType: { $ne: "temporary" } };
      const employeeIds = await Employee.find(empFilter).distinct("_id");
      employeeMatch = [{ $match: { employee: { $in: employeeIds } } }];
    }

    // Per-session apportionment: each session takes its share of the record's
    // net / OT / holiday by its fraction of the day's raw worked hours.
    // Regular = net − (OT + holiday): the base-rate (normal-status) portion only.
    // On a holiday OT is 0 and holidayHours = net, so regular is 0 — those worked
    // hours belong to the holiday bucket (Total OT), not regular, and must not be
    // counted twice. Never negative (OT and holiday are mutually exclusive and
    // their sum never exceeds net; _rawTotal > 0 is guaranteed by the $match).
    // A driver session split across N jobs (utils/jobSplit.js) gives each job 1/N of it.
    const share = {
      $divide: [{ $ifNull: ["$sessions.workedHours", 0] }, { $multiply: ["$_rawTotal", { $max: ["$_n", 1] }] }],
    };
    const regularExpr = {
      $sum: {
        $multiply: [
          {
            $subtract: [
              { $ifNull: ["$totalWorkHours", 0] },
              { $add: [{ $ifNull: ["$overtimeHours", 0] }, { $ifNull: ["$holidayHours", 0] }] },
            ],
          },
          share,
        ],
      },
    };
    const overtimeExpr = { $sum: { $multiply: [{ $ifNull: ["$overtimeHours", 0] }, share] } };
    const holidayExpr = { $sum: { $multiply: [{ $ifNull: ["$holidayHours", 0] }, share] } };

    // Scope to the selected month / employment type (if any) FIRST, then keep
    // records with worked hours and unwind to one session per document.
    const basePipeline = [
      ...dateMatch,
      ...employeeMatch,
      { $addFields: { _rawTotal: { $sum: "$sessions.workedHours" } } },
      { $match: { _rawTotal: { $gt: 0 } } },
      { $unwind: "$sessions" },
      // The session's jobs: splitJobIds when non-empty, else [jobId] (see sessionJobIds).
      {
        $addFields: {
          _jobs: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$sessions.splitJobIds", []] } }, 0] },
              "$sessions.splitJobIds",
              { $cond: [{ $ifNull: ["$sessions.jobId", false] }, ["$sessions.jobId"], []] },
            ],
          },
        },
      },
      { $addFields: { _n: { $size: "$_jobs" } } },
    ];

    const [jobs, jobResults, unassignedResults] = await Promise.all([
      // Deleted jobs too: their logged hours still bill in the ERPNext timesheet, so the
      // report keeps them (flagged) — only deleted jobs with NO hours are dropped below.
      Job.find({})
        .populate("site", "siteName isActive isPermanent isDeleted isCompleted")
        .lean(),

      // Hours grouped by job (sessions that HAVE a job).
      Attendance.aggregate([
        ...basePipeline,
        { $match: { _n: { $gt: 0 } } },
        { $unwind: "$_jobs" },
        {
          $group: {
            _id: "$_jobs",
            regularHours: regularExpr,
            overtimeHours: overtimeExpr,
            holidayHours: holidayExpr,
          },
        },
      ]),

      // Hours grouped by SITE for sessions with NO job — otherwise these worked
      // hours are dropped from the report and every site total undercounts them.
      Attendance.aggregate([
        ...basePipeline,
        { $match: { _n: 0, "sessions.siteId": { $ne: null } } },
        {
          $group: {
            _id: "$sessions.siteId",
            regularHours: regularExpr,
            overtimeHours: overtimeExpr,
            holidayHours: holidayExpr,
          },
        },
      ]),
    ]);

    const round = (n) => Number((n || 0).toFixed(2));

    const hoursMap = new Map();
    for (const r of jobResults) hoursMap.set(r._id.toString(), r);

    const unassignedMap = new Map();
    for (const r of unassignedResults) {
      if (r._id) unassignedMap.set(r._id.toString(), r);
    }

    const siteMap = new Map();
    const ensureSite = (site) => {
      const siteId = site._id.toString();
      if (!siteMap.has(siteId)) {
        siteMap.set(siteId, {
          siteId,
          siteName: site.siteName,
          isActive: site.isActive !== false,
          isPermanent: site.isPermanent === true,
          isCompleted: site.isCompleted === true,
          isDeleted: site.isDeleted === true,
          jobs: [],
        });
      }
      return siteMap.get(siteId);
    };

    // Global jobs (no site) are logged from any site; they get one group of their own,
    // listed first, instead of a site's.
    const globalEntry = {
      siteId: "global",
      siteName: "Global jobs (all sites)",
      isActive: true,
      isPermanent: false,
      isCompleted: false,
      isGlobal: true,
      jobs: [],
    };

    // Real job rows.
    for (const job of jobs) {
      const h = hoursMap.get(job._id.toString());
      const ot = h ? h.overtimeHours : 0;
      const holiday = h ? h.holidayHours : 0;
      // A deleted job (or one on a deleted site) is listed only while it has hours.
      const isDeleted = job.isDeleted === true || job.site?.isDeleted === true;
      if (isDeleted && !(h && (h.regularHours || ot || holiday))) continue;

      let siteEntry;
      if (job.isGlobal) siteEntry = globalEntry;
      else if (job.site) siteEntry = ensureSite(job.site);
      else continue;

      siteEntry.jobs.push({
        jobId: job._id,
        jobCode: job.jobCode,
        jobName: job.name,
        isActive: job.isActive !== false,
        isCompleted: job.isCompleted === true,
        isDeleted,
        regularHours: round(h ? h.regularHours : 0),
        overtimeHours: round(ot),
        holidayHours: round(holiday),
        totalOTHours: round(ot + holiday),
      });
    }

    // Ensure sites that have ONLY job-less hours (no jobs at all) still appear.
    const missingSiteIds = [...unassignedMap.keys()].filter((id) => !siteMap.has(id));
    if (missingSiteIds.length) {
      // Deleted sites included: their job-less hours are real worked (and paid) hours.
      const missingSites = await Site.find(
        { _id: { $in: missingSiteIds } },
        "siteName isActive isPermanent isCompleted isDeleted"
      ).lean();
      for (const s of missingSites) ensureSite(s);
    }

    // Synthetic "Unassigned (no job)" row per site with job-less hours, so the
    // site total includes them and the rows still sum to the total.
    for (const [siteId, u] of unassignedMap) {
      const siteEntry = siteMap.get(siteId);
      if (!siteEntry) continue; // site deleted / not found

      const reg = round(u.regularHours);
      const ot = round(u.overtimeHours);
      const holiday = round(u.holidayHours);
      if (reg === 0 && ot === 0 && holiday === 0) continue;

      siteEntry.jobs.push({
        jobId: null,
        jobCode: null,
        jobName: "Unassigned (no job)",
        isActive: true,
        isCompleted: false,
        unassigned: true,
        regularHours: reg,
        overtimeHours: ot,
        holidayHours: holiday,
        totalOTHours: round(ot + holiday),
      });
    }

    const report = Array.from(siteMap.values()).sort((a, b) =>
      a.siteName.localeCompare(b.siteName)
    );
    if (globalEntry.jobs.length) {
      globalEntry.jobs.sort((a, b) => String(a.jobCode || a.jobName).localeCompare(String(b.jobCode || b.jobName)));
      report.unshift(globalEntry);
    }

    return res.status(200).json({
      success: true,
      month: scopeMonth,
      year: scopeYear,
      employmentType: employmentType || null,
      report,
    });
  } catch (error) {
    console.error("jobReport error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate job report",
    });
  }
};


//GET /api/attendance/daily-summary
export const getSummary = async (req, res) => {
  try {
    let targetDate;

    if (req.query.date) {
      targetDate = new Date(req.query.date);

      if (isNaN(targetDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date",
        });
      }
    } else {
      targetDate = new Date();
    }

    const startOfDay = new Date(targetDate);

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );

    const endOfDay = new Date(targetDate);

    endOfDay.setHours(
      23,
      59,
      59,
      999
    );

    // Active employees
    const totalEmployees =
      await empModel.countDocuments({
        isActive: true,
      });

    // Staff (white-collar) are excluded from man-hours / man-days stats but
    // still counted in headcount/attendance below.
    const staffIds = await getStaffEmployeeIds();
    const staffIdSet = new Set(staffIds.map((s) => s.toString()));

    // Attendance records for selected day
    const attendances =
      await Attendance.find({
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      }).lean();

    let presentToday = 0;

    let manHoursToday = 0;

    const siteMap = new Map();

    for (const attendance of attendances) {
      // Present count: count records with at least a session with a checkin filled (or status is fullday/halfday)
      const isPresent =
        attendance.status === "fullday" ||
        attendance.status === "halfday" ||
        (attendance.sessions &&
          attendance.sessions.some((s) => s.checkIn));
      if (isPresent) {
        presentToday++;
      }

      // Staff are excluded from all man-hours / per-site productivity stats.
      if (staffIdSet.has(attendance.employee.toString())) {
        continue;
      }

      // Total man hours
      manHoursToday +=
        attendance.totalWorkHours || 0;

      for (const session of attendance.sessions) {
        const siteId =
          session.siteId?.toString();

        if (!siteId) continue;

        if (!siteMap.has(siteId)) {
          siteMap.set(siteId, {
            siteId,
            manHoursToday: 0,

            // employeeId -> total hours worked
            employeeHours:
              new Map(),

            // Set of checked-in employee IDs
            checkedInEmployees: new Set(),
          });
        }

        const siteStats =
          siteMap.get(siteId);

        const employeeId =
          attendance.employee.toString();

        if (session.checkIn) {
          siteStats.checkedInEmployees.add(employeeId);
        }

        const workedHours =
          session.workedHours || 0;

        siteStats.manHoursToday +=
          workedHours;

        const existingHours =
          siteStats.employeeHours.get(
            employeeId
          ) || 0;

        siteStats.employeeHours.set(
          employeeId,
          existingHours +
            workedHours
        );
      }
    }

    // Active sites only
    const activeSites =
      await siteModel.find({
        isActive: true,
        isDeleted: { $ne: true }
      })
        .select("siteName")
        .lean();

    const activeSiteMap =
      new Map(
        activeSites.map((site) => [
          site._id.toString(),
          site,
        ])
      );

    const sites = [];

    for (const [
      siteId,
      stats,
    ] of siteMap.entries()) {
      const site =
        activeSiteMap.get(siteId);

      if (!site) continue;

      const employeesToday = stats.checkedInEmployees ? stats.checkedInEmployees.size : 0;

      sites.push({
        siteId,

        siteName: site.siteName,

        employeesToday,

        manHoursToday: Number(
          stats.manHoursToday.toFixed(
            2
          )
        ),

        averageHoursPerWorker:
          employeesToday > 0
            ? Number(
                (
                  stats.manHoursToday /
                  employeesToday
                ).toFixed(2)
              )
            : 0,
      });
    }

    sites.sort(
      (a, b) =>
        b.manHoursToday -
        a.manHoursToday
    );

    const attendancePercentage =
      totalEmployees > 0
        ? Number(
            (
              (presentToday /
                totalEmployees) *
              100
            ).toFixed(2)
          )
        : 0;

    return res.status(200).json({
      success: true,

      date:
        startOfDay
          .toISOString()
          .split("T")[0],

      attendance: {
        presentToday,
        totalEmployees,
        attendancePercentage,
      },

      totals: {
        manHoursToday: Number(
          manHoursToday.toFixed(2)
        ),
      },

      sites,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message:
        "Internal Server Error",
    });
  }
}; //


export const toggleHolidayStatus = async (req, res) => {
  const { date, isHoliday } = req.body

  if (!date) {
    return res.status(400).json({
      message: "Date is required",
    })
  }

  if (typeof isHoliday !== "boolean") {
    return res.status(400).json({
      message: "isHoliday must be a boolean",
    })
  }

  // Create day range in UTC
  const targetDate = new Date(date)
  targetDate.setUTCHours(0, 0, 0, 0)

  const startOfDay = new Date(targetDate)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const endOfDay = new Date(targetDate)
  endOfDay.setUTCHours(23, 59, 59, 999)

  // Check weekly holiday safeguard if trying to remove holiday status
  if (!isHoliday) {
    try {
      const workConfig = await workModel.findOne({ type: "default" })
      if (workConfig) {
        const weeklyHolidays = workConfig.weeklyHolidays || []
        const dayName = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase()
        if (weeklyHolidays.includes(dayName)) {
          return res.status(400).json({
            success: false,
            message: "Cannot remove weekly holidays",
          })
        }
      }
    } catch (error) {
      console.log(error)
      return res.status(500).json({
        message: "Failed to update holiday status",
      })
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update CustomHoliday collection
    if (isHoliday) {
      const existingHoliday = await customHolidayModel.findOne({
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      }).session(session)

      if (!existingHoliday) {
        await customHolidayModel.create([{
          date: startOfDay,
          reason: "Manual Holiday",
        }], { session })
      }
    } else {
      await customHolidayModel.deleteMany({
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      }).session(session)
    }

    // Update all attendance records for that day. Manual declaration is always a
    // PUBLIC holiday (weekly holidays can't be toggled — guarded above), so
    // holidayHours = net worked hours and overtime is zeroed. Removing the holiday
    // restores overtime from the stored net hours. Aggregation-pipeline update so
    // per-record totals can be derived in one bulk write.
    const overtimeThreshold = (await workModel.findOne({ type: "default" })
      .select("overtimeThreshold")
      .session(session))?.overtimeThreshold ?? 0

    // When DECLARING a holiday, skip temporary workers — a holiday is a normal
    // working day for them (no holiday hours, overtime not zeroed). Un-marking a
    // holiday can safely apply to everyone (it just clears holiday state).
    const dateMatch = { date: { $gte: startOfDay, $lte: endOfDay } }
    const updateMatch = isHoliday
      ? {
          ...dateMatch,
          employee: {
            $nin: await empModel
              .find({ employmentType: "temporary" })
              .distinct("_id")
              .session(session),
          },
        }
      : dateMatch

    const result = await Attendance.updateMany(
      updateMatch,
      isHoliday
        ? [
            {
              $set: {
                isHoliday: true,
                holidayReason: "public",
                holidayHours: { $ifNull: ["$totalWorkHours", 0] },
                overtimeHours: 0,
              },
            },
          ]
        : [
            {
              $set: {
                isHoliday: false,
                holidayReason: null,
                holidayHours: 0,
                overtimeHours: {
                  $round: [
                    {
                      $max: [
                        { $subtract: [{ $ifNull: ["$totalWorkHours", 0] }, overtimeThreshold] },
                        0,
                      ],
                    },
                    2,
                  ],
                },
              },
            },
          ],
      // Mongoose requires this opt-in to accept an aggregation pipeline update
      { updatePipeline: true }
    ).session(session)

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: isHoliday
        ? "Day marked as holiday successfully"
        : "Holiday removed successfully",

      modifiedCount: result.modifiedCount,
    })
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error)

    return res.status(500).json({
      message: "Failed to update holiday status",
    })
  }
} 


// pst req to /api/attendance/submit
export const siteFirstSubmitAttendance = async (req, res) => {
  const {
    siteId,
    date,
    isHoliday = false,
    attendance,
  } = req.body

  const markedBy = req.user?.id
  const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
    ? process.env.APP_TIMEZONE_OFFSET
    : req.headers['x-timezone-offset']

  // -----------------------------
  // VALIDATION (outside transaction)
  // -----------------------------
  if (!siteId || !date || !Array.isArray(attendance) || attendance.length === 0) {
    return res.status(400).json({
      success: false,
      message: "siteId, date and attendance are required",
    })
  }

  const attendanceDate = new Date(date)
  attendanceDate.setUTCHours(0, 0, 0, 0)

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const throwValidationError = (status, message, extra = {}) => {
      const err = new Error(message);
      err.status = status;
      err.extra = extra;
      throw err;
    };

    // LOCK CHECK (site-first guarantee). ANY lock doc counts — an admin-unlocked day is still
    // "submitted" (the page shows its saved records, matching checkPending), and re-running the
    // draft submit would only hit the {siteId, date} unique index. 409 + a code so the page
    // can switch to the saved sheet instead of leaving a dead draft on screen (typically a
    // second supervisor whose page loaded before the first one saved).
    const existingLock = await AttendanceLock.findOne({
      siteId,
      date: attendanceDate,
    })
      .populate("lockedBy", "name")
      .session(session)

    if (existingLock) {
      throwValidationError(409, "Attendance for this site was already submitted", alreadySubmittedExtra(existingLock));
    }

    // Claim this site's roster for the rest of the transaction: a Send-to-site / accepted
    // request moving someone on or off this site while we submit writes the same Site doc, so
    // one of the two aborts (→ SUBMIT_CONFLICT below) instead of this submit locking the day
    // against a roster that changed underneath it.
    await touchSiteRosters([siteId], session);

    // ROSTER GUARD. The client builds its draft once, from the roster at page load; a
    // supervisor can then submit minutes or hours later. Refuse a submit whose employee set no
    // longer matches the site's current draft roster — otherwise an employee added since then
    // gets NO record (and the locked sheet never shows them), and one who has left gets a
    // phantom record here. Only for the current business day: there is no historical roster to
    // compare a past day's sheet against. Runs before any write, so a refusal persists nothing.
    const submittedIds = attendance.map((e) => String(e?.employee?._id ?? ""));
    if (submittedIds.some((id) => !id)) {
      throwValidationError(400, "employee is required");
    }
    if (new Set(submittedIds).size !== submittedIds.length) {
      throwValidationError(400, "The same employee appears more than once in this submission");
    }
    const dateStr = attendanceDate.toISOString().slice(0, 10);
    if (dateStr === getTodayLocal()) {
      const expected = await computeExpectedDraftRoster({ siteId, dateStr, session });
      const submittedSet = new Set(submittedIds);
      const added = [...expected.values()].filter((e) => !submittedSet.has(e._id));
      const removedIds = submittedIds.filter((id) => !expected.has(id));
      if (added.length || removedIds.length) {
        const removedDocs = await empModel
          .find({ _id: { $in: removedIds.filter((id) => mongoose.isValidObjectId(id)) } }, "name employeeId")
          .session(session)
          .lean();
        const removedById = new Map(removedDocs.map((e) => [String(e._id), e]));
        const removed = removedIds.map((id) => ({
          _id: id,
          name: removedById.get(id)?.name ?? null,
          employeeId: removedById.get(id)?.employeeId ?? null,
        }));
        throwValidationError(409, rosterChangedMessage(added, removed), {
          code: "ROSTER_CHANGED",
          rosterChange: { added, removed },
        });
      }
    }

    // DRAFT GUARD (shared cloud draft). Each posted row names the rev of the shared draft row
    // it reflects (0 = untouched, derived from defaults). If another supervisor changed a row
    // since, refuse — the submitter must see that change before it's saved over. Clients that
    // predate the cloud draft send no draftRev and pass while no one has shared edits.
    if (isCloudDraftEnabled()) {
      const storedRows = await AttendanceDraftRow.find(
        { siteId, date: attendanceDate },
        "employee rev updatedByName"
      )
        .session(session)
        .lean();
      const storedById = new Map(storedRows.map((r) => [String(r.employee), r]));
      const stale = attendance.filter((entry) => {
        const stored = storedById.get(String(entry.employee._id));
        return (Number(entry.draftRev) || 0) !== (stored?.rev ?? 0);
      });
      if (stale.length) {
        const rows = stale.map((entry) => ({
          employee: String(entry.employee._id),
          name: entry.employee?.name ?? null,
          updatedByName: storedById.get(String(entry.employee._id))?.updatedByName ?? null,
        }));
        throwValidationError(
          409,
          `Another device changed ${rows.length} row(s) on this sheet (${rows
            .slice(0, 5)
            .map((r) => r.name || "an employee")
            .join(", ")}). Review them and save again.`,
          { code: "DRAFT_CHANGED", rows }
        );
      }
    }

    const workConfig = await workModel.findOne().session(session)
    if (!workConfig) {
      throwValidationError(404, "Work configuration not found");
    }

    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
    } = workConfig

    const processedRecords = []
    const holidayInfo = await checkHolidayForDate(attendanceDate);

    // Cross-day guard: a session can extend past midnight, so it may collide with a session
    // stored on an ADJACENT day's record (e.g. yesterday's night shift ending 08:00 vs a
    // 06:00 start today). Prefetched once for the whole batch.
    const crossDayConflict = await buildCrossDayOverlapChecker({
      employeeIds: attendance.map((e) => e?.employee?._id).filter(Boolean),
      date: attendanceDate,
      dbSession: session,
    });

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

    // Drivers sheet (the hidden pool site): every session stays on the pool and, once it has a
    // time, must name the job it was for — any active job at a live site.
    const driverSheet = await isDriverPool(siteId, session);
    // Site sheet: once the site has a live job, every session with a time must name one.
    const siteJobRequired = !driverSheet && (await siteHasLiveJobs(siteId, session));

    // -----------------------------
    // MAIN LOOP (EMPLOYEES)
    // -----------------------------
    for (const entry of attendance) {
      const {
        employee,
        employeeId,
        jobId,
        sessions,
        breaksTaken = null,
        isSickLeave = false,
        isLop = false,
      } = entry

      const empId = employee?._id

      if (!empId) {
        throwValidationError(400, "employee is required");
      }

      if (!Array.isArray(sessions)) {
        throwValidationError(400, "sessions must be an array");
      }

      let attendanceDoc = await Attendance.findOne({
        employee: empId,
        date: attendanceDate,
      }).session(session)

      // APPROVED PAID LEAVE is a locked day: never overwrite the leave record with a
      // submitted session (that would silently drop the leave AND hand back the balance
      // day, since usage is derived from these flags). Skip the employee entirely —
      // their existing leave record stays intact. An admin must cancel the leave to
      // record work. The client hides/locks these rows, so this is a safety net.
      // Granted EMERGENCY leave is locked the same way.
      if (isGrantedLeaveDay(attendanceDoc)) {
        continue;
      }

      if (!attendanceDoc) {
        attendanceDoc = new Attendance({
          employee: empId,
          date: attendanceDate,
          siteId,
          jobId: jobId || null,
          markedBy,
          isHoliday: holidayInfo.isHoliday,
          holidayReason: holidayInfo.reason,
          status: "absent",
          sessions: [],
        })
      }

      // Snapshot state before mutation for the audit log: whether this is the first save
      // of the day (submitted) vs a merge/edit into an existing record, and the prior
      // break override so a change can be logged distinctly.
      const wasNew = attendanceDoc.isNew;
      const prevBreaks = attendanceDoc.breaksTaken ?? null;

      // Look up a pending transfer targeting THIS site/date so the resulting
      // session carries its source site (powers the "Transferred from <Site>"
      // indicator once attendance is saved). The stash itself is cleared after
      // save, below.
      const empPending = await empModel.findById(empId)
        .select("pendingTransferSiteId pendingTransferDate pendingTransferFromSiteId employmentType name jobTitle")
        .session(session)

      // Drivers live only on the Drivers sheet — never recorded on a site's sheet.
      if (!driverSheet && isDriverTitle(empPending?.jobTitle)) {
        throwValidationError(400, `${empPending.name}: ${DRIVER_ONLY_MESSAGE}`, { code: "DRIVER_ONLY" })
      }

      // Temporary workers are exempt from holiday treatment — for them a holiday
      // is a normal working day (normal hours + OT, no holiday-hours credit).
      const effHolidayInfo = holidayInfoForEmployee(holidayInfo, empPending?.employmentType)

      const transferredFromForSite =
        empPending?.pendingTransferSiteId &&
          empPending.pendingTransferSiteId.toString() === siteId.toString() &&
          empPending.pendingTransferDate &&
          new Date(empPending.pendingTransferDate).getTime() === attendanceDate.getTime()
          ? empPending.pendingTransferFromSiteId
          : null

      // -----------------------------
      // BUILD SESSIONS
      // -----------------------------
      const updatedSessions = []

      // Sessions this record already holds at OTHER sites — part of the same physical
      // timeline, so a site-switch continuation inherits their midnight crossing.
      const otherSiteSessions =
        attendanceDoc.sessions.filter(
          (s) =>
            s.siteId.toString() !==
            siteId.toString()
        )

      // Cutoff-free (cutoff redesign): cross-midnight is an explicit per-session fact.
      // Resolved as a MONOTONIC timeline over the record — the check-out rolls to the next
      // day when it reads earlier than the check-in, and a session that would land before a
      // crossing already made inherits it (19:00→01:00 then 01:00→08:00). An explicit
      // client flag (checkInNextDay / checkOutNextDay) always wins, which is what expresses
      // the two cases the clock cannot disambiguate: a standalone early-morning tail and
      // shifts of 24h+.
      const resolvedOffsets = resolveDayOffsets(
        date,
        sessions.map((s) => ({
          rawCheckIn: s.checkIn,
          rawCheckOut: s.checkOut,
          checkInNextDay: s.checkInNextDay,
          checkOutNextDay: s.checkOutNextDay,
          startsAfterMidnight: s.startsAfterMidnight,
        })),
        otherSiteSessions
      )

      for (const [sessionIndex, sessionObj] of sessions.entries()) {
        const {
          siteId: sessionSiteId,
          job,
          checkIn,
          checkOut,
          manuallyCleared = false,
          jobPicked = false,
        } = sessionObj

        const finalSiteId = driverSheet ? siteId : (sessionSiteId || siteId)

        const { checkInNextDay, checkOutNextDay } = resolvedOffsets[sessionIndex]

        const boundsError = validateSessionTimesV2(checkIn, checkOut, checkInNextDay, checkOutNextDay);
        if (boundsError) {
          throwValidationError(400, boundsError);
        }

        // Drivers sheet: the session names a SITE (or General) plus the jobs of it its hours
        // are split equally across (utils/jobSplit.js). An older draft that still carries a
        // single `job` counts as a one-job split.
        let driverSplit = null;
        if (driverSheet && (checkIn || checkOut)) {
          const pickedJobIds = Array.isArray(sessionObj.splitJobIds)
            ? sessionObj.splitJobIds
            : job?._id ? [job._id] : [];
          driverSplit = await resolveDriverSplit(pickedJobIds, { strict: true, session });
          if (!driverSplit) {
            throwValidationError(
              400,
              `Pick the site ${employee?.name || "this driver"} worked for${pickedJobIds.length ? " (the selected site or one of its jobs is no longer active)" : ""}`
            );
          }
        }

        if (siteJobRequired && (checkIn || checkOut) && !job?._id) {
          throwValidationError(
            400,
            `Pick a job for ${employee?.name || "this employee"}'s session`,
            { code: "JOB_REQUIRED" }
          );
        }

        // Site sheet: a job the supervisor PICKED in the draft must be an active job of this
        // site or a live global job. Only picked jobs are checked, so a stale roster job never
        // blocks a submit.
        if (!driverSheet && jobPicked && job?._id && !(await findSessionJob(job._id, siteId, session))) {
          throwValidationError(
            400,
            `The job picked for ${employee?.name || "this employee"} is no longer active at this site`
          );
        }

        const checkInDate = checkIn ? combineFromOffset(date, checkIn, checkInNextDay) : null
        const checkOutDate = checkOut ? combineFromOffset(date, checkOut, checkOutNextDay) : null

        let workedHours = 0
        // VALID SESSION ONLY IF BOTH EXIST
        if (checkInDate && checkOutDate) {
          if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
            throwValidationError(400, "Invalid checkIn/checkOut");
          }
          workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60)
          if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
            throwValidationError(400, "Invalid shift duration");
          }
        }

        // RULE: checkIn only OR null/null → 0 hours
        updatedSessions.push({
          siteId: finalSiteId,
          jobId: driverSheet ? null : job?._id || null,
          servedSiteId: driverSplit?.servedSiteId ?? null,
          splitJobIds: driverSplit?.splitJobIds ?? [],
          checkIn: checkInDate,
          checkOut: checkOutDate,
          rawCheckIn: checkIn || null,
          rawCheckOut: checkOut || null,
          checkInNextDay,
          checkOutNextDay,
          workedHours: Number(workedHours.toFixed(2)),
          markedBy,
          // Retained for back-compat reads: a session "crosses midnight" when either
          // endpoint lands on the next day. The pre-save hook re-derives raw+offset.
          isNightShift: checkInNextDay || checkOutNextDay,
          // A filled check-in always clears the deliberate-absence flag.
          manuallyCleared: checkInDate ? false : !!manuallyCleared,
          // Carry the transfer source onto the session created for this site.
          transferredFromSiteId:
            finalSiteId.toString() === siteId.toString() ? transferredFromForSite : null,
        })
      }

      // -----------------------------
      // MERGE WITH OTHER SITE SESSIONS
      // -----------------------------

      const mergedSessions = [
        ...otherSiteSessions,
        ...updatedSessions,
      ]

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      autoClosePreviousSiteSessions(mergedSessions, timezoneOffset);

      // -----------------------------
      // SORT ALL SESSIONS
      // -----------------------------

      mergedSessions.sort((a, b) => {
        if (!a.checkIn && !b.checkIn)
          return 0

        if (!a.checkIn)
          return 1

        if (!b.checkIn)
          return -1

        return (
          new Date(a.checkIn).getTime() -
          new Date(b.checkIn).getTime()
        )
      })

      // -----------------------------
      // OVERLAP CHECK
      // -----------------------------

      const validSessions = mergedSessions
        .filter((s) => s.checkIn)
        .map((s) => {
          const plain = typeof s.toObject === "function" ? s.toObject() : s;
          return {
            ...plain,
            _start: new Date(plain.checkIn),
            _end: plain.checkOut
              ? new Date(plain.checkOut)
              : new Date(plain.checkIn),
          };
        })

      for (
        let i = 0;
        i < validSessions.length - 1;
        i++
      ) {
        const a = validSessions[i]
        const b = validSessions[i + 1]

        const hasOverlap =
          a._start < b._end &&
          a._end > b._start

        if (hasOverlap) {
          let conflicting = b;
          if (siteId && a.siteId && a.siteId.toString() !== siteId.toString()) {
            conflicting = a;
          }
          const site = await Site.findById(conflicting.siteId)
            .select("siteName").session(session)

          if (!site) {
            throwValidationError(404, "Site not found");
          }

          throwValidationError(400, "Attendance sessions overlap", {
            overlap: {
              employeeId: empId,
              conflictingSession: {
                siteId: conflicting.siteId,
                siteName: site.siteName || "Unknown Site",
                jobId: conflicting.jobId,
                checkIn: conflicting.checkIn,
                checkOut: conflicting.checkOut,
              },
            },
          });
        }
      }

      // Cross-day: the same real hours must not also be recorded on an adjacent day. A
      // check-in with no check-out yet (the usual morning save) counts as an instant. The
      // sessions this sheet writes are also refused while yesterday's shift is still open —
      // the client blanks those rows (carryover), so this only catches a stale page.
      const neighbourConflict =
        crossDayConflict(empId, mergedSessions) ||
        crossDayConflict(empId, updatedSessions, { blockOpenPrevious: true });
      if (neighbourConflict) {
        throwValidationError(
          400,
          crossDayOverlapMessage(neighbourConflict, empPending?.name || employee?.name || null),
          { code: "CROSS_DAY_OVERLAP", employeeId: String(empId) }
        );
      }

      // -----------------------------
      // ASSIGN MERGED SESSIONS
      // -----------------------------

      attendanceDoc.sessions = mergedSessions

      // -----------------------------
      // TOTAL HOURS, STATUS & OT
      // -----------------------------
      const rawHours = sumRawHours(mergedSessions)

      // Preserve existing breaksTaken override if not supplied in this submission
      const effectiveBreaksTaken = (breaksTaken !== null && breaksTaken !== undefined)
        ? breaksTaken
        : (attendanceDoc.breaksTaken ?? null)

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken,
        effHolidayInfo
      )

      attendanceDoc.totalWorkHours = netWorkHours
      attendanceDoc.status = status
      attendanceDoc.overtimeHours = overtimeHours
      if (breaksTaken !== undefined) {
        attendanceDoc.breaksTaken = breaksTaken
      }
      attendanceDoc.isHoliday = effHolidayInfo.isHoliday
      attendanceDoc.holidayReason = effHolidayInfo.reason
      attendanceDoc.holidayHours = holidayHours
      // Soft: pass through the requested value; the pre-save hook force-clears it
      // if any session (this site or another) turns out to be filled.
      attendanceDoc.isSickLeave = !!isSickLeave
      // LOP mirrors sick leave (soft passthrough). In practice the draft submit path
      // never sends isLop=true (the kebab is hidden until a day is saved), but keep the
      // passthrough + auto-remark consistent with the other write paths.
      attendanceDoc.isLop = !!isLop
      if (isLop) applyLopRemark(attendanceDoc, true, workConfig.lopDeductionAmount)

      // Night shift detection
      const hasCrossedMidnight = detectCrossedMidnight(mergedSessions, timezoneOffset)
      attendanceDoc.crossedMidnight = hasCrossedMidnight
      attendanceDoc.shiftType = hasCrossedMidnight ? "night" : "day"
      attendanceDoc.siteId = siteId
      // Drivers: no single record job — their sessions split across a site's jobs.
      attendanceDoc.jobId = driverSheet ? null : (jobId || null)
      attendanceDoc.markedBy = markedBy

      await attendanceDoc.save({ session })

      // Consume the pending-transfer stash if it targeted this exact
      // site/date. The filter re-checks the match so a newer transfer
      // (pointing elsewhere) isn't accidentally cleared.
      await empModel.updateOne(
        {
          _id: empId,
          pendingTransferSiteId: siteId,
          pendingTransferDate: attendanceDate,
        },
        {
          $set: {
            pendingTransferCheckIn: null,
            pendingTransferSiteId: null,
            pendingTransferDate: null,
            pendingTransferFromSiteId: null,
            pendingTransferJobId: null,
          },
        },
        { session }
      )

      // Keep the roster job in step with the latest session's job (this record's
      // site, and only when it is the employee's most-recent record).
      await syncCurrentJobFromLatestSession({
        empId,
        siteId,
        recordDate: attendanceDate,
        doc: attendanceDoc,
        session,
      })

      processedRecords.push(attendanceDoc)

      // --- Audit rows for this record (flushed in one insertMany below) ---
      const newBreaks = attendanceDoc.breaksTaken ?? null;
      if (!wasNew && newBreaks !== prevBreaks) {
        auditRows.push(buildAuditRow(attendanceDoc, auditActor, "breaks_changed", breaksChangeSummary(prevBreaks, newBreaks)));
      }
      // First submit gets a richer line: the day's opening check-in, and whether that
      // check-in was the category default the roster auto-filled (checkInAutoInit — sent by
      // the client and still untouched by the supervisor) vs. a time they actually entered.
      // Edits keep the generic line.
      let submitSummary = "Attendance submitted";
      if (wasNew) {
        const firstIn = sessions.find((s) => s && s.checkIn);
        if (isSickLeave) {
          submitSummary = "Attendance submitted (sick leave)";
        } else if (!firstIn) {
          submitSummary = "Attendance submitted (absent)";
        } else if (firstIn.checkInAutoInit) {
          submitSummary = `Attendance submitted with an auto-initialized check-in of ${firstIn.checkIn}`;
        } else {
          submitSummary = `Attendance submitted with a check-in of ${firstIn.checkIn}`;
        }
      }
      auditRows.push(buildAuditRow(
        attendanceDoc,
        auditActor,
        wasNew ? "submitted" : "edited",
        wasNew ? submitSummary : "Attendance edited"
      ));
    }

    // -----------------------------
    // CREATE LOCK
    // -----------------------------
    await AttendanceLock.create([{
      siteId,
      date: attendanceDate,
      isLocked: true,
      lockedBy: markedBy,
      lockedAt: new Date(),
    }], { session })

    // The day is now real attendance — the shared draft rows are done with (unconditionally,
    // so switching the cloud draft off never strands rows for a submitted day).
    await AttendanceDraftRow.deleteMany({ siteId, date: attendanceDate }, { session });

    // Audit log joins the same transaction (best-effort inside the helper).
    await recordAttendanceAuditBatch(auditRows, session);

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Attendance submitted successfully",
      recordsProcessed: processedRecords.length,
      data: processedRecords,
    })

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    // Two submits racing for the same site/day: the loser either trips the lock's unique
    // index or a write conflict on a shared attendance doc. The transaction is already rolled
    // back — report it as "already submitted" / "try again" rather than a raw 500.
    if (error?.code === 11000 && error?.keyPattern?.siteId) {
      const lock = await AttendanceLock.findOne({ siteId, date: attendanceDate }).populate("lockedBy", "name").catch(() => null);
      return res.status(409).json({
        success: false,
        message: "Attendance for this site was already submitted",
        ...alreadySubmittedExtra(lock),
      })
    }
    if (isWriteConflict(error)) {
      return res.status(409).json({
        success: false,
        code: "SUBMIT_CONFLICT",
        message: "Another save touched these records at the same moment — please try again.",
      })
    }

    if (!error.status) console.error(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to submit attendance",
      error: error.message,
      ...(error.extra || {}),
    })
  }
}//

// Response fields for a submit refused because the site/day already has a lock.
function alreadySubmittedExtra(lock) {
  return {
    code: "ALREADY_SUBMITTED",
    lockedByName: lock?.lockedBy?.name ?? null,
    lockedAt: lock?.lockedAt ?? null,
  };
}

// Human-readable ROSTER_CHANGED message — shown as-is by clients that predate the code.
function rosterChangedMessage(added, removed) {
  const names = (list) => {
    const shown = list.slice(0, 5).map((e) => e.name || e.employeeId || "an employee").join(", ");
    return list.length > 5 ? `${shown} and ${list.length - 5} more` : shown;
  };
  const parts = [];
  if (added.length) parts.push(`added: ${names(added)}`);
  if (removed.length) parts.push(`no longer here: ${names(removed)}`);
  return `This site's roster changed since the page was loaded (${parts.join("; ")}). Review the sheet and save again.`;
}


//get saved attendance for a site 
export const getSiteAttendance = async (req, res) => {
  try {
    const { date, siteId } = req.query

    if (!date || !siteId) {
      return res.status(400).json({
        success: false,
        message: "date and siteId are required",
      })
    }

    // A driver supervisor reads the drivers sheet only.
    if (req.user.role === "driverSupervisor" && String(siteId) !== (await getDriverPoolId())) {
      return res.status(403).json({ success: false, message: "Forbidden: Access denied to this site" })
    }

    const queryDate = new Date(date)

    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)

    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    const siteObjectId = new mongoose.Types.ObjectId(siteId)

    const pipeline = [
      {
        $match: {
          date: { $gte: start, $lte: end },
          "sessions.siteId": siteObjectId
        },
      },

      // filter sessions by site
      {
        $addFields: {
          // Exact durations summed, rounded once — the sumRawHours rule (attendanceMath.js),
          // so the auto-break chip agrees with the stored totals.
          totalRawHours: {
            $round: [
              {
                $divide: [
                  {
                    $sum: {
                      $map: {
                        input: "$sessions",
                        as: "s",
                        in: {
                          $cond: [
                            { $and: ["$$s.checkIn", "$$s.checkOut"] },
                            { $max: [{ $subtract: ["$$s.checkOut", "$$s.checkIn"] }, 0] },
                            0,
                          ],
                        },
                      },
                    },
                  },
                  3600000,
                ],
              },
              2,
            ],
          },
          filteredSessions: {
            $filter: {
              input: "$sessions",
              as: "session",
              cond: {
                $eq: ["$$session.siteId", siteObjectId],
              },
            },
          },
        },
      },


      {
        $match: {
          filteredSessions: { $ne: [] },
        },
      },

      // Resolve the transfer source for this site (if any session at this site
      // was transferred in). Takes the first session carrying a source site.
      {
        $addFields: {
          transferredFromSiteId: {
            $let: {
              vars: {
                transferredSessions: {
                  $filter: {
                    input: "$filteredSessions",
                    as: "s",
                    cond: { $ne: ["$$s.transferredFromSiteId", null] },
                  },
                },
              },
              in: { $arrayElemAt: ["$$transferredSessions.transferredFromSiteId", 0] },
            },
          },
        },
      },

      {
        $lookup: {
          from: "sites",
          localField: "transferredFromSiteId",
          foreignField: "_id",
          as: "transferredFromSite",
        },
      },

      // employee lookup
      {
        $lookup: {
          from: "employees",
          localField: "employee",
          foreignField: "_id",
          as: "employee",
        },
      },

      { $unwind: "$employee" },

      

      {
        $project: {
          _id: 0,

          attendanceId: "$_id",

          date: "$date",

          isHoliday: "$isHoliday",

          holidayReason: "$holidayReason",

          holidayHours: "$holidayHours",

          isSickLeave: "$isSickLeave",

          isLop: "$isLop",

          isPaidLeave: "$isPaidLeave",

          isEmergencyLeave: "$isEmergencyLeave",

          employee: "$employee._id",

          name: "$employee.name",

          employeeId: "$employee.employeeId",

          jobTitle: "$employee.jobTitle",

          user: "$employee.user",

          employmentType: "$employee.employmentType",

          collarType: "$employee.collarType",

          nationality: "$employee.nationality",

          // The employee's home site — a row whose home is elsewhere is a visitor here,
          // who may be sent on for the day but not re-homed by this site's supervisor.
          homeSiteId: "$employee.currentSite",

          // Other sites' session starts, used below to tell whether the employee has
          // already moved on from here; stripped before the response.
          otherSessions: {
            $map: {
              input: {
                $filter: {
                  input: "$sessions",
                  as: "s",
                  cond: { $ne: ["$$s.siteId", siteObjectId] },
                },
              },
              as: "s",
              in: { siteId: "$$s.siteId", checkIn: "$$s.checkIn" },
            },
          },

          // Current supervisor remark, so the inline-edit over-default remark prompt can
          // prefill it instead of clobbering an existing note.
          remark: "$remark",

          // Version token: the inline editor sends it back as expectedUpdatedAt.
          updatedAt: "$updatedAt",

          status: "$status",

          totalWorkHours: "$totalWorkHours",

          overtimeHours: "$overtimeHours",

          shiftType: "$shiftType",

          crossedMidnight: "$crossedMidnight",

          breaksTaken: "$breaksTaken",

          totalRawHours: "$totalRawHours",

          // { siteId, name } when this employee was transferred into this site
          // (day-scoped), else null. Drives the "Transferred from <Site>" badge.
          transferredFrom: {
            $cond: [
              { $gt: [{ $size: "$transferredFromSite" }, 0] },
              {
                siteId: { $toString: "$transferredFromSiteId" },
                name: { $arrayElemAt: ["$transferredFromSite.siteName", 0] },
              },
              null,
            ],
          },


          sessions: {
            $map: {
              input: "$filteredSessions",
              as: "s",
              in: {
                _id: "$$s._id",

                siteId: "$$s.siteId",

                jobId: "$$s.jobId",

                servedSiteId: "$$s.servedSiteId",

                splitJobIds: "$$s.splitJobIds",

                checkIn: "$$s.checkIn",

                checkOut: "$$s.checkOut",

                workedHours: "$$s.workedHours",

                isNightShift: "$$s.isNightShift",
              },
            },
          },
        },
      },

      { $sort: { name: 1 } },
    ]

    const result = await Attendance.aggregate(pipeline)

    // Outgoing transfer state per row, so the SOURCE site sees where an employee went and
    // can't transfer the same check-out twice: a midday transfer still awaiting the
    // destination's approval ("pending"), or a session elsewhere starting at/after their
    // last check-out here ("transferred"). Nothing while they're still open here.
    const pendingPush = await TransferRequest.find({
      status: "pending",
      direction: "push",
      fromSite: siteObjectId,
      employee: { $in: result.map((r) => r.employee) },
    })
      .select("employee toSite")
      .lean()
    const pendingToByEmp = new Map(pendingPush.map((r) => [String(r.employee), String(r.toSite)]))

    for (const row of result) {
      const pendingTo = pendingToByEmp.get(String(row.employee))
      const openHere = row.sessions.some((s) => s.checkIn && !s.checkOut)
      const lastOutHere = Math.max(
        0,
        ...row.sessions.filter((s) => s.checkOut).map((s) => new Date(s.checkOut).getTime())
      )
      let movedTo = null
      if (!openHere && lastOutHere > 0) {
        const onward = (row.otherSessions || [])
          .filter((s) => s.checkIn && new Date(s.checkIn).getTime() >= lastOutHere)
          .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0]
        if (onward) movedTo = String(onward.siteId)
      }
      row.outgoing = pendingTo
        ? { status: "pending", siteId: pendingTo }
        : movedTo
        ? { status: "transferred", siteId: movedTo }
        : null
      delete row.otherSessions
    }

    const outgoingSiteIds = [...new Set(result.map((r) => r.outgoing?.siteId).filter(Boolean))]
    if (outgoingSiteIds.length) {
      const outgoingSites = await Site.find({ _id: { $in: outgoingSiteIds } }).select("siteName").lean()
      const nameById = new Map(outgoingSites.map((s) => [String(s._id), s.siteName]))
      for (const row of result) {
        if (row.outgoing) row.outgoing.siteName = nameById.get(row.outgoing.siteId) || "another site"
      }
    }

    // Name each session's job (code, job, site): the saved cards show its code above the
    // times, and on the drivers sheet the job can be at any site.
    {
      const jobIds = [...new Set(result.flatMap((r) => r.sessions.map((s) => s.jobId).filter(Boolean)).map(String))]
      if (jobIds.length) {
        const jobs = await Job.find({ _id: { $in: jobIds } }, "name jobCode site isGlobal")
          .populate("site", "siteName")
          .lean()
        const jobById = new Map(
          jobs.map((j) => [
            String(j._id),
            {
              _id: String(j._id),
              name: j.name,
              jobCode: j.jobCode || null,
              isGlobal: j.isGlobal === true,
              site: j.site ? { _id: String(j.site._id), siteName: j.site.siteName } : null,
            },
          ])
        )
        for (const row of result) {
          for (const s of row.sessions) s.job = s.jobId ? jobById.get(String(s.jobId)) || null : null
        }
      }
      // Drivers: the site a session served and the jobs its hours are split across.
      const splitInfo = await buildSplitLookup(result.flatMap((r) => r.sessions))
      for (const row of result) {
        for (const s of row.sessions) Object.assign(s, splitInfo(s))
      }
    }

    // Day-level holiday flag comes from the date itself, not from an employee's
    // record — temporary workers now store isHoliday:false even on a holiday, so a
    // temp row sorting first must not hide the banner.
    const { isHoliday, reason: holidayReason } = await checkHolidayForDate(queryDate)

    return res.status(200).json({
      totalRecords: result.length,
      isHoliday,
      holidayReason,
      data: result,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance",
      error: error.message,
    })
  }
}//

// Employee-scoped carryover fetch (the "follow the employee" flow). Unlike
// getSiteAttendance (which surfaces only sessions AT this site), this returns the
// PRIOR-DAY open sessions of the employees rostered here TODAY, regardless of which
// site those open shifts physically live at. That lets an employee's forgotten
// check-out surface — and be closed — on whatever site they have since moved to.
// Roster anchor is `currentSite` (permanent/scheduled moves update it; a today-only
// visit leaves it at the home site, so a visitor's carryover follows to their home
// instead of appearing on a site they're only visiting).
export const getSiteCarryovers = async (req, res) => {
  try {
    const { siteId, date } = req.query

    if (!siteId || !mongoose.Types.ObjectId.isValid(siteId)) {
      return res.status(400).json({
        success: false,
        message: "A valid siteId is required",
      })
    }

    const siteObjectId = new mongoose.Types.ObjectId(siteId)

    // The open sessions we surface live on the day BEFORE the target day (default:
    // yesterday). Match the stored UTC-midnight `date` the same way getSiteAttendance does.
    const prevDayStr = date || getDateLocal(-1)
    const queryDate = new Date(prevDayStr)
    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    // Employees rostered at this site today (home roster). A row exists on the board
    // for these; the carryover badge hangs on that row all day.
    // The drivers pool's roster is the drivers (no site), not employees homed on it.
    const rosterEmployees = await Employee.find(
      (await isDriverPool(siteObjectId)) ? driverEmployeeFilter() : { currentSite: siteObjectId }
    ).select("_id")

    const rosterIds = rosterEmployees.map((e) => e._id)
    if (rosterIds.length === 0) {
      return res.status(200).json({ success: true, data: [], previousDayEnds: [] })
    }

    // Their prior-day records that still carry an open session (any site), plus those whose
    // session ran past midnight into the target day — same single query.
    const records = await Attendance.find({
      employee: { $in: rosterIds },
      date: { $gte: start, $lte: end },
      $or: [
        { sessions: { $elemMatch: { checkIn: { $ne: null }, checkOut: null } } },
        { sessions: { $elemMatch: { checkOut: { $ne: null }, checkOutNextDay: true } } },
      ],
    })
      .populate({ path: "employee", select: "name employeeId" })
      .populate({ path: "sessions.siteId", select: "siteName" })

    // previousDayEnds: per employee, the latest prior-day check-out that lands on the target
    // day. The draft flags a check-in before it (cross-day overlap) before Save; the submit's
    // buildCrossDayOverlapChecker stays the authority.
    const previousDayEnds = []
    for (const rec of records) {
      let latest = null
      for (const s of rec.sessions || []) {
        if (!s.checkIn || !s.checkOut || !s.checkOutNextDay) continue
        if (!latest || new Date(s.checkOut) > latest) latest = new Date(s.checkOut)
      }
      if (latest) {
        previousDayEnds.push({
          employee: (rec.employee?._id || rec.employee)?.toString() || null,
          checkOut: latest,
        })
      }
    }

    // Shape to mirror getSiteAttendance's rows (attendanceId, employee = id, name,
    // employeeId, sessions[]) but WITHOUT pre-filtering to one site, and carry each
    // session's siteName so the client knows the open shift's HOME site.
    const data = records
      .filter((rec) => (rec.sessions || []).some((s) => s.checkIn && !s.checkOut))
      .map((rec) => ({
      attendanceId: rec._id,
      date: rec.date,
      employee: (rec.employee?._id || rec.employee)?.toString() || null,
      name: rec.employee?.name || "",
      employeeId: rec.employee?.employeeId || "",
      sessions: (rec.sessions || []).map((s) => ({
        _id: s._id,
        siteId: (s.siteId?._id || s.siteId)?.toString() || null,
        siteName: s.siteId?.siteName || null,
        jobId: s.jobId || null,
        servedSiteId: s.servedSiteId || null,
        splitJobIds: s.splitJobIds || [],
        checkIn: s.checkIn || null,
        checkOut: s.checkOut || null,
        rawCheckIn: s.rawCheckIn || null,
        rawCheckOut: s.rawCheckOut || null,
        workedHours: s.workedHours,
        isNightShift: s.isNightShift,
      })),
    }))

    data.sort((a, b) => a.name.localeCompare(b.name))

    return res.status(200).json({ success: true, data, previousDayEnds })
  } catch (error) {
    console.error("getSiteCarryovers error:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch carryovers",
    })
  }
}

//fetch attendance records
export const getAttendanceRecords = async (req, res) => {
  try {
    let {
      date,
      name,
      employeeId,
      jobTitle,
      site,
      page = 1,
      limit = 20,
    } = req.query;

    // -----------------------------
    // Pagination
    // -----------------------------
    page = Number(page) || 1;

    limit = Math.min(Number(limit) || 20, 100);

    const skip = (page - 1) * limit;

    // -----------------------------
    // Attendance filters
    // -----------------------------
    let attendanceFilter = {};

    // Filter by date
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      attendanceFilter.date = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // -----------------------------
    // Employee filters
    // -----------------------------
    let employeeFilter = {};

    // Unified search box: a single query string matched across name, employee ID
    // and job title (OR). The individual name/employeeId/jobTitle params are still
    // honored for any older caller and combine with AND alongside the search.
    const search = (req.query.search || "").toString().trim();
    if (search) {
      const rx = { $regex: escapeRegExp(search), $options: "i" };
      employeeFilter.$or = [
        { name: rx },
        { employeeId: rx },
        { jobTitle: rx },
      ];
    }

    if (name) {
      employeeFilter.name = {
        $regex: escapeRegExp(name),
        $options: "i",
      };
    }

    if (employeeId) {
      employeeFilter.employeeId = {
        $regex: escapeRegExp(employeeId),
        $options: "i",
      };
    }

    if (jobTitle) {
      employeeFilter.jobTitle = {
        $regex: escapeRegExp(jobTitle),
        $options: "i",
      };
    }

    // Get employee IDs if employee filters exist
    if (
      search ||
      name ||
      employeeId ||
      jobTitle
    ) {
      const employees = await Employee.find(
        employeeFilter
      ).select("_id");

      attendanceFilter.employee = {
        $in: employees.map((emp) => emp._id),
      };
    }

    // -----------------------------
    // Site filter
    // -----------------------------
    if (isSiteScopedRole(req.user.role)) {
      const user = await userModel.findById(req.user.id);
      attendanceFilter.siteId = user?.assignedSite || null;
    } else if (site) {
      // Match either the record's anchor site OR any session's site, so an
      // employee who worked a session at this site shows up under it even when
      // the record is rooted elsewhere (multi-site day). The root-siteId branch
      // keeps absent records (no sessions) visible under their own site. Both
      // `siteId` and `sessions.siteId` are indexed with `date`, so each $or arm
      // rides a compound index.
      attendanceFilter.$or = [
        { siteId: site },
        { "sessions.siteId": site },
      ]
    }

    // -----------------------------
    // Count documents
    // -----------------------------
    const totalRecords =
      await Attendance.countDocuments(
        attendanceFilter
      );

    const totalPages = Math.ceil(
      totalRecords / limit
    );

    // -----------------------------
    // Fetch attendance records
    // -----------------------------
    const attendanceRecords =
      await Attendance.find(attendanceFilter)
        .populate(
          "employee",
          "name employeeId jobTitle"
        )
        .populate("siteId", "siteName")
        .populate("jobId", "name")
        .populate(
          "sessions.siteId",
          "siteName"
        )
        .populate(
          "sessions.jobId",
          "name jobCode"
        )
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    // -----------------------------
    // Format response
    // -----------------------------
    const recordsSplitInfo = await buildSplitLookup(
      attendanceRecords.flatMap((r) => r.sessions || [])
    );
    const formattedRecords =
      attendanceRecords.map((record) => ({
        attendanceId: record._id,

        employee: record.employee?._id,

        name: record.employee?.name || "",

        employeeId:
          record.employee?.employeeId || "",

        jobTitle:
          record.employee?.jobTitle || "",

        siteId: record.siteId?._id,

        siteName:
          record.siteId?.siteName || "",

        jobId: record.jobId?._id || null,

        jobName:
          record.jobId?.name || "",

        date: record.date,

        status: record.status,

        isHoliday: record.isHoliday,

        holidayReason: record.holidayReason || null,

        holidayHours: record.holidayHours || 0,

        isSickLeave: record.isSickLeave || false,

        isLop: record.isLop || false,

        isPaidLeave: record.isPaidLeave || false,

        isEmergencyLeave: record.isEmergencyLeave || false,

        totalWorkHours:
          record.totalWorkHours,

        overtimeHours:
          record.overtimeHours,

        shiftType: record.shiftType,

        crossedMidnight: record.crossedMidnight,

        breaksTaken: record.breaksTaken,

        sessions: record.sessions.map(
          (session) => ({
            _id: session._id,

            siteId:
              session.siteId?._id,

            siteName:
              session.siteId?.siteName || "",

            jobId:
              session.jobId?._id ||
              null,

            jobName:
              session.jobId?.name ||
              "",

            jobCode:
              session.jobId?.jobCode || null,

            ...recordsSplitInfo(session),

            checkIn:
              session.checkIn,

            checkOut:
              session.checkOut,

            workedHours:
              session.workedHours,

            isNightShift:
              session.isNightShift || false,

            markedBy:
              session.markedBy,
          })
        ),
      }));

    // Common holiday flag — derived from the date itself (temporary workers store
    // isHoliday:false even on a holiday, so a temp row must not hide it). Only
    // meaningful when a single date is queried.
    const dayHoliday = date
      ? await checkHolidayForDate(new Date(date))
      : { isHoliday: false, reason: null };
    const isHoliday = dayHoliday.isHoliday;
    const holidayReason = dayHoliday.reason;

    return res.status(200).json({
      success: true,

      isHoliday,

      holidayReason,

      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        limit,
      },

      data: formattedRecords,
    });
  } catch (error) {
    console.error(
      "Get attendance records error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};//

export const updateAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { sessions, siteId: bodySiteId, breaksTaken, isSickLeave, isLop } = req.body;

    const { siteId: querySiteId } = req.query;
    const siteId = querySiteId || bodySiteId;
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];

    let fallbackOffset = -330;
    if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
      const parsedFallback = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
      if (!isNaN(parsedFallback)) {
        fallbackOffset = parsedFallback;
      }
    }

    let offsetVal = fallbackOffset;
    if (timezoneOffset !== null && timezoneOffset !== undefined) {
      const parsed = parseInt(timezoneOffset, 10);
      if (!isNaN(parsed)) {
        offsetVal = parsed;
      }
    }

    const attendance = await Attendance.findById(attendanceId);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    // A paid-leave day is locked. It cannot be edited (which would record hours on
    // an approved-leave day and silently drop the leave) until an admin cancels the
    // leave grant, which reverts the record. Applies to every caller, and to granted
    // emergency leave alike.
    if (isGrantedLeaveDay(attendance)) {
      return res.status(409).json({
        success: false,
        message: leaveLockedMessage(attendance),
      });
    }

    // Snapshot state before any edit, so the audit log can describe exactly what changed:
    // the break override, the status/sick flags, and each session's identity + raw times.
    const prevBreaks = attendance.breaksTaken ?? null;
    const prevStatus = attendance.status;
    const prevSick = attendance.isSickLeave;
    const prevLop = attendance.isLop;
    const prevSessionsSnap = attendance.sessions.map((s) => ({
      _id: s._id,
      siteId: s.siteId,
      jobId: s.jobId,
      servedSiteId: s.servedSiteId,
      splitJobIds: (s.splitJobIds || []).map(String),
      rawCheckIn: s.rawCheckIn,
      rawCheckOut: s.rawCheckOut,
    }));

    if (isSiteScopedRole(req.user.role)) {
      const user = await userModel.findById(req.user.id);
      // Check against the specific site being edited (siteId), not the doc's
      // primary/original site — a multi-site record can have sessions across
      // several sites, and a supervisor should be able to edit their own
      // site's session even if they weren't the one who created the doc.
      const sameSite = !!(user && user.assignedSite && siteId && user.assignedSite.toString() === siteId.toString());
      // Employee-scoped carryover exception: also allow closing another site's
      // dangling open shift for an employee who has since moved onto this
      // supervisor's roster (see utils/carryoverAccess.js).
      const carryoverOk = !sameSite && user && user.assignedSite
        ? await supervisorMayCloseCarryover(attendance, user.assignedSite, siteId)
        : false;
      if (!sameSite && !carryoverOk) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Access denied to this attendance record",
        });
      }
    }

    // Optimistic concurrency. The editors send the row as the device last loaded it, and this
    // endpoint REPLACES the site's sessions — so an edit made from a stale page (another
    // supervisor, or the auto-checkout cron, changed the record since) would silently wipe
    // the newer values. Callers pass the updatedAt they loaded; a mismatch means someone else
    // wrote first. Omitted by older clients → unchecked, as before.
    const { expectedUpdatedAt } = req.body;
    if (
      expectedUpdatedAt &&
      attendance.updatedAt &&
      new Date(expectedUpdatedAt).getTime() !== new Date(attendance.updatedAt).getTime()
    ) {
      return res.status(409).json({
        success: false,
        code: "RECORD_CHANGED",
        message: "This record was changed on another device since you opened it. It has been refreshed — check it and edit again.",
        updatedAt: attendance.updatedAt,
      });
    }

    const workConfig = await workModel.findOne({
      type: "default",
    });

    if (!workConfig) {
      return res.status(404).json({
        success: false,
        message:
          "Work schedule configuration not found",
      });
    }

    if (Array.isArray(sessions)) {
      // The record's business day as YYYY-MM-DD — the anchor for offset-based combine.
      const recordDateStr = new Date(attendance.date).toISOString().split("T")[0];

      // Validate sessions first (cutoff-free): pull each endpoint's raw HH:mm from the
      // client-combined ISO Date, derive the day offsets from those times, and validate
      // ordering + duration only. No site cutoff.
      for (const session of sessions) {
        const inStr = toLocalTimeString(session.checkIn, offsetVal);
        const outStr = toLocalTimeString(session.checkOut, offsetVal);
        const derivedOffsets = deriveOffsets(inStr, outStr, !!session.startsAfterMidnight);
        const checkInNextDay = typeof session.checkInNextDay === 'boolean' ? session.checkInNextDay : derivedOffsets.checkInNextDay;
        const checkOutNextDay = typeof session.checkOutNextDay === 'boolean' ? session.checkOutNextDay : derivedOffsets.checkOutNextDay;
        const boundsError = validateSessionTimesV2(inStr, outStr, checkInNextDay, checkOutNextDay);
        if (boundsError) {
          return res.status(400).json({
            success: false,
            message: boundsError,
          });
        }
      }

      // Driver sessions (on the pool) carry a job split (utils/jobSplit.js). A body session
      // that sends no `splitJobIds` (sick/LOP toggles, carryover closes, times-only edits
      // from any caller) keeps the split it already has, like the transfer source below.
      const poolId = await getDriverPoolId();
      const storedSessionFor = (s) =>
        s?._id ? attendance.sessions.find((st) => String(st._id) === String(s._id)) : null;
      if (poolId) {
        for (const s of sessions) {
          if (String(s.siteId) !== poolId || hasSplitKey(s) || s.jobId) continue;
          const stored = storedSessionFor(s);
          if (!stored || String(stored.siteId) !== poolId) continue;
          if (stored.splitJobIds?.length) {
            s.splitJobIds = stored.splitJobIds.map(String);
            s.servedSiteId = stored.servedSiteId ?? null;
          } else if (stored.jobId) {
            s.jobId = stored.jobId;
          }
        }
      }
      // Liveness is only re-checked where the split CHANGED — a job completed since the day
      // was saved must not block a times-only edit.
      const splitChanged = (s) => {
        const stored = storedSessionFor(s);
        return !stored || String(stored.siteId) !== poolId || !sameJobSet(sessionJobIds(stored), sessionJobIds(s));
      };

      // Drivers live only on the Drivers sheet: a driver's NEW or MOVED session at a real site
      // is refused. A session already stored at that same site (history from before the rule)
      // can still be edited in place.
      const editedEmployee = await Employee.findById(attendance.employee).select("jobTitle").lean();
      const offPoolError = nonPoolDriverSessionError({
        sessions: sessions.filter((s) => {
          const stored = storedSessionFor(s);
          return !stored || String(stored.siteId) !== String(s.siteId);
        }),
        poolId,
        employee: editedEmployee,
      });
      if (offPoolError) {
        return res.status(400).json({ success: false, code: "DRIVER_ONLY", message: offPoolError });
      }

      // Drivers sheet: each of the pool's sessions with a time must name a site + its jobs.
      if (siteId && poolId && String(siteId) === poolId) {
        const driverError = await validateDriverPoolSessions({
          sessions,
          poolId,
          requireDriver: false,
          isStrict: splitChanged,
        });
        if (driverError) {
          return res.status(400).json({ success: false, message: driverError });
        }
      }
      // Site sheet: once the site has a live job, every session at it with a time must name
      // one. Only the site-sheet editors send ?siteId (admin edit-past does not), and
      // transfers place their arrivals without this endpoint, so they stay job-optional.
      else if (siteId && (await siteHasLiveJobs(siteId))) {
        const missingJob = sessions.some(
          (s) => String(s.siteId) === String(siteId) && (s.checkIn || s.checkOut) && !s.jobId
        );
        if (missingJob) {
          return res.status(400).json({
            success: false,
            code: "JOB_REQUIRED",
            message: "Pick a job for every session at this site",
          });
        }
      }
      // Admin edit-past (no ?siteId): sessions placed on the Drivers pool via the site picker.
      else if (!siteId) {
        const alreadyOnPool = !!poolId && attendance.sessions.some((s) => String(s.siteId) === poolId);
        const driverError = await validateDriverPoolSessions({
          sessions,
          poolId,
          employee: editedEmployee,
          requireDriver: !alreadyOnPool,
        });
        if (driverError) {
          return res.status(400).json({ success: false, message: driverError });
        }
      }

      const processedSessions = sessions.map(
        (session) => {
          // -----------------------------
          // Validation
          // -----------------------------
          if (
            !session.checkIn &&
            session.checkOut
          ) {
            throw new Error(
              "Check-out cannot exist without check-in"
            );
          }

          // Cutoff-free: extract raw HH:mm from the client-combined ISO Dates, derive the
          // day offsets, and recombine canonical Dates from the record's business day so
          // the stored timestamp and the offset flags can never drift.
          const inStr = toLocalTimeString(session.checkIn, offsetVal);
          const outStr = toLocalTimeString(session.checkOut, offsetVal);
          const derivedOffsets = deriveOffsets(inStr, outStr, !!session.startsAfterMidnight);
          const checkInNextDay = typeof session.checkInNextDay === 'boolean' ? session.checkInNextDay : derivedOffsets.checkInNextDay;
          const checkOutNextDay = typeof session.checkOutNextDay === 'boolean' ? session.checkOutNextDay : derivedOffsets.checkOutNextDay;

          const checkInDate = session.checkIn ? combineFromOffset(recordDateStr, inStr, checkInNextDay) : null;
          const checkOutDate = session.checkOut ? combineFromOffset(recordDateStr, outStr, checkOutNextDay) : null;

          let workedHours = 0;
          if (checkInDate && checkOutDate) {
            workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
          }

          // Match the existing stored session (by _id) so edit-only fields
          // like the transfer source are preserved rather than dropped when
          // the session is rebuilt from the request body.
          const existingSession = session._id
            ? attendance.sessions.find(
                (s) => s._id.toString() === session._id.toString()
              )
            : null;

          // Deliberate-absence flag: a filled check-in always clears it; an
          // emptied session that previously had times was explicitly cleared
          // by the editor; an untouched empty session keeps its flag.
          let manuallyCleared = false;
          if (!session.checkIn) {
            if (existingSession && (existingSession.checkIn || existingSession.checkOut)) {
              manuallyCleared = true;
            } else if (existingSession) {
              manuallyCleared = existingSession.manuallyCleared || false;
            } else {
              manuallyCleared = !!session.manuallyCleared;
            }
          }

          // A job split only lives on a worked driver (pool) session; moving a session off the
          // pool, or clearing its times, drops it.
          const keepsSplit =
            !!poolId && String(session.siteId) === poolId && !!(session.checkIn || session.checkOut);
          const splitIds = keepsSplit
            ? (session.splitJobIds || []).map((v) => String(v)).filter((v) => mongoose.isValidObjectId(v))
            : [];

          return {
            _id: session._id,
            siteId: session.siteId,
            jobId: splitIds.length ? null : session.jobId || null,
            servedSiteId: splitIds.length ? session.servedSiteId ?? null : null,
            splitJobIds: splitIds,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            rawCheckIn: inStr,
            rawCheckOut: outStr,
            checkInNextDay,
            checkOutNextDay,
            workedHours: Number(
              workedHours.toFixed(2)
            ),
            isNightShift: checkInNextDay || checkOutNextDay,
            manuallyCleared,
            // Preserve the transfer source across edits (badge must survive
            // the destination supervisor filling in a check-out, etc.).
            transferredFromSiteId: existingSession?.transferredFromSiteId || null,
            markedBy:
              session.markedBy ||
              attendance.markedBy,
          };
        }
      );

      let combinedSessions = [];
      if (siteId) {
        // Filter processed sessions to only include target site sessions
        const siteSessions = processedSessions.filter(
          (session) => session.siteId.toString() === siteId.toString()
        );

        // Find existing sessions for this site
        const existingSiteSessions = attendance.sessions.filter(
          (session) => session.siteId.toString() === siteId.toString()
        );

        // Prevent deleting the only session for this site
        if (existingSiteSessions.length > 0 && siteSessions.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Cannot delete the only session for this site. You can leave its times blank instead.",
          });
        }

        // Preserve all sessions that belong to other sites
        const preservedSessions = attendance.sessions.filter(
          (session) => session.siteId.toString() !== siteId.toString()
        );
        combinedSessions = [...preservedSessions, ...siteSessions];
      } else {
        combinedSessions = processedSessions;
      }

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      combinedSessions = autoClosePreviousSiteSessions(combinedSessions, timezoneOffset);

      // -----------------------------
      // Sort by checkIn
      // Empty sessions go last
      // -----------------------------
      combinedSessions.sort((a, b) => {
        if (!a.checkIn && !b.checkIn)
          return 0;

        if (!a.checkIn) return 1;

        if (!b.checkIn) return -1;

        return (
          new Date(a.checkIn) -
          new Date(b.checkIn)
        );
      });

      // -----------------------------
      // Overlap validation
      // -----------------------------
      const sessionsForValidation =
        combinedSessions.filter(
          (session) => session.checkIn
        );

      for (
        let i = 0;
        i <
        sessionsForValidation.length - 1;
        i++
      ) {
        const current =
          sessionsForValidation[i];

        const next =
          sessionsForValidation[i + 1];

        const currentStart = new Date(
          current.checkIn
        );

        const currentEnd = new Date(
          current.checkOut ||
          current.checkIn
        );

        const nextStart = new Date(
          next.checkIn
        );

        const nextEnd = new Date(
          next.checkOut ||
          next.checkIn
        );

        const hasOverlap =
          currentStart < nextEnd &&
          currentEnd > nextStart;

        if (hasOverlap) {
          let conflicting = next;
          if (siteId && current.siteId.toString() !== siteId.toString()) {
            conflicting = current;
          }

          const site = await Site.findById(conflicting.siteId).select("siteName");

          return res.status(400).json({
            success: false,
            message: "Attendance sessions overlap",

            overlap: {
              employeeId: attendance.employee,
              firstIndex: i,
              secondIndex: i + 1,

              sessionA: {
                _id: current._id,
                siteId: current.siteId,
                jobId: current.jobId,
                checkIn: current.checkIn,
                checkOut: current.checkOut,
              },

              sessionB: {
                _id: next._id,
                siteId: next.siteId,
                jobId: next.jobId,
                checkIn: next.checkIn,
                checkOut: next.checkOut,
              },

              conflictingSession: {
                siteId: conflicting.siteId,
                siteName: site ? (site.siteName || "Unknown Site") : "Unknown Site",
                jobId: conflicting.jobId,
                checkIn: conflicting.checkIn,
                checkOut: conflicting.checkOut,
              },
            },
          });
        }
      }

      // Cross-day: an edited session can extend past midnight into a day whose record
      // already covers those hours (e.g. closing a night shift at 08:00 when the next
      // morning already has a 06:00 start). Guarded here as well as on submit.
      const crossDayConflict = await buildCrossDayOverlapChecker({
        employeeIds: [attendance.employee],
        date: attendance.date,
      });
      const neighbourConflict = crossDayConflict(attendance.employee, combinedSessions);
      if (neighbourConflict) {
        return res.status(400).json({
          success: false,
          code: "CROSS_DAY_OVERLAP",
          employeeId: String(attendance.employee),
          message: crossDayOverlapMessage(neighbourConflict),
        });
      }

      attendance.sessions = combinedSessions;

      // Night shift detection
      const hasCrossedMidnight = detectCrossedMidnight(combinedSessions, timezoneOffset);
      attendance.crossedMidnight = hasCrossedMidnight;
      attendance.shiftType = hasCrossedMidnight ? "night" : "day";

      // -----------------------------
      // Total hours, status & OT
      // -----------------------------
      const rawHours = sumRawHours(combinedSessions);

      const effectiveBreaksTaken = (breaksTaken !== null && breaksTaken !== undefined)
        ? breaksTaken
        : (attendance.breaksTaken ?? null);

      // Holiday state is fixed by the record's date — reuse the stored values so
      // editing hours on a holiday recomputes holidayHours correctly.
      const { netWorkHours, status: computedStatus, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken,
        { isHoliday: attendance.isHoliday, reason: attendance.holidayReason }
      );

      attendance.totalWorkHours = netWorkHours;
      attendance.overtimeHours = overtimeHours;
      attendance.holidayHours = holidayHours;
      attendance.status = computedStatus;
      if (breaksTaken !== undefined) {
        attendance.breaksTaken = breaksTaken;
      }
    }

    // -----------------------------
    // SICK LEAVE (hard validation)
    // -----------------------------
    // The inline/edit caller only ever sees the current site's sessions, so it
    // cannot know about a filled session at another site. If sick leave is
    // requested but the full record has any filled session, reject with a clear
    // message instead of silently flipping it off.
    if (isSickLeave !== undefined) {
      const hasFilledSession = attendance.sessions.some(
        (s) => s && (s.checkIn || s.checkOut)
      );

      if (isSickLeave && hasFilledSession) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot mark sick leave: this employee has attendance recorded at another site/session today.",
        });
      }

      attendance.isSickLeave = !!isSickLeave;
      // Sick leave and LOP are mutually exclusive — turning sick on clears LOP
      // (and, since LOP owns the auto-remark, clears that remark too).
      if (isSickLeave) {
        attendance.isLop = false;
        if (LOP_REMARK_RE.test(attendance.remark || "")) {
          attendance.remark = "";
        }
      }
    }

    // -----------------------------
    // LOP / LOSS OF PAY (hard validation) — mirrors sick leave, plus an auto-remark
    // -----------------------------
    // Same rule as sick leave: an unexcused-absence flag is only valid when the whole
    // record has no filled session (this site or another). Toggling it on auto-fills a
    // "Deduct <amount> OMR" remark from the configurable WorkSchedule knob; toggling it
    // off clears that remark only when it still matches the auto shape (so a manually
    // edited note is preserved).
    if (isLop !== undefined) {
      const hasFilledSession = attendance.sessions.some(
        (s) => s && (s.checkIn || s.checkOut)
      );

      if (isLop && hasFilledSession) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot mark loss of pay: this employee has attendance recorded at another site/session today.",
        });
      }

      attendance.isLop = !!isLop;
      if (isLop) {
        attendance.isSickLeave = false;
        attendance.remark = `Deduct ${workConfig.lopDeductionAmount ?? 3.5} OMR`;
      } else if (LOP_REMARK_RE.test(attendance.remark || "")) {
        attendance.remark = "";
      }
    }

    await attendance.save();

    // --- Audit: log what changed (best-effort; no transaction on this path) ---
    const auditActor = await resolveActor(req);
    const newBreaks = (breaksTaken !== undefined) ? (breaksTaken ?? null) : prevBreaks;
    if (breaksTaken !== undefined && newBreaks !== prevBreaks) {
      await recordAttendanceAudit({
        attendance,
        actor: auditActor,
        type: "breaks_changed",
        summary: breaksChangeSummary(prevBreaks, newBreaks),
      });
    }
    if (Array.isArray(sessions)) {
      // Resolve job/site names once (small indexed lookups) so the diff can read
      // "New session created for Welder" instead of an ObjectId.
      const jobIds = [...new Set(attendance.sessions.map((s) => s.jobId).filter(Boolean).map(String))];
      const siteIds = [
        ...new Set(
          [...attendance.sessions, ...prevSessionsSnap]
            .flatMap((s) => [s.siteId, s.servedSiteId])
            .filter(Boolean)
            .map(String)
        ),
      ];
      const [jobDocs, siteDocs] = await Promise.all([
        jobIds.length ? Job.find({ _id: { $in: jobIds } }).select("name").lean() : [],
        siteIds.length ? Site.find({ _id: { $in: siteIds } }).select("siteName").lean() : [],
      ]);
      const jobNames = Object.fromEntries(jobDocs.map((j) => [String(j._id), j.name]));
      const siteNames = Object.fromEntries(siteDocs.map((s) => [String(s._id), s.siteName]));

      const parts = summarizeAttendanceEdit({
        prevSessions: prevSessionsSnap,
        newSessions: attendance.sessions,
        prevStatus,
        newStatus: attendance.status,
        prevSick,
        newSick: attendance.isSickLeave,
        prevLop,
        newLop: attendance.isLop,
        jobNames,
        siteNames,
      });

      const breaksChanged = breaksTaken !== undefined && newBreaks !== prevBreaks;
      // Log a detailed entry when something changed; skip a redundant generic entry when the
      // only change was breaks (already logged above).
      if (parts.length > 0) {
        await recordAttendanceAudit({ attendance, actor: auditActor, type: "edited", summary: joinChangeParts(parts) });
      } else if (!breaksChanged) {
        await recordAttendanceAudit({ attendance, actor: auditActor, type: "edited", summary: "Attendance edited" });
      }
    } else if (isSickLeave !== undefined || isLop !== undefined) {
      // A leave-flag-only toggle (no session edit). Diff the sick/lop flags — this
      // also captures the mutual-exclusion side effect (e.g. turning LOP on while
      // sick was on logs both "Cleared sick leave" and "Marked loss of pay").
      const leaveParts = summarizeAttendanceEdit({
        prevStatus,
        newStatus: attendance.status,
        prevSick,
        newSick: attendance.isSickLeave,
        prevLop,
        newLop: attendance.isLop,
      });
      await recordAttendanceAudit({
        attendance,
        actor: auditActor,
        type: "edited",
        summary: leaveParts.length ? joinChangeParts(leaveParts) : "Attendance edited",
      });
    }

    // Keep the roster job in step with the latest session's job — only when sessions
    // were edited for a specific site, and only if this is the employee's latest record
    // (the helper's guard makes a past-record edit a no-op).
    if (Array.isArray(sessions) && siteId) {
      await syncCurrentJobFromLatestSession({
        empId: attendance.employee,
        siteId,
        recordDate: attendance.date,
        doc: attendance,
      });
    }

    const updatedAttendance =
      await Attendance.findById(
        attendance._id
      )
        .populate(
          "employee",
          "name employeeId jobTitle user employmentType"
        )
        .populate(
          "siteId",
          "siteName"
        )
        .populate("jobId", "name jobCode")
        .populate(
          "sessions.siteId",
          "siteName"
        )
        .populate({
          path: "sessions.jobId",
          select: "name jobCode site isGlobal",
          populate: { path: "site", select: "siteName" },
        });

    const updatedSplitInfo = await buildSplitLookup(updatedAttendance.sessions);
    const formattedAttendance = {
      attendanceId:
        updatedAttendance._id,

      employee:
        updatedAttendance.employee
          ?._id,

      name:
        updatedAttendance.employee
          ?.name || "",

      employeeId:
        updatedAttendance.employee
          ?.employeeId || "",

      jobTitle:
        updatedAttendance.employee
          ?.jobTitle || "",

      user:
        updatedAttendance.employee
          ?.user || null,

      employmentType:
        updatedAttendance.employee
          ?.employmentType,

      siteId:
        updatedAttendance.siteId
          ?._id,

      siteName:
        updatedAttendance.siteId
          ?.siteName || "",

      jobId:
        updatedAttendance.jobId
          ?._id || null,

      jobName:
        updatedAttendance.jobId
          ?.name || "",

      jobCode:
        updatedAttendance.jobId
          ?.jobCode || null,

      date: updatedAttendance.date,

      status:
        updatedAttendance.status,

      isHoliday:
        updatedAttendance.isHoliday,

      holidayReason:
        updatedAttendance.holidayReason || null,

      holidayHours:
        updatedAttendance.holidayHours || 0,

      isSickLeave:
        updatedAttendance.isSickLeave || false,

      isLop:
        updatedAttendance.isLop || false,

      remark:
        updatedAttendance.remark || "",

      isPaidLeave:
        updatedAttendance.isPaidLeave || false,

      isEmergencyLeave:
        updatedAttendance.isEmergencyLeave || false,

      totalWorkHours:
        updatedAttendance.totalWorkHours,

      overtimeHours:
        updatedAttendance.overtimeHours,

      shiftType: updatedAttendance.shiftType,

      crossedMidnight: updatedAttendance.crossedMidnight,

      breaksTaken: updatedAttendance.breaksTaken,

      // Version token for the next edit's expectedUpdatedAt (see the check above).
      updatedAt: updatedAttendance.updatedAt,

      totalRawHours: sumRawHours(updatedAttendance.sessions),


      sessions:
        updatedAttendance.sessions.map(
          (session) => ({
            _id: session._id,

            siteId:
              session.siteId?._id,

            siteName:
              session.siteId
                ?.siteName || "",

            jobId:
              session.jobId?._id ||
              null,

            jobName:
              session.jobId?.name ||
              "",

            jobCode:
              session.jobId?.jobCode ||
              null,

            // Same shape the day's list endpoint attaches (getSiteAttendance), which is
            // what the saved cards render. Without it a just-saved row loses its job chip
            // until the page is reloaded.
            job: session.jobId?._id
              ? {
                  _id: String(session.jobId._id),
                  name: session.jobId.name,
                  jobCode: session.jobId.jobCode || null,
                  isGlobal: session.jobId.isGlobal === true,
                  site: session.jobId.site?._id
                    ? { _id: String(session.jobId.site._id), siteName: session.jobId.site.siteName }
                    : null,
                }
              : null,

            ...updatedSplitInfo(session),

            checkIn:
              session.checkIn,

            checkOut:
              session.checkOut,

            workedHours:
              session.workedHours,

            isNightShift:
              session.isNightShift || false,

            markedBy:
              session.markedBy,
          })
        ),
    };

    return res.status(200).json({
      success: true,
      message:
        "Attendance updated successfully",
      attendance:
        formattedAttendance,
    });
  } catch (error) {
    console.error(
      "Update attendance error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};//


export const getEmployeeAttendanceByMonth = async (req, res) => {
  try {
    const { employeeId } =
      req.params;

    // Timesheets are read-only and viewable by ANY supervisor, not just the one
    // whose assigned site the employee currently belongs to. This mirrors the
    // unscoped employee list (GET /api/employees) and single-employee read
    // (GET /api/employees/:id), which are not site-scoped for supervisors either.
    const { month, year } =
      req.query;

    if (
      !employeeId ||
      !month ||
      !year
    ) {
      return res.status(400).json({
        success: false,
        message:
          "employeeId, month and year are required",
      });
    }

    // UTC month bounds — how Attendance.date is stored (see monthFrom/monthTo below).
    const startDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const endDate = new Date(Date.UTC(Number(year), Number(month), 1) - 1);

    const attendance =
      await Attendance.find({
        employee: employeeId,

        date: {
          $gte: startDate,
          $lte: endDate,
        },
      })

        .populate(
          "employee",
          "name employeeId jobTitle"
        )

        .populate(
          "siteId",
          "siteName"
        )

        .populate(
          "jobId",
          "name jobCode"
        )

        .populate(
          "sessions.siteId",
          "siteName"
        )

        .populate(
          "sessions.jobId",
          "name jobCode"
        )

        .sort({
          date: 1,
        });

    const monthSplitInfo = await buildSplitLookup(
      attendance.flatMap((r) => r.sessions || [])
    );
    const formattedData =
      attendance.map((record) => ({
        attendanceId:
          record._id,

        employee:
          record.employee._id,

        name:
          record.employee.name,

        employeeId:
          record.employee.employeeId,

        jobTitle:
          record.employee.jobTitle,

        siteId:
          record.siteId?._id,

        siteName:
          record.siteId?.siteName,

        jobId:
          record.jobId?._id || null,

        jobName:
          record.jobId?.name ||
          null,

        jobCode:
          record.jobId?.jobCode ||
          null,

        date: record.date,

        status:
          record.status,

        isHoliday:
          record.isHoliday,

        holidayReason:
          record.holidayReason || null,

        holidayHours:
          record.holidayHours || 0,

        isSickLeave:
          record.isSickLeave || false,

        isLop:
          record.isLop || false,

        // Surfaced in the on-screen detail grid and the timesheet Excel export.
        remark:
          record.remark || "",

        isPaidLeave:
          record.isPaidLeave || false,

        isEmergencyLeave:
          record.isEmergencyLeave || false,

        totalWorkHours:
          record.totalWorkHours,

        overtimeHours:
          record.overtimeHours,

        shiftType: record.shiftType,

        crossedMidnight: record.crossedMidnight,

        breaksTaken: record.breaksTaken,


        sessions:
          record.sessions.map(
            (session) => ({
              _id: session._id,

              siteId:
                session.siteId?._id,

              siteName:
                session.siteId
                  ?.siteName,

              jobId:
                session.jobId?._id ||
                null,

              jobName:
                session.jobId
                  ?.name ||
                null,

              jobCode:
                session.jobId
                  ?.jobCode ||
                null,

              ...monthSplitInfo(session),

              checkIn:
                session.checkIn,

              checkOut:
                session.checkOut,

              workedHours:
                session.workedHours,

              isNightShift:
                session.isNightShift || false,

              markedBy:
                session.markedBy,
            })
          ),
      }));

    // Unmarked days for the month, counted exactly like the Monthly Report
    // (utils/unmarkedDays.js) so the timesheet's Payment Days matches its row there.
    // UTC month bounds — how Attendance.date is stored.
    const monthFrom = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const monthTo = new Date(Date.UTC(Number(year), Number(month), 0));
    const [employeeDoc, workConfig, customHolidays] = await Promise.all([
      empModel
        .findById(employeeId)
        .select("isActive createdAt employmentType")
        .lean(),
      workModel.findOne({ type: "default" }).lean(),
      customHolidayModel
        .find({
          date: {
            $gte: monthFrom,
            $lte: new Date(monthTo.getTime() + 86400000 - 1),
          },
        })
        .lean(),
    ]);
    const countableDays = buildCountableDays(
      eachUtcDay(monthFrom, monthTo),
      workConfig?.weeklyHolidays || [],
      customHolidays
    );

    return res.status(200).json({
      success: true,

      totalRecords:
        formattedData.length,

      data: formattedData,

      // Days with no record, and whether WorkSchedule.countUnmarkedAsAbsent deducts them.
      payroll: {
        unmarkedDays: employeeDoc
          ? countUnmarkedDays(employeeDoc, attendance, countableDays)
          : 0,
        unmarkedAsAbsent: unmarkedAsAbsent(workConfig),
      },
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch attendance",
      error: error.message,
    });
  }
};//

export const getAttendanceById = async (req, res) => {
  try {
    const { attendanceId } = req.params
    const { siteId } = req.query

    if (isSiteScopedRole(req.user.role)) {
      const user = await userModel.findById(req.user.id);
      const record = await Attendance.findById(attendanceId);
      // Check against the specific site the caller is viewing (siteId), not
      // the doc's primary/original site — a multi-site record can contain
      // sessions for sites other than whichever one created the doc.
      const sameSite = !!(
        record &&
        user &&
        user.assignedSite &&
        siteId &&
        user.assignedSite.toString() === siteId.toString() &&
        record.sessions.some((s) => s.siteId.toString() === siteId.toString())
      );
      // Employee-scoped carryover: also allow LOADING another site's record to
      // close a dangling open shift for an employee now on this supervisor's
      // roster (see utils/carryoverAccess.js). Mirrors the updateAttendance gate.
      const carryoverOk = !sameSite && record && user && user.assignedSite
        ? await supervisorMayCloseCarryover(record, user.assignedSite, siteId)
        : false;
      if (!sameSite && !carryoverOk) {
        return res.status(403).json({ success: false, message: "Forbidden: Access denied to this attendance record" });
      }
    }

    if (
      !mongoose.Types.ObjectId.isValid(
        attendanceId
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid attendance id",
      })
    }

    const result = await Attendance.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(
            attendanceId
          ),
        },
      },

      // Employee
      {
        $lookup: {
          from: "employees",
          localField: "employee",
          foreignField: "_id",
          as: "employee",
        },
      },
      {
        $unwind: "$employee",
      },

      // Main attendance site
      {
        $lookup: {
          from: "sites",
          localField: "siteId",
          foreignField: "_id",
          as: "attendanceSite",
        },
      },

      // Main attendance job
      {
        $lookup: {
          from: "jobs",
          localField: "jobId",
          foreignField: "_id",
          as: "attendanceJob",
        },
      },

      // Session sites
      {
        $lookup: {
          from: "sites",
          localField: "sessions.siteId",
          foreignField: "_id",
          as: "sessionSites",
        },
      },

      // Session jobs
      {
        $lookup: {
          from: "jobs",
          localField: "sessions.jobId",
          foreignField: "_id",
          as: "sessionJobs",
        },
      },

      {
        $project: {
          _id: 0,

          attendanceId: "$_id",

          employee: "$employee._id",

          name: "$employee.name",

          employeeId:
            "$employee.employeeId",

          jobTitle:
            "$employee.jobTitle",

          // Roster category source (for the edit modal's over-default check-out remark
          // gate) + the current supervisor remark, so the modal can prefill it.
          collarType: "$employee.collarType",

          nationality: "$employee.nationality",

          remark: "$remark",

          // Version token: EditSiteRecord sends it back as expectedUpdatedAt.
          updatedAt: "$updatedAt",

          siteId: "$siteId",

          siteName: {
            $arrayElemAt: [
              "$attendanceSite.siteName",
              0,
            ],
          },

          jobId: "$jobId",

          jobName: {
            $arrayElemAt: [
              "$attendanceJob.name",
              0,
            ],
          },

          date: "$date",

          status: "$status",

          isHoliday: "$isHoliday",

          holidayReason: "$holidayReason",

          holidayHours: "$holidayHours",

          totalWorkHours:
            "$totalWorkHours",

          overtimeHours:
            "$overtimeHours",

          shiftType: "$shiftType",

          crossedMidnight: "$crossedMidnight",

          breaksTaken: "$breaksTaken",


          sessions: {
            $map: {
              input: "$sessions",
              as: "s",
              in: {
                _id: "$$s._id",

                siteId:
                  "$$s.siteId",

                siteName: {
                  $let: {
                    vars: {
                      matchedSite: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input:
                                "$sessionSites",
                              as: "site",
                              cond: {
                                $eq: [
                                  "$$site._id",
                                  "$$s.siteId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: "$$matchedSite.siteName",
                  },
                },

                jobId:
                  "$$s.jobId",

                jobName: {
                  $let: {
                    vars: {
                      matchedJob: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input:
                                "$sessionJobs",
                              as: "job",
                              cond: {
                                $eq: [
                                  "$$job._id",
                                  "$$s.jobId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: "$$matchedJob.name",
                  },
                },

                servedSiteId:
                  "$$s.servedSiteId",

                splitJobIds:
                  "$$s.splitJobIds",

                checkIn:
                  "$$s.checkIn",

                checkOut:
                  "$$s.checkOut",

                workedHours:
                  "$$s.workedHours",

                isNightShift:
                  "$$s.isNightShift",

                markedBy:
                  "$$s.markedBy",
              },
            },
          },
        },
      },
    ])

    if (!result.length) {
      return res.status(404).json({
        success: false,
        message:
          "Attendance record not found",
      })
    }

    const byIdSplitInfo = await buildSplitLookup(result[0].sessions || [])
    for (const s of result[0].sessions || []) Object.assign(s, byIdSplitInfo(s))

    return res.status(200).json(
      result[0]
    )
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch attendance record",
      error: error.message,
    })
  }
}//

export const addSessionToAttendance = async (
  req,
  res
) => {
  try {
    const { attendanceId } =
      req.params

    const { session } = req.body

    if (!session?.siteId) {
      return res.status(400).json({
        success: false,
        message:
          "Site ID is required",
      })
    }

    const attendance =
      await Attendance.findById(
        attendanceId
      )

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message:
          "Attendance record not found",
      })
    }

    // A paid-leave day is locked — no sessions may be added until an admin cancels
    // the leave grant (see updateAttendance for the same rule).
    if (isGrantedLeaveDay(attendance)) {
      return res.status(409).json({
        success: false,
        message: leaveLockedMessage(attendance),
      })
    }

    if (isSiteScopedRole(req.user.role)) {
      const user = await userModel.findById(req.user.id);
      // Check against the NEW session's own site, not the doc's primary
      // site — this session may belong to a different site than whichever
      // site's submission originally created the doc.
      if (!user || !user.assignedSite || user.assignedSite.toString() !== session.siteId.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: Access denied to this attendance record" });
      }
    }

    // Drivers live only on the Drivers sheet — never given a session at a real site.
    if (!(await isDriverPool(session.siteId))) {
      const sessionEmployee = await Employee.findById(attendance.employee).select("jobTitle").lean();
      if (isDriverTitle(sessionEmployee?.jobTitle)) {
        return res.status(400).json({ success: false, code: "DRIVER_ONLY", message: DRIVER_ONLY_MESSAGE });
      }
    }

    // Check if there are any existing sessions for this site that are incomplete
    const incompleteSession = attendance.sessions.find(
      (s) => s.siteId.toString() === session.siteId.toString() && (!s.checkIn || !s.checkOut)
    );

    if (incompleteSession) {
      return res.status(400).json({
        success: false,
        message: "Please complete check-in and check-out for the existing session at this site first.",
      });
    }

    // A closed session carries its hours like every other write path (they weight the job
    // report and the ERPNext timesheet) — it used to be stored with 0.
    const addIn = session.checkIn ? new Date(session.checkIn) : null
    const addOut = session.checkOut ? new Date(session.checkOut) : null
    if ((addIn && isNaN(addIn)) || (addOut && isNaN(addOut)) || (addOut && !addIn)) {
      return res.status(400).json({ success: false, message: "Invalid check-in/check-out" })
    }
    const addHours = addIn && addOut ? (addOut.getTime() - addIn.getTime()) / (1000 * 60 * 60) : 0
    if (addIn && addOut && !(addHours > 0 && addHours <= MAX_SHIFT_HOURS)) {
      return res.status(400).json({ success: false, message: "Invalid shift duration" })
    }

    attendance.sessions.push({
      siteId: session.siteId,
      jobId:
        session.jobId || null,
      checkIn: addIn,
      checkOut: addOut,
      workedHours: Number(addHours.toFixed(2)),
      markedBy: req.user.id,
    })

    // Recompute totals so holidayHours/overtime stay consistent with the
    // record's stored holiday state.
    const workConfig = await workModel.findOne({ type: "default" })
    if (workConfig) {
      const rawHours = sumRawHours(attendance.sessions)

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        attendance.breaksTaken ?? null,
        { isHoliday: attendance.isHoliday, reason: attendance.holidayReason }
      )

      attendance.totalWorkHours = netWorkHours
      attendance.status = status
      attendance.overtimeHours = overtimeHours
      attendance.holidayHours = holidayHours
    }

    await attendance.save()

    // --- Audit: a session was added (best-effort; no transaction on this path) ---
    let addedLabel = ""
    try {
      if (session.jobId) {
        const j = await Job.findById(session.jobId).select("name").lean()
        if (j?.name) addedLabel = ` for ${j.name}`
      }
    } catch { /* label is best-effort */ }
    await recordAttendanceAudit({
      attendance,
      actor: await resolveActor(req),
      type: "session_added",
      summary: `New session created${addedLabel}`,
    })

    // Keep the roster job in step with the latest session's job (this site, latest
    // record only). `session` here is the request-body session, not a mongoose session.
    await syncCurrentJobFromLatestSession({
      empId: attendance.employee,
      siteId: session.siteId,
      recordDate: attendance.date,
      doc: attendance,
    })

    const newSession =
      attendance.sessions[
        attendance.sessions.length - 1
      ]

    return res.status(201).json({
      success: true,
      message:
        "Session added successfully",
      session: newSession,
    })
  } catch (error) {
    console.log(error)

    return res.status(500).json({
      success: false,
      message:
        "Failed to add session",
    })
  }
}//


// POST /api/attendance/transfer
// Moves an employee from their current site to a new one, carrying their
// checkout time at the source site forward as the check-in at the
// destination. `date` is the business day of the SOURCE record: today, or —
// until local noon — yesterday, for a night shift that is still running
// (the carryover). The arrival is always placed on that same record.
// From yesterday's record, the source check-out must be past midnight or within this many
// hours of now; anything older is a stale page, not a night move.
const LATE_TRANSFER_GRACE_HOURS = 6
export const transferEmployee = async (req, res) => {
  const { employeeId, fromSiteId, toSiteId, jobId = null, date, onlyForToday } = req.body

  if (!employeeId || !fromSiteId || !toSiteId || !date) {
    return res.status(400).json({
      success: false,
      message: "employeeId, fromSiteId, toSiteId and date are required",
    })
  }

  // The dialog makes the user pick "For today" or "Permanent" explicitly — never default
  // to a permanent re-home just because a field was left out.
  if (typeof onlyForToday !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Choose whether the transfer is for today only or permanent",
    })
  }

  if (fromSiteId.toString() === toSiteId.toString()) {
    return res.status(400).json({
      success: false,
      message: "Target site must be different from the current site",
    })
  }

  // Today's record, or yesterday's while its night shift is still live (before local
  // noon). Anything else means the page is showing an old day — e.g. left open overnight.
  const recordDay = String(date).slice(0, 10)
  if (!isWithinCarryoverWindow(recordDay)) {
    return res.status(400).json({
      success: false,
      message: `This sheet is for ${recordDay}, which can no longer be transferred from — reload the page`,
    })
  }

  const attendanceDate = new Date(recordDay)
  attendanceDate.setUTCHours(0, 0, 0, 0)

  const dbSession = await mongoose.startSession()
  dbSession.startTransaction()

  try {
    const throwValidationError = (status, message) => {
      const err = new Error(message)
      err.status = status
      throw err
    }

    if (req.user.role === "supervisor") {
      const user = await userModel.findById(req.user.id).session(dbSession)
      if (!user || !user.assignedSite || user.assignedSite.toString() !== fromSiteId.toString()) {
        throwValidationError(403, "Forbidden: Access denied to this site")
      }
    }

    const toSite = await Site.findById(toSiteId).session(dbSession)
    if (!isAssignableSite(toSite)) {
      throwValidationError(400, "Target site is not a valid transfer destination")
    }

    if (jobId && !(await findAssignableJob(jobId, toSiteId, dbSession))) {
      throwValidationError(400, "That job is not active at the target site")
    }

    const employee = await empModel.findById(employeeId).session(dbSession)
    if (!employee || !employee.isActive) {
      throwValidationError(404, "Employee not found")
    }
    // Drivers live only on the Drivers sheet — never transferred onto (or off it to) a site.
    if (isDriverTitle(employee.jobTitle) || (await isDriverPool(fromSiteId, dbSession))) {
      throwValidationError(400, DRIVER_ONLY_MESSAGE)
    }

    // Only the employee's HOME site (or an admin) may re-home them. A site they are merely
    // visiting today can send them on for the rest of the day, but a permanent move of
    // another site's employee must come from that site (or an admin).
    if (
      req.user.role === "supervisor" &&
      !onlyForToday &&
      (!employee.currentSite || employee.currentSite.toString() !== fromSiteId.toString())
    ) {
      throwValidationError(
        403,
        "Only the employee's home site or an admin can move them permanently — choose 'For today'"
      )
    }

    const attendanceDoc = await Attendance.findOne({
      employee: employeeId,
      date: attendanceDate,
    }).session(dbSession)

    if (!attendanceDoc) {
      throwValidationError(400, "No attendance record found for this employee on that day")
    }

    const sourceSession = attendanceDoc.sessions
      .filter((s) => s.siteId.toString() === fromSiteId.toString())
      .sort((a, b) => new Date(b.checkIn || 0) - new Date(a.checkIn || 0))[0]

    if (!sourceSession || !sourceSession.checkIn) {
      throwValidationError(400, "Employee has not checked in at the current site today")
    }

    if (!sourceSession.checkOut) {
      throwValidationError(400, "Please complete the check-out for the current session before transferring")
    }

    const carriedCheckIn = sourceSession.checkOut

    // Yesterday's record is transferable only while its night is still live: the shift ran
    // past midnight, or it ended late enough that this is plausibly a night move being
    // recorded now. A day shift that ended yesterday afternoon is a page left open
    // overnight — carrying that check-out would open a session at the destination on
    // yesterday's record.
    if (recordDay !== getTodayLocal()) {
      const carriedMs = new Date(carriedCheckIn).getTime()
      const crossedMidnight = carriedMs >= combineFromOffset(getTodayLocal(), "00:00").getTime()
      const recent = Date.now() - carriedMs <= LATE_TRANSFER_GRACE_HOURS * 60 * 60 * 1000
      if (!crossedMidnight && !recent) {
        throwValidationError(
          400,
          `This sheet is for ${recordDay} and that shift ended long ago — reload the page to transfer from today's sheet`
        )
      }
    }

    // This check-out can only be carried forward once (a second click on a stale row, or a
    // request made after they already went elsewhere, would place them at two sites).
    await assertNotMovedOn({
      doc: attendanceDoc,
      fromSiteId,
      toSiteId,
      carriedCheckIn,
      session: dbSession,
    })

    // Supervisor-initiated midday transfer → a request the DESTINATION site's
    // supervisors must accept before the employee lands there (verification that the
    // move goes to the right site). Admins/superadmins bypass and transfer immediately.
    if (req.user.role === "supervisor") {
      const mode = onlyForToday ? "today" : "permanent"
      const destSupervisors = await findSiteSupervisors(toSiteId)

      let created
      try {
        created = await TransferRequest.create(
          [
            {
              employee: employee._id,
              fromSite: fromSiteId,
              fromJob: employee.currentJob || null,
              toSite: toSiteId,
              toJob: jobId || null,
              mode,
              direction: "push",
              carriedCheckIn,
              requestedBy: req.user.id,
              approver: destSupervisors[0]?._id ?? null,
              status: "pending",
              dateLocal: getTodayLocal(),
              // The source record's day — the arrival is placed on this record when the
              // destination accepts, even if that happens after midnight (night shift).
              attendanceDate: recordDay,
            },
          ],
          { session: dbSession }
        )
      } catch (err) {
        if (err.code === 11000) {
          throwValidationError(409, "A transfer for this employee is already pending")
        }
        throw err
      }
      const request = created[0]

      await dbSession.commitTransaction()
      dbSession.endSession()

      // Notify the destination site's decider(s) (best-effort, after commit).
      try {
        const requester = await userModel.findById(req.user.id).select("name")
        const payload = {
          type: "request_received",
          title: "New transfer request",
          body: `${requester?.name || "A supervisor"} wants to transfer ${employee.name} to your site${mode === "permanent" ? " (permanent)" : " for today"}.`,
          url: "/requests",
          relatedRequest: request._id,
        }
        if (destSupervisors.length) await Promise.all(destSupervisors.map((s) => notifyUser(s._id, payload)))
        else await notifyAdmins(payload)
      } catch (e) {
        console.error("[transfer] request notify failed:", e.message)
      }

      // --- Site activity: a midday transfer request was sent (best-effort; both feeds) ---
      try {
        const reqActor = await resolveActor(req)
        const fromSiteDoc = await Site.findById(fromSiteId).select("siteName")
        await recordSiteActivity({
          type: "request_sent",
          actor: reqActor,
          employee: employee._id,
          employeeName: employee.name,
          fromSiteId,
          toSiteId,
          summary: `${reqActor.actorName} requested a midday transfer of ${employee.name} from ${fromSiteDoc?.siteName || "their site"} to ${toSite?.siteName || "the site"} (${mode === "permanent" ? "permanent" : "for today"})`,
        })
      } catch (e) {
        console.error("[transfer] request activity log failed:", e.message)
      }

      return res.status(201).json({
        success: true,
        requested: true,
        pending: true,
        message: `Transfer request sent to ${toSite?.siteName || "the site"} — awaiting their approval`,
        data: request,
      })
    }

    // Admin/superadmin: apply the transfer immediately (shared placement helper).
    const { pending: isPending } = await placeMiddayArrival({
      employee,
      fromSiteId,
      toSiteId,
      jobId: jobId || null,
      carriedCheckIn,
      attendanceDate,
      onlyForToday,
      markedById: req.user.id,
      actor: await resolveActor(req),
      session: dbSession,
      attendanceDoc,
    })

    // Any request still pending for this employee is overtaken by the direct transfer.
    const transferredNote = `they were transferred to ${toSite?.siteName || "another site"} directly`
    const superseded = await supersedePendingRequests({
      filter: { employee: employee._id },
      note: transferredNote,
      decidedBy: req.user.id,
      session: dbSession,
    })

    await dbSession.commitTransaction()
    dbSession.endSession()

    await notifySuperseded(superseded, transferredNote, { exceptUserId: req.user.id })

    // Tell the SOURCE site's supervisor(s) — an admin moved their employee on.
    try {
      const departActor = await resolveActor(req)
      await notifySiteSupervisors(
        fromSiteId,
        {
          type: "transfer_departed",
          title: "Employee transferred from your site",
          body: `${employee.name} was transferred to ${toSite?.siteName || "another site"} by ${departActor.actorName}${onlyForToday ? " for today" : " (permanent)"}.`,
          url: `/attendance/${fromSiteId}`,
        },
        { exceptUserId: req.user.id }
      )
    } catch (e) {
      console.error("[transfer] departure notify failed:", e.message)
    }

    // Notify the destination site's supervisor(s) that an employee arrived via a
    // midday transfer they did not request (the "unknowingly" case). Best-effort,
    // after commit; skip the acting user if they supervise the site (already know).
    try {
      await notifySiteSupervisors(
        toSiteId,
        {
          type: "transfer_arrived",
          title: "Employee transferred in",
          body: `${employee.name} was transferred to your site today.`,
          url: `/attendance/${toSiteId}`,
        },
        { exceptUserId: req.user.id }
      )
    } catch (e) {
      console.error("[transfer] arrival notify failed:", e.message)
    }

    // --- Site activity: direct midday/permanent transfer (best-effort; both sites' feeds) ---
    try {
      const transferActor = await resolveActor(req)
      const fromSiteDoc = await Site.findById(fromSiteId).select("siteName")
      await recordSiteActivity({
        type: onlyForToday ? "transfer_today" : "transfer_permanent",
        actor: transferActor,
        employee: employee._id,
        employeeName: employee.name,
        fromSiteId,
        toSiteId,
        summary: `${transferActor.actorName} transferred ${employee.name} from ${fromSiteDoc?.siteName || "their site"} to ${toSite?.siteName || "the site"} (${onlyForToday ? "for today" : "permanent"})`,
      })
    } catch (e) {
      console.error("[transfer] activity log failed:", e.message)
    }

    await employee.populate("currentJob", "name")
    await employee.populate("currentSite", "siteName")

    const relocated = !onlyForToday
    // The arrival is always recorded now (placeMiddayArrival pushes the session immediately).
    // `pending` (destination unlocked) only means its draft will ALSO show the row for editing.
    return res.status(200).json({
      success: true,
      message: onlyForToday
        ? (isPending
            ? "Session added at target site for today; it will also show on that site's sheet when they next open it. Home site unchanged"
            : "Session added at target site for today; home site unchanged")
        : (isPending
            ? "Employee transferred; session added at target site (also shown on that site's sheet when next opened)"
            : "Employee transferred; new session added at target site"),
      pending: isPending,
      relocated,
      employee,
    })
  } catch (error) {
    await dbSession.abortTransaction()
    dbSession.endSession()
    console.error(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to transfer employee",
    })
  }
}//



// --- BACKFILL ---

// GET /api/attendance/missing?date=&name=&employeeId=&jobTitle=&page=&limit=
export const getMissingEmployees = async (req, res) => {
  try {
    let { date, name, employeeId, jobTitle, site, page = 1, limit = 10 } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required' });
    }

    page = Math.max(Number(page) || 1, 1);
    limit = Math.min(Number(limit) || 10, 100);
    const skip = (page - 1) * limit;

    // Date range for the selected day
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    // Get employee IDs that already have a record for this date
    const existingRecords = await Attendance.find({
      date: { $gte: startDate, $lte: endDate },
    }).select('employee').lean();

    const recordedEmployeeIds = existingRecords.map((r) => r.employee.toString());

    // Build employee filter
    let employeeFilter = { isActive: true };

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      if (!user || !user.assignedSite) {
        return res.status(200).json({
          success: true,
          pagination: { currentPage: page, totalPages: 0, totalEmployees: 0, limit },
          data: [],
        });
      }
      employeeFilter.currentSite = user.assignedSite;
    }

    if (recordedEmployeeIds.length > 0) {
      employeeFilter._id = { $nin: recordedEmployeeIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    if (name) {
      employeeFilter.name = { $regex: escapeRegExp(name), $options: 'i' };
    }
    if (employeeId) {
      employeeFilter.employeeId = { $regex: escapeRegExp(employeeId), $options: 'i' };
    }
    if (jobTitle) {
      employeeFilter.jobTitle = { $regex: escapeRegExp(jobTitle), $options: 'i' };
    }

    // Narrow by currentSite (list convenience). Supervisors are already scoped to their
    // assignedSite above, so only apply the client-supplied filter for admins/superadmins.
    if (site && site !== 'all' && req.user.role !== 'supervisor') {
      // "Drivers" (the hidden pool) → the drivers roster; they have no currentSite.
      if (await isDriverPool(site)) Object.assign(employeeFilter, driverEmployeeFilter());
      else employeeFilter.currentSite = new mongoose.Types.ObjectId(site);
    }

    const totalEmployees = await Employee.countDocuments(employeeFilter);
    const totalPages = Math.ceil(totalEmployees / limit);

    const employees = await Employee.find(
      employeeFilter,
      '_id name employeeId jobTitle currentSite currentJob employmentType'
    )
      .populate('currentSite', 'siteName')
      .populate('currentJob', 'name')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      pagination: { currentPage: page, totalPages, totalEmployees, limit },
      data: employees,
    });
  } catch (error) {
    console.error('getMissingEmployees error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch missing employees' });
  }
};

// POST /api/attendance/backfill
// Body: { employeeMongoId, date, sessions: [{siteId, jobId, checkIn, checkOut, isNightShift}] }
export const backfillAttendance = async (req, res) => {
  try {
    const { employeeMongoId, date, sessions = [], breaksTaken = null, isSickLeave = false, isLop = false } = req.body;

    const markedBy = req.user?.id;
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];

    if (!employeeMongoId || !date) {
      return res.status(400).json({ success: false, message: 'employeeMongoId and date are required' });
    }

    // Verify employee exists
    const employee = await Employee.findById(employeeMongoId).lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Check if a record already exists for this employee on this date
    const existing = await Attendance.findOne({ employee: employeeMongoId, date: attendanceDate });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Attendance record already exists for this employee on this date' });
    }

    const workConfig = await workModel.findOne({ type: 'default' });
    if (!workConfig) {
      return res.status(404).json({ success: false, message: 'Work schedule configuration not found' });
    }

    const { fullDayHours, halfDayHours, overtimeThreshold } = workConfig;

    // Validate and build sessions
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ success: false, message: 'sessions must be an array' });
    }

    // Backfill records what actually happened on an explicit past day: times are combined
    // literally with that day, and a check-out earlier than its check-in bumps to the next
    // calendar day (the standard offset rule). Correctness is enforced by the direct
    // timestamp-overlap check against the neighbouring days' records below.
    const builtSessions = [];

    for (const session of sessions) {
      const { siteId: sessionSiteId, jobId, checkIn, checkOut } = session;

      if (!sessionSiteId) {
        return res.status(400).json({ success: false, message: 'Every session must have a site selected' });
      }

      if (!checkIn && checkOut) {
        return res.status(400).json({ success: false, message: 'Check-out cannot exist without check-in' });
      }

      const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkIn, checkOut, !!session.startsAfterMidnight);
      const sessionIsNight = checkInNextDay || checkOutNextDay;

      let workedHours = 0;
      const checkInDate = checkIn ? combineFromOffset(date, checkIn, checkInNextDay) : null;
      const checkOutDate = checkOut ? combineFromOffset(date, checkOut, checkOutNextDay) : null;

      if (checkInDate && checkOutDate) {
        workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
        if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
          return res.status(400).json({ success: false, message: 'Invalid shift duration' });
        }
      }

      builtSessions.push({
        siteId: sessionSiteId,
        jobId: jobId || null,
        splitJobIds: Array.isArray(session.splitJobIds) ? session.splitJobIds : [],
        checkIn: checkInDate,
        checkOut: checkOutDate,
        workedHours: Number(workedHours.toFixed(2)),
        markedBy,
        isNightShift: sessionIsNight,
      });
    }

    // Sessions placed on "Drivers" (the hidden pool) need a driver and a site + job split,
    // like the sheet (resolved in place). A split anywhere else is dropped.
    const backfillPoolId = await getDriverPoolId();
    const driverError = await validateDriverPoolSessions({
      sessions: builtSessions,
      poolId: backfillPoolId,
      employee,
    });
    if (driverError) {
      return res.status(400).json({ success: false, message: driverError });
    }
    // ...and a driver is never backfilled onto a real site.
    const offPoolError = nonPoolDriverSessionError({ sessions: builtSessions, poolId: backfillPoolId, employee });
    if (offPoolError) {
      return res.status(400).json({ success: false, code: "DRIVER_ONLY", message: offPoolError });
    }
    for (const s of builtSessions) {
      if (String(s.siteId) === String(backfillPoolId) && (s.checkIn || s.checkOut)) continue;
      s.splitJobIds = [];
      s.servedSiteId = null;
    }

    // Sort sessions by checkIn
    builtSessions.sort((a, b) => {
      if (!a.checkIn && !b.checkIn) return 0;
      if (!a.checkIn) return 1;
      if (!b.checkIn) return -1;
      return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
    });

    // Overlap check
    const validSessions = builtSessions.filter((s) => s.checkIn);
    for (let i = 0; i < validSessions.length - 1; i++) {
      const a = validSessions[i];
      const b = validSessions[i + 1];
      const aStart = new Date(a.checkIn);
      const aEnd = a.checkOut ? new Date(a.checkOut) : aStart;
      const bStart = new Date(b.checkIn);
      const bEnd = b.checkOut ? new Date(b.checkOut) : bStart;

      if (aStart < bEnd && aEnd > bStart) {
        const siteId = req.query.siteId || req.body.siteId;
        let conflicting = b;
        if (siteId && a.siteId && a.siteId.toString() !== siteId.toString()) {
          conflicting = a;
        }
        const site = await Site.findById(conflicting.siteId).select("siteName");

        return res.status(400).json({
          success: false,
          message: 'Attendance sessions overlap',
          overlap: {
            employeeId: employeeMongoId,
            firstIndex: i,
            secondIndex: i + 1,
            sessionA: { checkIn: a.checkIn, checkOut: a.checkOut },
            sessionB: { checkIn: b.checkIn, checkOut: b.checkOut },
            conflictingSession: {
              siteId: conflicting.siteId,
              siteName: site ? (site.siteName || "Unknown Site") : "Unknown Site",
              jobId: conflicting.jobId,
              checkIn: conflicting.checkIn,
              checkOut: conflicting.checkOut,
            }
          },
        });
      }
    }

    // Keeps a backfilled day from claiming real hours the SAME employee's neighbouring
    // days' records already cover — that would silently pay the same hours twice.
    {
      const crossDayConflict = await buildCrossDayOverlapChecker({
        employeeIds: [employeeMongoId],
        date: attendanceDate,
      });
      const neighbourConflict = crossDayConflict(employeeMongoId, validSessions);
      if (neighbourConflict) {
        return res.status(400).json({
          success: false,
          message: crossDayOverlapMessage(neighbourConflict),
        });
      }
    }

    // Totals
    const rawHours = sumRawHours(builtSessions);

    const holidayInfo = await checkHolidayForDate(attendanceDate);
    // Temporary workers are exempt from holiday treatment — for them a holiday is a
    // normal working day (normal hours + OT, no holiday-hours credit).
    const effHolidayInfo = holidayInfoForEmployee(holidayInfo, employee.employmentType);

    const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
      rawHours,
      workConfig,
      breaksTaken,
      effHolidayInfo
    );

    const hasCrossedMidnight = detectCrossedMidnight(builtSessions, timezoneOffset);

    // Default siteId = first session's site (if any), else employee's current site
    const primarySiteId = builtSessions.length > 0 ? builtSessions[0].siteId : (employee.currentSite || null);

    if (!primarySiteId) {
      return res.status(400).json({ success: false, message: 'Could not determine a site for this record. Add at least one session with a site.' });
    }

    const newAttendance = new Attendance({
      employee: employeeMongoId,
      date: attendanceDate,
      siteId: primarySiteId,
      jobId: builtSessions.length > 0 ? (builtSessions[0].jobId || null) : null,
      markedBy,
      isHoliday: effHolidayInfo.isHoliday,
      holidayReason: effHolidayInfo.reason,
      holidayHours,
      isSickLeave: !!isSickLeave,
      isLop: !!isLop,
      status,
      totalWorkHours: netWorkHours,
      overtimeHours,
      breaksTaken: breaksTaken !== undefined ? breaksTaken : null,
      shiftType: hasCrossedMidnight ? 'night' : 'day',
      crossedMidnight: hasCrossedMidnight,
      sessions: builtSessions,
    });

    // Auto-fill the "Deduct <amount> OMR" penalty remark when backfilling a LOP day.
    if (isLop) applyLopRemark(newAttendance, true, workConfig.lopDeductionAmount);

    await newAttendance.save();

    // --- Audit: a past-day record was created after the fact (best-effort) ---
    await recordAttendanceAudit({
      attendance: newAttendance,
      actor: await resolveActor(req),
      type: "backfilled",
      summary: "Record backfilled",
    });

    // Backfilling a PAST day is a no-op here (a later record exists → the guard skips
    // it); only if this is the employee's latest record at their current site does the
    // roster job sync to the latest session.
    await syncCurrentJobFromLatestSession({
      empId: employeeMongoId,
      siteId: primarySiteId,
      recordDate: attendanceDate,
      doc: newAttendance,
    });

    // Populate for response
    const populated = await Attendance.findById(newAttendance._id)
      .populate('employee', 'name employeeId jobTitle')
      .populate('siteId', 'siteName')
      .populate('jobId', 'name')
      .populate('sessions.siteId', 'siteName')
      .populate('sessions.jobId', 'name')
      .lean();

    const record = populated;
    const backfillSplitInfo = await buildSplitLookup(record.sessions);
    const formatted = {
      attendanceId: record._id,
      employee: record.employee?._id,
      name: record.employee?.name || '',
      employeeId: record.employee?.employeeId || '',
      jobTitle: record.employee?.jobTitle || '',
      siteId: record.siteId?._id,
      siteName: record.siteId?.siteName || '',
      jobId: record.jobId?._id || null,
      jobName: record.jobId?.name || '',
      date: record.date,
      status: record.status,
      isHoliday: record.isHoliday,
      holidayReason: record.holidayReason || null,
      holidayHours: record.holidayHours || 0,
      isSickLeave: record.isSickLeave || false,
      isLop: record.isLop || false,
      isPaidLeave: record.isPaidLeave || false,
      isEmergencyLeave: record.isEmergencyLeave || false,
      totalWorkHours: record.totalWorkHours,
      overtimeHours: record.overtimeHours,
      breaksTaken: record.breaksTaken,
      shiftType: record.shiftType,
      crossedMidnight: record.crossedMidnight,
      sessions: record.sessions.map((session) => ({
        _id: session._id,
        siteId: session.siteId?._id,
        siteName: session.siteId?.siteName || '',
        jobId: session.jobId?._id || null,
        jobName: session.jobId?.name || '',
        ...backfillSplitInfo(session),
        checkIn: session.checkIn,
        checkOut: session.checkOut,
        workedHours: session.workedHours,
        isNightShift: session.isNightShift || false,
        markedBy: session.markedBy,
      })),
    };

    return res.status(201).json({ success: true, message: 'Attendance record created successfully', attendance: formatted });
  } catch (error) {
    console.error('backfillAttendance error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create attendance record', error: error.message });
  }
};

// POST /api/attendance/backfill/bulk
// Backfill ONE common session for MANY employees at once. Body:
//   { date, employeeIds: [], siteId, jobId?, checkIn, checkOut,
//     checkInNextDay?, checkOutNextDay?, breaksTaken? }
// The site, job and times are shared; the day offsets are EXPLICIT (so a true 24h shift
// like 08:00→08:00 works — the auto-derive in the single endpoint can't infer that). Each
// employee gets an independent, non-transactional save so partial success is preserved:
// employees who already have a record, or whose times collide with a neighbouring day's
// record, are reported back rather than aborting the whole batch.
export const bulkBackfillAttendance = async (req, res) => {
  try {
    const {
      date,
      employeeIds = [],
      siteId,
      jobId = null,
      checkIn,
      checkOut,
      checkInNextDay = false,
      checkOutNextDay = false,
      breaksTaken = null,
    } = req.body;

    const markedBy = req.user?.id;
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];

    if (!date || !siteId) {
      return res.status(400).json({ success: false, message: 'date and siteId are required' });
    }
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: 'employeeIds must be a non-empty array' });
    }
    if (!checkIn || !checkOut) {
      return res.status(400).json({ success: false, message: 'Both checkIn and checkOut are required' });
    }

    const site = await Site.findById(siteId).select('siteName isDriverPool').lean();
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }
    // "Drivers" (the hidden pool): a site + job split is required (lenient on liveness, as for
    // every past-day editor), and only drivers are placed on it.
    const onDriverPool = site.isDriverPool === true;
    const driverSplit = onDriverPool
      ? await resolveDriverSplit(
          Array.isArray(req.body.splitJobIds) ? req.body.splitJobIds : jobId ? [jobId] : [],
          { strict: false }
        )
      : null;
    if (onDriverPool && !driverSplit) {
      return res.status(400).json({ success: false, message: 'Pick a site and its jobs for the driver session' });
    }
    const sessionJobId = onDriverPool ? null : jobId || null;

    const workConfig = await workModel.findOne({ type: 'default' });
    if (!workConfig) {
      return res.status(404).json({ success: false, message: 'Work schedule configuration not found' });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Build the common session once — explicit day offsets win.
    const checkInDate = combineFromOffset(date, checkIn, !!checkInNextDay);
    const checkOutDate = combineFromOffset(date, checkOut, !!checkOutNextDay);
    if (!checkInDate || !checkOutDate) {
      return res.status(400).json({ success: false, message: 'Invalid check-in/check-out time' });
    }
    const workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
    if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
      return res.status(400).json({
        success: false,
        message: `Invalid shift duration — check the times or the next-day markers (max ${MAX_SHIFT_HOURS}h).`,
      });
    }
    const isNightShift = !!checkInNextDay || !!checkOutNextDay;
    const rawHours = Number(workedHours.toFixed(2));

    // Holiday is date-based → resolve once; only the per-employee employmentType varies.
    const holidayInfo = await checkHolidayForDate(attendanceDate);

    const uniqueIds = [...new Set(employeeIds.filter(Boolean).map(String))];

    const created = [];
    const skipped = [];
    const failed = [];

    // Load the employees and the records they already have for this date, both in one query.
    const employees = await Employee.find({ _id: { $in: uniqueIds }, isActive: true })
      .select('_id name employeeId employmentType currentSite jobTitle')
      .lean();
    const employeeById = new Map(employees.map((e) => [String(e._id), e]));

    const existing = await Attendance.find({
      employee: { $in: uniqueIds },
      date: attendanceDate,
    }).select('employee').lean();
    const alreadyRecorded = new Set(existing.map((r) => String(r.employee)));

    // Candidates that survive the cheap skips → run the cross-day overlap check on these.
    const candidates = [];
    for (const id of uniqueIds) {
      const emp = employeeById.get(id);
      if (!emp) {
        skipped.push({ employeeId: id, name: null, reason: 'Employee not found or inactive' });
        continue;
      }
      if (alreadyRecorded.has(id)) {
        skipped.push({ employeeId: id, name: emp.name, reason: 'Already has a record for this date' });
        continue;
      }
      if (onDriverPool && !DRIVER_TITLE_REGEX.test(emp.jobTitle || '')) {
        skipped.push({ employeeId: id, name: emp.name, reason: 'Not a driver' });
        continue;
      }
      // Drivers live only on the Drivers sheet — never backfilled onto a real site.
      if (!onDriverPool && isDriverTitle(emp.jobTitle)) {
        skipped.push({ employeeId: id, name: emp.name, reason: 'Driver — use Drivers' });
        continue;
      }
      candidates.push(emp);
    }

    const candidateSession = [{ checkIn: checkInDate, checkOut: checkOutDate }];
    const crossDayConflict = await buildCrossDayOverlapChecker({
      employeeIds: candidates.map((e) => String(e._id)),
      date: attendanceDate,
    });

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

    for (const emp of candidates) {
      const empId = String(emp._id);
      try {
        const conflict = crossDayConflict(empId, candidateSession);
        if (conflict) {
          failed.push({ employeeId: empId, name: emp.name, message: crossDayOverlapMessage(conflict) });
          continue;
        }

        // Shared with the supervisor backfill-request approval (utils/backfillRecord.js).
        const { doc: newAttendance, auditRow } = await createBackfilledRecord({
          employee: emp,
          attendanceDate,
          sessions: [{
            siteId,
            jobId: sessionJobId,
            servedSiteId: driverSplit?.servedSiteId ?? null,
            splitJobIds: driverSplit?.splitJobIds ?? [],
            checkIn: checkInDate,
            checkOut: checkOutDate,
            workedHours: rawHours,
            markedBy,
            isNightShift,
          }],
          breaksTaken,
          workConfig,
          holidayInfo,
          markedBy,
          auditActor,
          auditSummary: "Record backfilled (bulk)",
          timezoneOffset,
        });

        created.push({ employeeId: empId, name: emp.name, attendanceId: newAttendance._id });
        auditRows.push(auditRow);
      } catch (err) {
        console.error('bulkBackfillAttendance per-employee error:', empId, err);
        failed.push({
          employeeId: empId,
          name: emp.name,
          message: err?.message || 'Failed to create record',
        });
      }
    }

    await recordAttendanceAuditBatch(auditRows);

    return res.status(200).json({
      success: true,
      message: `Backfilled ${created.length} of ${uniqueIds.length} employee(s)`,
      summary: {
        createdCount: created.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
      },
      created,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('bulkBackfillAttendance error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk backfill attendance', error: error.message });
  }
};


/**
 * Bulk close open (checked-in, never-checked-out) sessions with ONE check-out time.
 *
 * Recovery tool for the Edit-Past-Attendance page: when the auto-checkout cron did not run
 * (server down) or a site has no default check-out for a category, sessions are left open.
 * This applies a single "HH:mm" check-out to EACH selected record's LATEST open session only,
 * on that record's own business day. Non-transactional and per-record — one bad record never
 * aborts the batch (mirrors bulkBackfillAttendance) — and the per-record close mirrors the
 * auto-checkout cron (deriveOffsets → combineFromOffset → 26h bound → overlap → recompute).
 *
 * Body: { attendanceIds: string[], checkOut: "HH:mm", checkOutNextDay?: boolean }
 *  - checkOutNextDay omitted → auto-roll to the next day when the time reads before the
 *    check-in (same rule the cron uses); passed explicitly → it wins (standalone AM tail).
 */
export const bulkCheckout = async (req, res) => {
  try {
    const { attendanceIds = [], checkOut, checkOutNextDay } = req.body;

    if (!Array.isArray(attendanceIds) || attendanceIds.length === 0) {
      return res.status(400).json({ success: false, message: 'attendanceIds must be a non-empty array' });
    }
    if (!checkOut || !/^\d{2}:\d{2}$/.test(checkOut)) {
      return res.status(400).json({ success: false, message: 'A valid check-out time (HH:mm) is required' });
    }

    // Offset resolution — mirrors updateAttendance so toLocalTimeString reads the same
    // wall-clock as the rest of the controller.
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];
    let offsetVal = -330;
    if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
      const parsed = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
      if (!isNaN(parsed)) offsetVal = parsed;
    } else if (timezoneOffset !== null && timezoneOffset !== undefined) {
      const parsed = parseInt(timezoneOffset, 10);
      if (!isNaN(parsed)) offsetVal = parsed;
    }

    const explicitNextDay = typeof checkOutNextDay === 'boolean' ? checkOutNextDay : null;

    const workConfig = await workModel.findOne({ type: 'default' });
    if (!workConfig) {
      return res.status(404).json({ success: false, message: 'Work schedule configuration not found' });
    }

    const uniqueIds = [...new Set(attendanceIds.filter(Boolean).map(String))];

    const records = await Attendance.find({ _id: { $in: uniqueIds } })
      .populate('employee', 'name employeeId');
    const recordById = new Map(records.map((r) => [String(r._id), r]));

    const closed = [];
    const skipped = [];
    const failed = [];

    // Cross-day overlap: one checker per distinct business day, built up front over every
    // employee on that day (a closed session may roll into the next day's record).
    const byDate = new Map(); // dateStr -> { empIds:Set, checker }
    for (const rec of records) {
      const dateStr = new Date(rec.date).toISOString().split('T')[0];
      if (!byDate.has(dateStr)) byDate.set(dateStr, { empIds: new Set(), checker: null });
      byDate.get(dateStr).empIds.add(String(rec.employee?._id || rec.employee));
    }
    await Promise.all(
      [...byDate.entries()].map(async ([dateStr, group]) => {
        const anchor = new Date(dateStr);
        anchor.setUTCHours(0, 0, 0, 0);
        group.checker = await buildCrossDayOverlapChecker({
          employeeIds: [...group.empIds],
          date: anchor,
        });
      })
    );

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

    for (const id of uniqueIds) {
      const record = recordById.get(id);
      if (!record) {
        skipped.push({ attendanceId: id, employeeId: null, name: null, reason: 'Record not found' });
        continue;
      }

      const empId = String(record.employee?._id || record.employee);
      const name = record.employee?.name || null;

      try {
        // Latest open session = checked in, no check-out, max check-in.
        const openSessions = record.sessions.filter((s) => s.checkIn && !s.checkOut);
        if (openSessions.length === 0) {
          skipped.push({ attendanceId: id, employeeId: empId, name, reason: 'No open session to close' });
          continue;
        }
        const session = openSessions.reduce((latest, s) =>
          new Date(s.checkIn).getTime() > new Date(latest.checkIn).getTime() ? s : latest
        );

        const recordDateStr = new Date(record.date).toISOString().split('T')[0];
        const inStr = toLocalTimeString(session.checkIn, offsetVal);

        const outNextDay = explicitNextDay !== null
          ? explicitNextDay
          : deriveOffsets(inStr, checkOut, !!session.checkInNextDay).checkOutNextDay;

        const checkOutDate = combineFromOffset(recordDateStr, checkOut, outNextDay);
        if (!checkOutDate) {
          failed.push({ attendanceId: id, employeeId: empId, name, message: 'Invalid check-out time' });
          continue;
        }

        const workedHours =
          (checkOutDate.getTime() - new Date(session.checkIn).getTime()) / (1000 * 60 * 60);
        if (!(workedHours > 0 && workedHours <= MAX_SHIFT_HOURS)) {
          skipped.push({
            attendanceId: id,
            employeeId: empId,
            name,
            reason:
              workedHours <= 0
                ? 'Check-out is before the check-in — close this one manually'
                : `Check-out would make a ${workedHours.toFixed(1)}h shift (max ${MAX_SHIFT_HOURS}h) — close this one manually`,
          });
          continue;
        }

        // In-record overlap (the closed session vs the record's other sessions).
        const candidate = record.sessions.map((s) =>
          s._id.toString() === session._id.toString()
            ? { checkIn: s.checkIn, checkOut: checkOutDate }
            : { checkIn: s.checkIn, checkOut: s.checkOut }
        );
        if (hasSessionOverlap(candidate)) {
          failed.push({ attendanceId: id, employeeId: empId, name, message: 'Check-out overlaps another session on this day' });
          continue;
        }

        // Cross-day overlap (the closed session vs the neighbouring days' records).
        const checker = byDate.get(recordDateStr)?.checker;
        const conflict = checker
          ? checker(empId, [{ checkIn: session.checkIn, checkOut: checkOutDate }])
          : null;
        if (conflict) {
          failed.push({ attendanceId: id, employeeId: empId, name, message: crossDayOverlapMessage(conflict) });
          continue;
        }

        // Close it — mirror the auto-checkout cron's mutation + totals recompute. The model
        // pre-save hook re-derives rawCheckOut/offsets from the new checkOut Date.
        session.checkOut = checkOutDate;
        session.workedHours = Number(workedHours.toFixed(2));
        if (outNextDay) session.isNightShift = true;

        const rawHours = sumRawHours(record.sessions);
        const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
          rawHours,
          workConfig,
          record.breaksTaken ?? null,
          { isHoliday: record.isHoliday, reason: record.holidayReason }
        );
        record.totalWorkHours = netWorkHours;
        record.status = status;
        record.overtimeHours = overtimeHours;
        record.holidayHours = holidayHours;

        await record.save();

        closed.push({ attendanceId: id, employeeId: empId, name });
        auditRows.push(buildAuditRow(record, auditActor, "bulk_checkout", `Checked out (bulk) at ${checkOut}`));
      } catch (err) {
        console.error('bulkCheckout per-record error:', id, err);
        failed.push({ attendanceId: id, employeeId: empId, name, message: err?.message || 'Failed to close session' });
      }
    }

    await recordAttendanceAuditBatch(auditRows);

    return res.status(200).json({
      success: true,
      message: `Checked out ${closed.length} of ${uniqueIds.length} record(s)`,
      summary: {
        closedCount: closed.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
      },
      closed,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('bulkCheckout error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk check out', error: error.message });
  }
};


const getActiveSitesOverview = async (req, res) => {
  try {
    const { tab = 'inprogress', skip = 0, limit = 5 } = req.query;
    const parsedSkip = parseInt(skip) || 0;
    const parsedLimit = parseInt(limit) || 5;

    // Always return both counts for the tab badges
    const inProgressCount = await Site.countDocuments({ isActive: true, isCompleted: false, isDeleted: false });
    const completedCount = await Site.countDocuments({ isCompleted: true, isDeleted: false });

    let sites;
    let hasMore = false;

    if (tab === 'completed') {
      // Completed sites, sorted by updatedAt desc, paginated
      sites = await Site.find({ isCompleted: true, isDeleted: false })
        .sort({ updatedAt: -1 })
        .skip(parsedSkip)
        .limit(parsedLimit + 1) // fetch one extra to check hasMore
        .lean();
      
      if (sites.length > parsedLimit) {
        hasMore = true;
        sites = sites.slice(0, parsedLimit);
      }
    } else {
      // In-progress: active + incomplete
      sites = await Site.find({ isActive: true, isCompleted: false, isDeleted: false })
        .lean();
    }

    // Staff (white-collar) are excluded from man-hours / man-days stats.
    const staffIds = await getStaffEmployeeIds();

    // For each site, aggregate attendance metrics and get jobs
    const enrichedSites = await Promise.all(sites.map(async (site) => {
      const siteIdStr = site._id.toString();

      // Get attendance records with sessions for this site
      const records = await Attendance.find({
        'sessions.siteId': site._id,
        employee: { $nin: staffIds },
      }).lean();

      let totalManHours = 0;
      let totalManDays = 0;
      const calendarDays = new Set();

      for (const record of records) {
        const day = new Date(record.date).toISOString().split('T')[0];
        let workedOnSite = false;

        // Man-hours net of the day's unpaid break, shared pro-rata by raw hours.
        const netFactor = recordNetFactor(record);

        for (const session of record.sessions) {
          if (session.siteId?.toString() !== siteIdStr) continue;
          totalManHours += (session.workedHours || 0) * netFactor;
          workedOnSite = true;
        }

        if (workedOnSite) {
          totalManDays += 1;
          calendarDays.add(day);
        }
      }

      // Get jobs for this site (non-deleted only)
      const jobs = await Job.find({ site: site._id, isDeleted: false })
        .select('_id name isCompleted isActive')
        .lean();

      return {
        siteId: site._id,
        siteName: site.siteName,
        locationDetails: site.locationDetails || '',
        isPermanent: site.isPermanent || false,
        totalManHours: Number(totalManHours.toFixed(2)),
        totalManDays,
        totalCalendarDays: calendarDays.size,
        jobs,
      };
    }));

    return res.status(200).json({
      success: true,
      inProgressCount,
      completedCount,
      sites: enrichedSites,
      hasMore,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


// --- NIGHT SHIFT BULK ASSIGNMENT ---

// GET /api/attendance/night-shift/candidates?siteId=&date=&showOnlyEmpty=true&name=&employeeId=&jobTitle=
export const getNightShiftCandidates = async (req, res) => {
  try {
    const {
      siteId,
      date,
      showOnlyEmpty = "true",
      name,
      employeeId,
      jobTitle,
    } = req.query;

    if (!siteId || !date) {
      return res.status(400).json({
        success: false,
        message: "siteId and date are required",
      });
    }

    const onlyEmpty = showOnlyEmpty === "true" || showOnlyEmpty === true;

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // 1. Active employees assigned to this site
    const empFilter = { isActive: true, currentSite: siteId };

    if (name) empFilter.name = { $regex: escapeRegExp(name), $options: "i" };
    if (employeeId) empFilter.employeeId = { $regex: escapeRegExp(employeeId), $options: "i" };
    if (jobTitle) empFilter.jobTitle = { $regex: escapeRegExp(jobTitle), $options: "i" };

    const employees = await Employee.find(
      empFilter,
      "_id name employeeId jobTitle currentSite currentJob collarType nationality"
    )
      .populate("currentJob", "name")
      .sort({ name: 1 })
      .lean();

    // 2. Existing attendance records for these employees on the date
    const empIds = employees.map((e) => e._id);

    const records = await Attendance.find({
      date: attendanceDate,
      employee: { $in: empIds },
    }).lean();

    const recordByEmp = new Map();
    for (const rec of records) {
      recordByEmp.set(rec.employee.toString(), rec);
    }

    const siteIdStr = siteId.toString();

    // 3. Filter
    const candidates = employees.filter((emp) => {
      const rec = recordByEmp.get(emp._id.toString());

      const siteSessions = rec
        ? (rec.sessions || []).filter(
            (s) => s.siteId && s.siteId.toString() === siteIdStr
          )
        : [];

      // Exclude employees who don't have at least one session at this site
      if (siteSessions.length === 0) {
        return false;
      }

      // Exclude employees who already have a night shift session for this site/date
      if (siteSessions.some((s) => s.isNightShift === true)) {
        return false;
      }

      if (onlyEmpty) {
        // Has at least one session at this site that is empty or check-in-only (eligible for conversion)
        return siteSessions.some(
          (s) => (!s.checkIn && !s.checkOut) || (s.checkIn && !s.checkOut)
        );
      }

      // showOnlyEmpty = false → every other active employee (minus night-shift ones)
      return true;
    });

    return res.status(200).json({
      success: true,
      total: candidates.length,
      data: candidates,
    });
  } catch (error) {
    console.error("getNightShiftCandidates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch night shift candidates",
    });
  }
};

// POST /api/attendance/night-shift/assign
// Body: { siteId, date, employeeIds: [string] }
export const assignNightShift = async (req, res) => {
  const { siteId, date, employeeIds } = req.body;
  const markedBy = req.user?.id;
  const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
    ? process.env.APP_TIMEZONE_OFFSET
    : req.headers["x-timezone-offset"];

  if (
    !siteId ||
    !date ||
    !Array.isArray(employeeIds) ||
    employeeIds.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: "siteId, date and employeeIds are required",
    });
  }

  const attendanceDate = new Date(date);
  attendanceDate.setUTCHours(0, 0, 0, 0);

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const workConfig = await workModel.findOne().session(dbSession);

    const fullDayHours = workConfig?.fullDayHours ?? 8;
    const halfDayHours = workConfig?.halfDayHours ?? 4;
    const overtimeThreshold = workConfig?.overtimeThreshold ?? 8;

    // The night check-in is pre-filled at assignment time from the site's night
    // default (staff use their own staff-night default), replacing the old
    // auto-check-in cron.
    const siteDoc = await Site.findById(siteId)
      .select("nightDefaultCheckIn staffNightDefaultCheckIn")
      .session(dbSession);

    let processedCount = 0;

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];
    const nightOnPool = await isDriverPool(siteId, dbSession);

    for (const empId of employeeIds) {
      const emp = await Employee.findById(empId)
        .select("currentSite currentJob collarType jobTitle")
        .session(dbSession);

      // Drivers live only on the Drivers sheet — never given a night shift at a real site.
      if (!nightOnPool && isDriverTitle(emp?.jobTitle)) continue;

      // Collar-aware, NO fallback: staff use only the staff night default.
      const isStaff = emp?.collarType === "staff";
      const nightDefaultIn = isStaff
        ? (siteDoc?.staffNightDefaultCheckIn || "")
        : (siteDoc?.nightDefaultCheckIn || "");

      // Date object for the pre-filled check-in, or null if no default configured.
      // Cutoff-free: a night check-in default is an evening time, so it belongs to the
      // record's own business day (offset 0). No cutoff resolution.
      const prefillCheckIn = nightDefaultIn
        ? combineFromOffset(date, nightDefaultIn, false)
        : null;

      let attendanceDoc = await Attendance.findOne({
        employee: empId,
        date: attendanceDate,
      }).session(dbSession);

      const nightSession = {
        siteId,
        jobId: null,
        checkIn: prefillCheckIn,
        checkOut: null,
        workedHours: 0,
        markedBy,
        isNightShift: true,
      };

      if (!attendanceDoc) {
        // Case A: no record for the date → create one with a single night session
        if (
          emp?.currentJob &&
          emp.currentSite?.toString() === siteId.toString()
        ) {
          nightSession.jobId = emp.currentJob;
        }

        attendanceDoc = new Attendance({
          employee: empId,
          date: attendanceDate,
          siteId,
          jobId: nightSession.jobId,
          markedBy,
          status: "absent",
          sessions: [nightSession],
        });
      } else {
        const siteSessions = attendanceDoc.sessions.filter(
          (s) => s.siteId.toString() === siteId.toString()
        );

        // Idempotent: skip if a night shift already exists for this site
        if (siteSessions.some((s) => s.isNightShift)) {
          processedCount++;
          continue;
        }

        // Try to find an empty session for this site first
        const emptySiteSession = siteSessions.find(
          (s) => !s.checkIn && !s.checkOut
        );

        if (emptySiteSession) {
          // Case B: reuse an existing empty/absent session for this site
          emptySiteSession.isNightShift = true;
          emptySiteSession.checkIn = prefillCheckIn;
          emptySiteSession.markedBy = emptySiteSession.markedBy || markedBy;
        } else {
          // Try to find an active session (check-in only, empty check-out) for this site
          const activeSiteSession = siteSessions.find(
            (s) => s.checkIn && !s.checkOut
          );

          if (activeSiteSession) {
            // Case C: Convert check-in only session into a night shift, replacing
            // the day check-in with the night default check-in.
            activeSiteSession.checkIn = prefillCheckIn;
            activeSiteSession.checkOut = null;
            activeSiteSession.workedHours = 0;
            activeSiteSession.isNightShift = true;
            activeSiteSession.markedBy = activeSiteSession.markedBy || markedBy;
          } else {
            // Case D: All sessions are completed → push a new night session
            if (siteSessions.length > 0 && siteSessions[0].jobId) {
              nightSession.jobId = siteSessions[0].jobId;
            }
            // Drivers: the night session serves the same site + job split.
            if (siteSessions.length > 0 && siteSessions[0].splitJobIds?.length) {
              nightSession.servedSiteId = siteSessions[0].servedSiteId ?? null;
              nightSession.splitJobIds = [...siteSessions[0].splitJobIds];
            }
            attendanceDoc.sessions.push(nightSession);
          }
        }
      }

      // Safety: if the pre-filled check-in would overlap another session on this
      // record, clear it back to empty rather than persist an overlap.
      if (prefillCheckIn && hasSessionOverlap(
        attendanceDoc.sessions.map((s) => ({ checkIn: s.checkIn, checkOut: s.checkOut }))
      )) {
        const ns = attendanceDoc.sessions.find(
          (s) =>
            s.siteId.toString() === siteId.toString() &&
            s.isNightShift &&
            s.checkIn &&
            new Date(s.checkIn).getTime() === prefillCheckIn.getTime()
        );
        if (ns) ns.checkIn = null;
      }

      // Recalculate totals
      const rawHours = sumRawHours(attendanceDoc.sessions);

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        attendanceDoc.breaksTaken ?? null,
        { isHoliday: attendanceDoc.isHoliday, reason: attendanceDoc.holidayReason }
      );

      attendanceDoc.totalWorkHours = netWorkHours;
      attendanceDoc.status = status;
      attendanceDoc.overtimeHours = overtimeHours;
      attendanceDoc.holidayHours = holidayHours;


      // Document-level night shift detection
      const crossed = detectCrossedMidnight(
        attendanceDoc.sessions,
        timezoneOffset
      );
      attendanceDoc.crossedMidnight = crossed;
      attendanceDoc.shiftType = crossed ? "night" : "day";
      attendanceDoc.markedBy = attendanceDoc.markedBy || markedBy;

      await attendanceDoc.save({ session: dbSession });
      processedCount++;

      // The night default check-in is auto-filled by the server on assignment (prefillCheckIn),
      // so — unlike the day submit — we know for certain it was auto-initialized. rawCheckIn is
      // populated by the pre-save hook above; it's null only when the overlap safety cleared it.
      const assignedNight = attendanceDoc.sessions.find(
        (s) => s.siteId.toString() === siteId.toString() && s.isNightShift
      );
      const nightSummary = assignedNight?.rawCheckIn
        ? `Night shift assigned with an auto-initialized check-in of ${assignedNight.rawCheckIn}`
        : "Night shift assigned";
      auditRows.push(buildAuditRow(attendanceDoc, auditActor, "night_shift_assigned", nightSummary));
    }

    // Audit log joins the same transaction (best-effort inside the helper).
    await recordAttendanceAuditBatch(auditRows, dbSession);

    await dbSession.commitTransaction();
    dbSession.endSession();

    return res.status(200).json({
      success: true,
      message: `Assigned night shift to ${processedCount} employee(s)`,
      recordsProcessed: processedCount,
    });
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    console.error("assignNightShift error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to assign night shift",
    });
  }
};


// --- CROSS-SITE VISIBILITY (read-only) ---
// Return an employee's attendance sessions for a single business day across ALL sites.
// Used by the instant Add-Employee modal so a supervisor can SEE that the employee is
// already recorded at another site today — a legitimate multi-site day, or a mistake to
// fix out-of-band. Read-only: no writes, no locks, no overlap enforcement (the submit
// path keeps its own guards). Intentionally NOT behind requireSiteAccess — the whole
// point is to reveal OTHER sites' sessions; it exposes only site name + times.
const getEmployeeDaySessions = async (req, res) => {
  try {
    const { employeeId, excludeSiteId, date } = req.query

    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        message: "A valid employeeId is required",
      })
    }

    // Default to today's local business day; match the stored UTC-midnight date the
    // same way getSiteAttendance does.
    const dayStr = date || getDateLocal(0)
    const queryDate = new Date(dayStr)
    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    const record = await Attendance.findOne({
      employee: employeeId,
      date: { $gte: start, $lte: end },
    })
      .select("sessions.siteId sessions.checkIn sessions.checkOut sessions.rawCheckIn sessions.rawCheckOut")
      .populate({ path: "sessions.siteId", select: "siteName" })

    const excludeId =
      excludeSiteId && mongoose.Types.ObjectId.isValid(excludeSiteId)
        ? excludeSiteId.toString()
        : null

    const sessions = (record?.sessions || [])
      // Only real presences (must have a check-in) and, when asked, other sites only.
      .filter((s) => {
        if (!s.siteId || !s.checkIn) return false
        const sid = (s.siteId._id || s.siteId).toString()
        return excludeId ? sid !== excludeId : true
      })
      .map((s) => ({
        siteId: (s.siteId._id || s.siteId).toString(),
        siteName: s.siteId?.siteName || "Unknown site",
        checkIn: s.checkIn || null,
        checkOut: s.checkOut || null,
        rawCheckIn: s.rawCheckIn || null,
        rawCheckOut: s.rawCheckOut || null,
        isOpen: !s.checkOut,
      }))
      .sort(
        (a, b) => new Date(a.checkIn || 0).getTime() - new Date(b.checkIn || 0).getTime()
      )

    return res.status(200).json({
      success: true,
      message: "Employee day sessions fetched",
      data: { sessions },
    })
  } catch (error) {
    console.error("getEmployeeDaySessions error:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch employee day sessions",
    })
  }
}


// --- ATTENDANCE RECORD EDIT-LOG (read) + SUPERVISOR REMARK (write) ---

// Shared authorization for the per-record history/remark endpoints: admins/superadmins
// reach any record; a supervisor reaches only records at their assignedSite (the record's
// primary site OR any session's site — a multi-site record can carry their site's session).
// Mirrors the supervisor same-site check in updateAttendance. requireSiteAccess can't gate
// these routes because the param is an attendance id, not a site id.
const authorizeRecordAccess = async (attendanceId, reqUser) => {
  const record = await Attendance.findById(attendanceId);
  if (!record) return { ok: false, status: 404, message: "Attendance record not found" };
  if (isSiteScopedRole(reqUser.role)) {
    const user = await userModel.findById(reqUser.id).select("assignedSite");
    const assigned = user?.assignedSite?.toString();
    const sitesOnRecord = new Set(
      [record.siteId?.toString(), ...record.sessions.map((s) => s.siteId?.toString())].filter(Boolean)
    );
    if (!assigned || !sitesOnRecord.has(assigned)) {
      return { ok: false, status: 403, message: "Forbidden: Access denied to this attendance record" };
    }
  }
  return { ok: true, record };
};

// GET /api/attendance/:attendanceId/history — the on-demand popover fetch. Returns the
// current remark + the reverse-chronological edit log in one payload.
export const getAttendanceHistory = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const auth = await authorizeRecordAccess(attendanceId, req.user);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

    const entries = await attendanceAuditModel
      .find({ attendance: attendanceId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("actorName type summary createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      data: { remark: auth.record.remark || "", entries },
    });
  } catch (error) {
    console.error("getAttendanceHistory error:", error);
    return res.status(500).json({ success: false, message: "Failed to load attendance history" });
  }
};

// PATCH /api/attendance/:attendanceId/remark — set/overwrite the single supervisor remark.
// Uses updateOne so the model pre-save hook (session offset re-derivation) is not re-run
// for a note-only change; the change is captured in the audit log so remark history survives.
export const updateAttendanceRemark = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { remark = "" } = req.body;

    if (typeof remark !== "string" || remark.length > 500) {
      return res.status(400).json({ success: false, message: "Remark must be text up to 500 characters" });
    }

    const auth = await authorizeRecordAccess(attendanceId, req.user);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

    const trimmed = remark.trim();
    // timestamps:false — updatedAt is the version token the time/break editors check
    // (updateAttendance → expectedUpdatedAt). Those editors never write the remark, so a
    // remark change can't be clobbered by them and must not trip a false "changed elsewhere".
    await Attendance.updateOne({ _id: attendanceId }, { $set: { remark: trimmed } }, { timestamps: false });
    auth.record.remark = trimmed;

    await recordAttendanceAudit({
      attendance: auth.record,
      actor: await resolveActor(req),
      type: "remark_updated",
      summary: trimmed ? `Remark updated: "${trimmed}"` : "Remark cleared",
    });

    return res.status(200).json({ success: true, data: { remark: trimmed } });
  } catch (error) {
    console.error("updateAttendanceRemark error:", error);
    return res.status(500).json({ success: false, message: "Failed to update remark" });
  }
};


// --- DEFAULT EXPORT ---

// ===========================================================================
// LEAVE endpoints — leave APPLICATIONS: annual PAID leave and (unpaid, excused)
// EMERGENCY leave. Both are granted over a range through the same endpoints
// (`type`), share the Leave ledger and the working-day/lock rules; only annual
// leave is capped — by the employee's date-range allocations
// (controllers/leaveAllocationController.js, utils/leaveBalance.js).
// ===========================================================================

// The grant/preview `type`: "annual" when omitted, null when unrecognised.
function parseLeaveType(value) {
  if (value === undefined || value === null || value === "") return "annual";
  return Object.prototype.hasOwnProperty.call(LEAVE_FLAG, value) ? value : null;
}

// Validate a from/to pair → { fromDay, toDay } or { error }.
function parseLeaveRange(from, to) {
  if (!from || !to) return { error: "from and to are required" };
  const fromDay = normalizeUtcDay(from);
  const toDay = normalizeUtcDay(to);
  if (!fromDay || !toDay) return { error: "Invalid from/to date" };
  if (fromDay.getTime() > toDay.getTime()) return { error: "'from' must be on or before 'to'" };
  if (eachUtcDay(fromDay, toDay).length > MAX_LEAVE_RANGE_DAYS) {
    return { error: `Range too large (max ${MAX_LEAVE_RANGE_DAYS} days)` };
  }
  return { fromDay, toDay };
}

// The 400 for annual days that don't fit the employee's allocations.
function annualBalanceError(check) {
  const unallocated = check.unallocatedDays.length;
  return new LeaveHttpError(400, {
    message: unallocated
      ? `No annual leave allocation covers ${unallocated} of these day(s). Allocate leave for that period first.`
      : "Requested leave exceeds the available balance",
    data: { violations: check.violations, unallocatedDays: check.unallocatedDays },
  });
}

// IN-TRANSACTION: mark the working days of [fromDay, toDay] as `type` leave for an
// employee (classify → annual allocation check → flag/create records). Returns the
// classification; throws LeaveHttpError on a validation failure. Every operation is
// SEQUENTIAL — never Promise.all on a transaction session.
async function applyLeaveDays(session, { employeeId, type, fromDay, toDay, markedBy }) {
  const employee = await empModel.findById(employeeId).session(session);
  if (!employee) {
    throw new LeaveHttpError(404, { message: "Employee not found" });
  }
  const workConfig = await workModel.findOne({ type: "default" }).session(session);

  // Attendance requires a siteId. Use the employee's current site, falling back
  // to the auto-created permanent site so leave works for anyone not on a site.
  let siteId = employee.currentSite;
  // Drivers' leave sits on the drivers pool, so it shows on the Drivers sheet.
  if (!siteId && isDriverEmployee(employee)) {
    siteId = await getDriverPoolId(session);
  }
  if (!siteId) {
    const permanentSite = await siteModel.findOne({ isPermanent: true }).select("_id").session(session);
    siteId = permanentSite?._id || null;
  }
  if (!siteId) {
    throw new LeaveHttpError(400, { message: "No site available to attach leave to" });
  }

  const classified = await classifyLeaveRange({
    employeeId,
    from: fromDay,
    to: toDay,
    workConfig,
    session,
  });
  const { toMark, holidayDays, conflictDays, alreadyLeave, recordByKey } = classified;

  if (toMark.length === 0) {
    throw new LeaveHttpError(400, {
      message: "No working days to grant in this range",
      data: {
        holidayDays: holidayDays.length,
        conflictDays: conflictDays.map(utcDayKey),
        alreadyLeaveDays: alreadyLeave.map(utcDayKey),
      },
    });
  }

  // Only annual (paid) leave draws on allocations.
  if (type === "annual") {
    const check = await checkAnnualAgainstAllocations({ employeeId, toMark, session });
    if (!check.ok) throw annualBalanceError(check);
  }

  for (const day of toMark) {
    const existing = recordByKey.get(day.key);
    if (existing) {
      existing.isPaidLeave = type === "annual";
      existing.isEmergencyLeave = type === "emergency";
      existing.isSickLeave = false;
      // A granted leave supersedes a prior LOP day — clear the flag and its
      // auto-remark (the pre-save hook clears the flag, but not the "Deduct … OMR" note).
      existing.isLop = false;
      applyLopRemark(existing, false, workConfig?.lopDeductionAmount);
      existing.status = "absent";
      await existing.save({ session });
    } else {
      await Attendance.create(
        [
          {
            employee: employeeId,
            siteId,
            jobId: employee.currentJob || null,
            markedBy,
            date: day.date,
            status: "absent",
            isPaidLeave: type === "annual",
            isEmergencyLeave: type === "emergency",
            isSickLeave: false,
            totalWorkHours: 0,
            overtimeHours: 0,
            sessions: [],
          },
        ],
        { session }
      );
    }
  }

  return classified;
}

// IN-TRANSACTION: put every day a leave marked back the way it was before the grant —
// a record the grant created is deleted, a converted absent record just loses the flag.
async function revertLeaveDays(session, leave) {
  // The flag this grant set (legacy grants without a stored type are annual).
  const flag = LEAVE_FLAG[leave.type] || LEAVE_FLAG.annual;

  for (const day of leave.days) {
    const record = await Attendance.findOne({
      employee: leave.employee,
      date: normalizeUtcDay(day.date),
    }).session(session);
    if (!record) continue;

    const hasFilledSession = Array.isArray(record.sessions)
      ? record.sessions.some((s) => s && (s.checkIn || s.checkOut))
      : false;

    if (day.created && record[flag] && !hasFilledSession) {
      await record.deleteOne({ session });
    } else if (record[flag]) {
      record[flag] = false;
      await record.save({ session });
    }
  }
}

// Ensure the Leave collection exists BEFORE opening a transaction. Inserting the
// first-ever document into a not-yet-created collection *inside* a multi-document
// transaction throws "Cannot create namespace ... in multi-document transaction".
// createCollection is idempotent — a no-op once the collection exists.
async function ensureLeaveCollection() {
  try {
    await Leave.createCollection();
  } catch {
    /* collection already exists */
  }
}

const skippedSummary = ({ holidayDays, conflictDays, alreadyLeave }) => ({
  holidays: holidayDays.length,
  conflicts: conflictDays.map(utcDayKey),
  alreadyLeave: alreadyLeave.map(utcDayKey),
});

// GET /api/attendance/leave/balance/:employeeId?year=
// The employee's annual leave allocations (each with used/remaining), the one
// covering today as `current`, and the emergency days taken in `year` (default: this year).
export const getLeaveBalance = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const year = Number(req.query.year) || currentLocalYear();

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee id" });
    }

    const employee = await empModel.findById(employeeId).select("_id").lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const { allocations, current } = await allocationSummaries(employeeId, { todayKey: getTodayLocal() });
    // Emergency leave has no allowance — this is informational only.
    const emergencyUsed = await emergencyDaysInYear(employeeId, year);

    return res.status(200).json({
      success: true,
      data: { year, allocations, current, emergencyUsed },
    });
  } catch (error) {
    console.error("getLeaveBalance error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave balance" });
  }
};

// GET /api/attendance/leave/preview?employeeId=&from=&to=&type=annual|emergency&excludeLeaveId=
// Read-only: how many working days a range would mark, what would be skipped, and
// (annual only) whether the allocations cover it. Drives the application dialog's
// live feedback. `excludeLeaveId` = the leave being edited: its own days count as free.
export const previewLeave = async (req, res) => {
  try {
    const { employeeId, from, to, excludeLeaveId } = req.query;
    const type = parseLeaveType(req.query.type);

    if (!type) {
      return res.status(400).json({ success: false, message: "Invalid leave type" });
    }
    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "A valid employeeId is required" });
    }
    const range = parseLeaveRange(from, to);
    if (range.error) {
      return res.status(400).json({ success: false, message: range.error });
    }
    const { fromDay, toDay } = range;

    let ignoreDates = null;
    if (excludeLeaveId) {
      if (!mongoose.Types.ObjectId.isValid(excludeLeaveId)) {
        return res.status(400).json({ success: false, message: "Invalid leave id" });
      }
      const editing = await Leave.findById(excludeLeaveId).lean();
      if (!editing || String(editing.employee) !== String(employeeId)) {
        return res.status(400).json({ success: false, message: "Leave not found for this employee" });
      }
      if (editing.status === "active") {
        ignoreDates = new Set((editing.days || []).map((d) => utcDayKey(d.date)));
      }
    }

    const [employee, workConfig] = await Promise.all([
      empModel.findById(employeeId).select("_id").lean(),
      workModel.findOne({ type: "default" }),
    ]);
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const { toMark, holidayDays, conflictDays, alreadyLeave } = await classifyLeaveRange({
      employeeId,
      from: fromDay,
      to: toDay,
      workConfig,
      ignoreDates,
    });

    const base = {
      type,
      workingDays: toMark.length,
      holidayDays: holidayDays.length,
      conflictDays: conflictDays.map(utcDayKey),
      alreadyLeaveDays: alreadyLeave.map(utcDayKey),
    };

    if (type === "emergency") {
      // No cap — emergency leave is unpaid. Report the days already taken in each
      // touched year for context.
      const years = [...new Set(eachUtcDay(fromDay, toDay).map((d) => d.getUTCFullYear()))];
      const usedByYear = {};
      for (const y of years) {
        usedByYear[y] = await emergencyDaysInYear(employeeId, y, ignoreDates);
      }
      return res.status(200).json({
        success: true,
        data: { ...base, usedByYear, allocations: [], unallocatedDays: [], violations: [], wouldExceed: false },
      });
    }

    const check = await checkAnnualAgainstAllocations({ employeeId, toMark, ignoreDates });

    return res.status(200).json({
      success: true,
      data: {
        ...base,
        // The allocations this range draws on, with their usage BEFORE this application.
        allocations: check.allocations,
        unallocatedDays: check.unallocatedDays,
        violations: check.violations,
        wouldExceed: !check.ok,
      },
    });
  } catch (error) {
    console.error("previewLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to preview leave" });
  }
};

// POST /api/attendance/leave  { employeeId, from, to, note, type?: "annual" | "emergency" }
export const grantLeave = async (req, res) => {
  const { employeeId, from, to, note = "" } = req.body || {};
  const type = parseLeaveType(req.body?.type);

  if (!type) {
    return res.status(400).json({ success: false, message: "Invalid leave type" });
  }
  if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
    return res.status(400).json({ success: false, message: "A valid employeeId is required" });
  }
  const range = parseLeaveRange(from, to);
  if (range.error) {
    return res.status(400).json({ success: false, message: range.error });
  }
  const { fromDay, toDay } = range;

  await ensureLeaveCollection();

  const markedBy = req.user?.id || null;
  let result = null;

  const session = await mongoose.startSession();
  try {
    // withTransaction re-runs this callback on a TransientTransactionError (e.g. a
    // WriteConflict with a concurrent submit or the auto-check-in cron touching the
    // same record, or a failover) and retries an uncertain commit, instead of failing
    // the request. Every operation below runs SEQUENTIALLY: parallel operations on a
    // transaction's session are unsupported by the driver and were why grants used to
    // fail intermittently and succeed on retry (NoSuchTransaction when the command
    // carrying startTransaction lost the race to the server).
    await session.withTransaction(async () => {
      result = null;

      const applied = await applyLeaveDays(session, { employeeId, type, fromDay, toDay, markedBy });

      const [leave] = await Leave.create(
        [
          {
            employee: employeeId,
            type,
            grantedBy: markedBy,
            fromDate: fromDay,
            toDate: toDay,
            note: String(note || "").slice(0, 500),
            workingDays: applied.toMark.length,
            days: applied.toMark.map((d) => ({ date: d.date, created: d.created })),
            status: "active",
          },
        ],
        { session }
      );

      result = { leave, granted: applied.toMark.length, skipped: skippedSummary(applied) };
    });
  } catch (error) {
    if (error instanceof LeaveHttpError) {
      return res.status(error.status).json(error.body);
    }
    // A concurrent write created one of these days' records between our read and
    // insert (unique {employee, date}). Nothing was written — safe to try again.
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Attendance for one of these days changed while granting leave. Please try again.",
      });
    }
    console.error("grantLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to grant leave" });
  } finally {
    await session.endSession();
  }

  return res.status(201).json({
    success: true,
    message: `Granted ${result.granted} day(s) of ${LEAVE_LABEL[type]}`,
    data: { leave: result.leave, type, granted: result.granted, skipped: result.skipped },
  });
};

// PUT /api/attendance/leave/:leaveId  { from, to, type, note }
// Edit an ACTIVE leave application in place (the employee is fixed). One transaction
// reverts the days it marked and re-applies the new range/type, so the balance check
// sees the application's own days as free and a failed check leaves it untouched.
export const updateLeave = async (req, res) => {
  const { leaveId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(leaveId)) {
    return res.status(400).json({ success: false, message: "Invalid leave id" });
  }
  const type = parseLeaveType(req.body?.type);
  if (!type) {
    return res.status(400).json({ success: false, message: "Invalid leave type" });
  }
  const range = parseLeaveRange(req.body?.from, req.body?.to);
  if (range.error) {
    return res.status(400).json({ success: false, message: range.error });
  }
  const { fromDay, toDay } = range;
  const note = req.body?.note;

  const markedBy = req.user?.id || null;
  let result = null;

  const session = await mongoose.startSession();
  try {
    // Same transaction discipline as grantLeave: sequential operations, transient
    // errors retried by withTransaction.
    await session.withTransaction(async () => {
      result = null;

      const leave = await Leave.findById(leaveId).session(session);
      if (!leave) {
        throw new LeaveHttpError(404, { message: "Leave not found" });
      }
      if (leave.status === "cancelled") {
        throw new LeaveHttpError(400, { message: "A cancelled leave can't be edited" });
      }

      await revertLeaveDays(session, leave);
      const applied = await applyLeaveDays(session, {
        employeeId: leave.employee,
        type,
        fromDay,
        toDay,
        markedBy,
      });

      leave.type = type;
      leave.fromDate = fromDay;
      leave.toDate = toDay;
      if (note !== undefined) leave.note = String(note || "").slice(0, 500);
      leave.workingDays = applied.toMark.length;
      leave.days = applied.toMark.map((d) => ({ date: d.date, created: d.created }));
      leave.updatedBy = markedBy;
      await leave.save({ session });

      result = { leave, granted: applied.toMark.length, skipped: skippedSummary(applied) };
    });
  } catch (error) {
    if (error instanceof LeaveHttpError) {
      return res.status(error.status).json(error.body);
    }
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Attendance for one of these days changed while saving the leave. Please try again.",
      });
    }
    console.error("updateLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to update leave" });
  } finally {
    await session.endSession();
  }

  return res.status(200).json({
    success: true,
    message: `Leave updated — ${result.granted} day(s) of ${LEAVE_LABEL[type]}`,
    data: { leave: result.leave, type, granted: result.granted, skipped: result.skipped },
  });
};

// PATCH /api/attendance/leave/:leaveId/cancel
export const cancelLeave = async (req, res) => {
  const { leaveId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(leaveId)) {
    return res.status(400).json({ success: false, message: "Invalid leave id" });
  }

  let leave = null;
  const session = await mongoose.startSession();
  try {
    // Same transaction discipline as grantLeave: sequential operations, transient
    // errors retried by withTransaction.
    await session.withTransaction(async () => {
      leave = await Leave.findById(leaveId).session(session);
      if (!leave) {
        throw new LeaveHttpError(404, { message: "Leave not found" });
      }
      if (leave.status === "cancelled") {
        throw new LeaveHttpError(400, { message: "Leave is already cancelled" });
      }

      await revertLeaveDays(session, leave);

      leave.status = "cancelled";
      leave.cancelledBy = req.user?.id || null;
      leave.cancelledAt = new Date();
      await leave.save({ session });
    });
  } catch (error) {
    if (error instanceof LeaveHttpError) {
      return res.status(error.status).json(error.body);
    }
    console.error("cancelLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to cancel leave" });
  } finally {
    await session.endSession();
  }

  return res.status(200).json({ success: true, message: "Leave cancelled", data: { leave } });
};

// DELETE /api/attendance/leave/:leaveId — only a CANCELLED application. Its days were
// already put back by revertLeaveDays on cancel and nothing references a Leave by id,
// so this just drops the ledger entry.
export const deleteLeave = async (req, res) => {
  const { leaveId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(leaveId)) {
    return res.status(400).json({ success: false, message: "Invalid leave id" });
  }
  try {
    const leave = await Leave.findById(leaveId).select("status").lean();
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave not found" });
    }
    // Status in the filter too, so a concurrent un-cancel can't slip through.
    const { deletedCount } = await Leave.deleteOne({ _id: leaveId, status: "cancelled" });
    if (leave.status !== "cancelled" || deletedCount === 0) {
      return res.status(409).json({
        success: false,
        message: "Only a cancelled leave can be deleted. Cancel it first.",
      });
    }
    return res.status(200).json({ success: true, message: "Leave application deleted" });
  } catch (error) {
    console.error("deleteLeave error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete leave" });
  }
};

// Lean reads skip schema defaults — grants made before emergency leave existed have
// no stored type and are annual.
const withLeaveType = (leave) => ({ ...leave, type: leave.type || "annual" });

// GET /api/attendance/leave?type=&status=&search=&page=&limit=
// Every leave application, newest first — the Leave page's Applications tab.
export const listLeaves = async (req, res) => {
  try {
    const { type, status, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter = {};
    // `$in: [..., null]` also matches legacy grants with no stored type (= annual).
    if (type === "annual") filter.type = { $in: ["annual", null] };
    else if (type === "emergency") filter.type = "emergency";
    if (status === "active" || status === "cancelled") filter.status = status;

    const employeeIds = await matchEmployeeIds(search);
    if (employeeIds) filter.employee = { $in: employeeIds };

    const [total, leaves] = await Promise.all([
      Leave.countDocuments(filter),
      Leave.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("-days")
        .populate("employee", "name employeeId companyId jobTitle")
        .populate("grantedBy", "name")
        .populate("updatedBy", "name")
        .populate("cancelledBy", "name")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        leaves: leaves.map(withLeaveType),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("listLeaves error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave applications" });
  }
};

// GET /api/attendance/leave/employee/:employeeId
export const listEmployeeLeaves = async (req, res) => {
  try {
    const { employeeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({ success: false, message: "Invalid employee id" });
    }

    const leaves = await Leave.find({ employee: employeeId })
      .sort({ createdAt: -1 })
      .select("-days")
      .populate("grantedBy", "name")
      .populate("updatedBy", "name")
      .populate("cancelledBy", "name")
      .lean();

    return res.status(200).json({ success: true, data: leaves.map(withLeaveType) });
  } catch (error) {
    console.error("listEmployeeLeaves error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leaves" });
  }
};

// GET /api/attendance/leave/on-date?date=YYYY-MM-DD
// Lightweight: the employees with a granted leave day (annual OR emergency) on a date.
// Supervisor-accessible (read-only) so the Site Attendance page can lock those rows.
// `employeeIds` is the union (what older clients read to exclude rows); `leaves`
// adds each one's type for display. utils/draftRoster.js applies the same filter.
export const getEmployeesOnLeaveForDate = async (req, res) => {
  try {
    const { date } = req.query;
    const day = normalizeUtcDay(date);
    if (!day) {
      return res.status(400).json({ success: false, message: "A valid date is required" });
    }
    const start = new Date(day);
    const end = new Date(new Date(day).setUTCHours(23, 59, 59, 999));

    const records = await Attendance.find(
      { ...grantedLeaveFilter(), date: { $gte: start, $lte: end } },
      "employee isPaidLeave isEmergencyLeave"
    ).lean();

    const typeById = new Map();
    for (const r of records) {
      typeById.set(String(r.employee), r.isPaidLeave ? "annual" : "emergency");
    }

    return res.status(200).json({
      success: true,
      data: {
        employeeIds: [...typeById.keys()],
        leaves: [...typeById].map(([employeeId, type]) => ({ employeeId, type })),
      },
    });
  } catch (error) {
    console.error("getEmployeesOnLeaveForDate error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch leave days" });
  }
};

// POST /api/attendance/reports/erpnext/:month/:year  { type, employeeIds? }
// GET  /api/attendance/employee/:employeeId/erpnext/:month/:year?type=
// Streams one ERPNext Data Import CSV (type attendance|timesheet) for the month. The app
// holds no rates, so every file carries hours + status only; ERPNext supplies rates from
// its own masters. See utils/erpnextExport.js for the row shapes and the pro-rata break
// handling.
export const exportErpnext = async (req, res) => {
  try {
    const { month, year } = req.params;
    const type = String(req.body?.type || req.query.type || "attendance").toLowerCase();

    const monthNum = Number(month);
    const yearNum = Number(year);
    if (isNaN(monthNum) || isNaN(yearNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ success: false, message: "Invalid month or year" });
    }

    // UTC month bounds — Attendance.date is the business day at UTC midnight (same as the
    // monthly report). Server-local dates would shift the month a day on a host west of UTC.
    const startDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
    const endDate = new Date(Date.UTC(yearNum, monthNum, 1));

    // Optional employee scope, as Mongo _ids: one employee (the per-employee route or
    // ?employeeId=, from the employee detail page) or a list in the body (`employeeIds`,
    // the employees picked on the Reports page). Absent → whole roster.
    const empId = req.params.employeeId || req.query.employeeId;
    const employeeIds = req.body?.employeeIds;
    const filter = { date: { $gte: startDate, $lt: endDate } };
    if (empId) {
      if (!mongoose.isValidObjectId(empId)) {
        return res.status(400).json({ success: false, message: "Invalid employeeId" });
      }
      filter.employee = empId;
    } else if (employeeIds !== undefined) {
      if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
        return res.status(400).json({ success: false, message: "Select at least one employee" });
      }
      if (!employeeIds.every((id) => mongoose.isValidObjectId(id))) {
        return res.status(400).json({ success: false, message: "Invalid employeeId" });
      }
      filter.employee = { $in: employeeIds };
    }

    const [attendances, workConfig] = await Promise.all([
      Attendance.find(filter)
        // activityType: the employee's allocated ERPNext activity type (timesheet lines).
        .populate({
          path: "employee",
          select: "employeeId name activityType",
          populate: { path: "activityType", select: "name" },
        })
        .populate("sessions.jobId", "jobCode")
        .populate("sessions.splitJobIds", "jobCode")
        .lean(),
      workModel.findOne({ type: "default" }).lean(),
    ]);

    // Drop records whose employee was hard-deleted — they can't link in ERPNext.
    const records = attendances.filter((a) => a.employee && a.employee.employeeId);

    const companyName = workConfig?.erpCompanyName || DEFAULT_COMPANY;
    const activityType = workConfig?.erpDefaultActivityType || DEFAULT_ACTIVITY_TYPE;
    const overtimeActivityType = workConfig?.erpOvertimeActivityType || "";
    const overtimeType = workConfig?.erpOvertimeType || "";
    const paidLeaveType = workConfig?.erpPaidLeaveType || "";
    const standardWorkingHours = workConfig?.fullDayHours ?? 8;
    const pad2 = (n) => String(n).padStart(2, "0");
    const stamp = `${yearNum}-${pad2(monthNum)}`;

    let built;
    let filename;
    if (type === "attendance") {
      built = buildAttendanceCsv(records, {
        companyName,
        overtimeType,
        paidLeaveType,
        standardWorkingHours,
      });
      filename = `erpnext-attendance-${stamp}.csv`;
    } else if (type === "timesheet") {
      built = buildTimesheetCsv(records, { companyName, activityType, overtimeActivityType });
      filename = `erpnext-timesheet-${stamp}.csv`;
    } else {
      return res.status(400).json({
        success: false,
        message: "type must be one of: attendance, timesheet",
      });
    }

    // Hours the file could not carry — the client warns with these (exposed via cors in app.js).
    const metaHeaders = {
      "X-Erpnext-Skipped-No-Job": built.meta?.skippedNoJob,
      "X-Erpnext-Skipped-Hours": built.meta?.skippedHours,
      "X-Erpnext-Unallocated-Activity": built.meta?.unallocated,
      "X-Erpnext-Dropped-Overtime-Hours": built.meta?.droppedOtHours,
      "X-Erpnext-Dropped-Holiday-Hours": built.meta?.droppedHolidayHours,
    };
    for (const [name, value] of Object.entries(metaHeaders)) {
      if (value != null) res.setHeader(name, String(value));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Leading BOM so Excel opens the UTF-8 CSV with the right encoding.
    return res.status(200).send("﻿" + built.csv);
  } catch (error) {
    console.error("exportErpnext error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate ERPNext export",
      error: error.message,
    });
  }
};

const attendanceController = {
  monthlyReport,
  rangeReport,
  exportErpnext,
  jobReport,
  getSummary,
  unlockAttendance,
  updateAttendance,
  toggleHolidayStatus,

  getSiteAttendance,
  getSiteCarryovers,
  getAttendanceRecords,
  getEmployeeAttendanceByMonth,
  siteFirstSubmitAttendance,
  getAttendanceById,
  addSessionToAttendance,
  transferEmployee,
  getMissingEmployees,
  backfillAttendance,
  bulkBackfillAttendance,
  bulkCheckout,
  getActiveSitesOverview,

  getNightShiftCandidates,
  assignNightShift,

  getEmployeeDaySessions,

  getAttendanceHistory,
  updateAttendanceRemark,

  getLeaveBalance,
  previewLeave,
  grantLeave,
  updateLeave,
  cancelLeave,
  deleteLeave,
  listLeaves,
  listEmployeeLeaves,
  getEmployeesOnLeaveForDate,

};

export default attendanceController;
