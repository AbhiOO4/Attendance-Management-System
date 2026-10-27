// Builds Attendance-shaped plain records for pure (no-DB) tests, priced by the REAL shared
// math — the same way every write path prices them. Times are local "HH:mm" in the app zone
// (setup-env.js → Oman); a check-out earlier than its check-in rolls to the next day.
import { combineFromOffset, deriveOffsets } from "../../src/utils/timeLocal.js";
import { computeAttendanceTotals, sumRawHours } from "../../src/utils/attendanceMath.js";

export const WORK_CONFIG = {
  fullDayHours: 8,
  halfDayHours: 4,
  overtimeThreshold: 8,
  breakDurationMinutes: 60,
  breakMinHours: null,
};

let nextId = 1;
const oid = () => String(nextId++).padStart(24, "0");

/** A populated job ({ _id, jobCode }) — jobCode null for a job with no code. */
export const job = (jobCode) => ({ _id: oid(), jobCode });

/**
 * One session. `jobs`: one job → `jobId`; several → a driver split (`splitJobIds`).
 * `out: null` → an open session.
 */
export function session(date, inTime, outTime, jobs = []) {
  const { checkInNextDay, checkOutNextDay } = deriveOffsets(inTime, outTime);
  const checkIn = combineFromOffset(date, inTime, checkInNextDay);
  const checkOut = outTime ? combineFromOffset(date, outTime, checkOutNextDay) : null;
  const workedHours = checkOut ? Number(((checkOut - checkIn) / 3600000).toFixed(2)) : 0;
  const list = Array.isArray(jobs) ? jobs : [jobs];
  return {
    checkIn,
    checkOut,
    workedHours,
    jobId: list.length === 1 ? list[0] : null,
    splitJobIds: list.length > 1 ? list : [],
  };
}

/**
 * A priced record. opts: { employee, sessions, isHoliday, holidayReason, breaksTaken,
 * isPaidLeave, isEmergencyLeave, isSickLeave, isLop }.
 */
export function record(date, opts = {}) {
  const sessions = opts.sessions || [];
  const isHoliday = !!opts.isHoliday;
  const totals = computeAttendanceTotals(sumRawHours(sessions), opts.workConfig || WORK_CONFIG, opts.breaksTaken ?? null, {
    isHoliday,
    reason: isHoliday ? opts.holidayReason || "public" : null,
  });
  return {
    _id: oid(),
    date: new Date(`${date}T00:00:00.000Z`),
    employee: opts.employee || { _id: oid(), employeeId: "E1", employmentType: "permanent" },
    sessions,
    breaksTaken: opts.breaksTaken ?? null,
    isHoliday,
    holidayReason: isHoliday ? opts.holidayReason || "public" : null,
    isPaidLeave: !!opts.isPaidLeave,
    isEmergencyLeave: !!opts.isEmergencyLeave,
    isSickLeave: !!opts.isSickLeave,
    isLop: !!opts.isLop,
    status: totals.status,
    totalWorkHours: totals.netWorkHours,
    overtimeHours: totals.overtimeHours,
    holidayHours: totals.holidayHours,
  };
}

export const employee = (employeeId, extra = {}) => ({
  _id: oid(),
  employeeId,
  employmentType: "permanent",
  ...extra,
});
