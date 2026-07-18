// Shared pay-rate math. Single source of truth for turning an employee's
// monthlySalary into the hourly rates the monthly report prices hours at.
// Companion to attendanceMath.js, which owns the hours themselves.
//
// Overtime is RELATIVE: each employee's OT hour is worth a multiple of their own
// normal hourly rate, rather than one flat company-wide amount.

// Fallbacks for both knobs, matching the WorkSchedule schema defaults. They are
// load-bearing, not belt-and-braces: monthlyReport reads the config with .lean(),
// which returns raw BSON and skips Mongoose's defaults, so a config doc written
// before these fields existed arrives here with them undefined.
export const DEFAULT_OVERTIME_MULTIPLIER = 1.25;
export const DEFAULT_MONTHLY_HOURS_DIVISOR = 240;

function resolveNumber(value, fallback, isValid) {
  const num = Number(value);
  return Number.isFinite(num) && isValid(num) ? num : fallback;
}

/**
 * Normal hourly pay = monthlySalary / monthlyHoursDivisor.
 *
 * @param {number}  monthlySalary  Employee.monthlySalary (0 / missing → 0)
 * @param {object}  workConfig     WorkSchedule doc (needs monthlyHoursDivisor)
 * @returns {number} Hourly rate; 0 when the employee has no salary on file.
 */
export function computeHourlyRate(monthlySalary, workConfig = {}) {
  const salary = resolveNumber(monthlySalary, 0, (n) => n > 0);
  if (salary === 0) return 0;

  const divisor = resolveNumber(
    workConfig.monthlyHoursDivisor,
    DEFAULT_MONTHLY_HOURS_DIVISOR,
    (n) => n > 0
  );

  return salary / divisor;
}

/**
 * OT hourly pay = normal hourly rate × overtimeMultiplier.
 * Also the rate holidayHours are paid at — the monthly report folds them into
 * the overtime bucket.
 *
 * @param {number}  monthlySalary  Employee.monthlySalary (0 / missing → 0)
 * @param {object}  workConfig     WorkSchedule doc (needs monthlyHoursDivisor, overtimeMultiplier)
 * @returns {number} OT rate per hour; 0 when the employee has no salary on file.
 */
export function computeOvertimeRate(monthlySalary, workConfig = {}) {
  const multiplier = resolveNumber(
    workConfig.overtimeMultiplier,
    DEFAULT_OVERTIME_MULTIPLIER,
    (n) => n >= 0
  );

  return computeHourlyRate(monthlySalary, workConfig) * multiplier;
}
