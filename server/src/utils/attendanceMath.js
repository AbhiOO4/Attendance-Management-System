// Shared attendance pay math. Single source of truth for status, breaks,
// net hours, overtime and holiday-hour credits — used by the attendance
// controller, the auto check-in/out crons, default propagation and the
// recalculation script in seed/seed.js. Any formula change here requires
// re-running that recalculation script against existing records.

// Flat hour credits for working on a WEEKLY holiday, by attendance status.
// (Public holidays credit the actual net worked hours instead.)
export const WEEKLY_HOLIDAY_HOURS = { fullday: 15, halfday: 10 };

/**
 * Computes net work hours, attendance status, overtime and holiday hours
 * from raw session hours.
 *
 * Design rules:
 *  1. STATUS   — determined from RAW hours (break-agnostic) to prevent edge-case demotions.
 *  2. BREAKS   — proportional: floor(raw / fullDayHours) per day, unless supervisor overrides.
 *  3. NET HRS  — raw minus total break deduction (never below 0).
 *  4. OVERTIME — calculated on NET hours against overtimeThreshold; forced to 0 on holidays.
 *  5. HOLIDAY  — public holiday credits NET hours; weekly holiday credits a flat
 *                15 (fullday) / 10 (halfday); 0 otherwise.
 *
 * @param {number}      rawHours    Sum of all session workedHours
 * @param {object}      workConfig  WorkSchedule document (needs fullDayHours, halfDayHours,
 *                                  overtimeThreshold, breakDurationMinutes)
 * @param {number|null} breaksTaken null = auto; 0+ = supervisor override
 * @param {{isHoliday: boolean, reason: "weekly"|"public"|null}|null} holidayInfo
 *                                  The record's holiday state; null/false = normal day
 * @returns {{ netWorkHours, status, overtimeHours, breaksApplied, holidayHours }}
 */
export function computeAttendanceTotals(rawHours, workConfig, breaksTaken = null, holidayInfo = null) {
  const { fullDayHours, halfDayHours, overtimeThreshold } = workConfig;
  const breakDurationHours = (workConfig.breakDurationMinutes || 0) / 60;

  // STEP 1 – Status from raw hours (never affected by break deduction)
  let status = 'absent';
  if (rawHours >= fullDayHours)       status = 'fullday';
  else if (rawHours >= halfDayHours)  status = 'halfday';

  // STEP 2 – Number of breaks to apply
  const autoBreaks = fullDayHours > 0 ? Math.floor(rawHours / fullDayHours) : 0;
  const breaksApplied = (breaksTaken !== null && breaksTaken !== undefined && breaksTaken >= 0)
    ? breaksTaken
    : autoBreaks;
  const totalBreakHours = breaksApplied * breakDurationHours;

  // STEP 3 – Net work hours (floor at 0)
  const netWorkHours = Number(Math.max(rawHours - totalBreakHours, 0).toFixed(2));

  // STEP 4 – Overtime on net hours
  let overtimeHours = netWorkHours > overtimeThreshold
    ? Number((netWorkHours - overtimeThreshold).toFixed(2))
    : 0;

  // STEP 5 – Holiday: no overtime, only holiday hours
  let holidayHours = 0;
  if (holidayInfo && holidayInfo.isHoliday) {
    overtimeHours = 0;
    if (holidayInfo.reason === 'public') {
      holidayHours = netWorkHours;
    } else if (holidayInfo.reason === 'weekly') {
      holidayHours = WEEKLY_HOLIDAY_HOURS[status] || 0;
    }
  }

  return { netWorkHours, status, overtimeHours, breaksApplied, holidayHours };
}
