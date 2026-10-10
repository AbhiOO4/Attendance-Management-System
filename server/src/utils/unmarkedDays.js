// Unmarked days: days with NO attendance record at all. They never reach the ERPNext
// Attendance CSV, so ERPNext treats them per its "Consider Unmarked Attendance As"
// setting — mirrored here by WorkSchedule.countUnmarkedAsAbsent. Shared by the monthly /
// range report (buildAttendanceReport) and the employee timesheet
// (getEmployeeAttendanceByMonth) so the two always count the same days.

import { getTodayLocal } from "./timeLocal.js";

// getUTCDay() index → the lowercase day names WorkSchedule.weeklyHolidays uses.
const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const utcMidnight = (value) => {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const utcDayKey = (date) => new Date(date).toISOString().slice(0, 10);

/** true unless explicitly switched off — config docs that predate the field are ON. */
export function unmarkedAsAbsent(workConfig) {
  return workConfig?.countUnmarkedAsAbsent !== false;
}

/**
 * The days of `spanDays` (UTC midnights) that can be unmarked: only those strictly
 * BEFORE today's business day, so a sheet nobody has saved yet today never shows up as
 * unmarked (or, with countUnmarkedAsAbsent, as absent).
 */
export function buildCountableDays(spanDays, weeklyHolidays = [], customHolidays = []) {
  const today = utcMidnight(getTodayLocal()).getTime();
  const publicHolidayKeys = new Set(
    customHolidays.map((holiday) => utcDayKey(holiday.date))
  );
  return spanDays
    .filter((day) => day.getTime() < today)
    .map((day) => {
      const key = utcDayKey(day);
      return {
        key,
        time: day.getTime(),
        isHoliday:
          weeklyHolidays.includes(WEEKDAY_NAMES[day.getUTCDay()]) ||
          publicHolidayKeys.has(key),
      };
    });
}

/**
 * How many of `countableDays` the employee has no record for. Counted from the day the
 * employee was added, and not at all for inactive employees; holidays are days off
 * except for temporary workers, who have none.
 */
export function countUnmarkedDays(employee, records, countableDays) {
  if (employee.isActive === false) return 0;
  const isTemporary = employee.employmentType === "temporary";
  const addedOn = employee.createdAt ? utcMidnight(employee.createdAt).getTime() : 0;
  const recordedKeys = new Set(records.map((record) => utcDayKey(record.date)));
  let unmarked = 0;
  for (const day of countableDays) {
    if (day.time < addedOn) continue;
    if (day.isHoliday && !isTemporary) continue;
    if (!recordedKeys.has(day.key)) unmarked += 1;
  }
  return unmarked;
}
