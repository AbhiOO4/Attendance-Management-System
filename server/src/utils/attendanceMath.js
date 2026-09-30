// Shared attendance pay math. Single source of truth for status, breaks,
// net hours, overtime and holiday-hour credits — used by the attendance
// controller, the auto check-in/out crons, default propagation and the
// recalculation script in seed/seed.js. Any formula change here requires
// re-running that recalculation script against existing records.

// A day carries at most ONE break, however long it runs (a 24h shift still deducts
// one). Applies to the auto count and to a supervisor's `breaksTaken` override alike.
export const MAX_BREAKS_PER_DAY = 1;

/**
 * The raw hours a day must reach before the automatic break is deducted.
 * `WorkSchedule.breakMinHours` when set (> 0); otherwise falls back to `fullDayHours`,
 * which is also the fallback for `.lean()` reads and hand-built config objects.
 *
 * @param {object} workConfig  WorkSchedule document (breakMinHours?, fullDayHours)
 * @returns {number}
 */
export function resolveBreakMinHours(workConfig) {
  const configured = Number(workConfig?.breakMinHours);
  if (configured > 0) return configured;
  return Number(workConfig?.fullDayHours) || 0;
}

/**
 * Auto break count from a day's RAW (pre-deduction) worked hours: one break once
 * the day reaches `breakMinHours`, otherwise none — never more than one. A
 * supervisor may still override this via `breaksTaken` (clamped to 0–1).
 *
 * @param {number} rawHours       Sum of all session workedHours
 * @param {number} breakMinHours  resolveBreakMinHours(workConfig)
 * @returns {0|1}
 */
export function computeAutoBreaks(rawHours, breakMinHours) {
  return breakMinHours > 0 && rawHours >= breakMinHours ? 1 : 0;
}

/**
 * Computes net work hours, attendance status, overtime and holiday hours
 * from raw session hours.
 *
 * Design rules:
 *  1. STATUS   — determined from RAW hours (break-agnostic) to prevent edge-case demotions.
 *  2. BREAKS   — 0 or 1 per day: one once raw hours reach breakMinHours (see
 *                computeAutoBreaks); a supervisor override is clamped to MAX_BREAKS_PER_DAY.
 *  3. NET HRS  — raw minus total break deduction (never below 0).
 *  4. OVERTIME — calculated on NET hours against overtimeThreshold; forced to 0 on holidays.
 *  5. HOLIDAY  — any holiday (public or weekly) credits NET hours; 0 on a normal day.
 *
 * @param {number}      rawHours    Sum of all session workedHours
 * @param {object}      workConfig  WorkSchedule document (needs fullDayHours, halfDayHours,
 *                                  overtimeThreshold, breakDurationMinutes, breakMinHours?)
 * @param {number|null} breaksTaken null = auto; 0+ = supervisor override (clamped to 0–1)
 * @param {{isHoliday: boolean, reason: "weekly"|"public"|null}|null} holidayInfo
 *                                  The record's holiday state; null/false = normal day
 * @returns {{ netWorkHours, status, overtimeHours, breaksApplied, holidayHours }}
 */
// Round to 2 decimals, guarding against float artefacts (0.1 + 0.2 style drift).
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Distribute a total across weighted buckets PRO-RATA, rounded to 2dp, with the rounding
 * residual pushed onto the largest-weight bucket so the parts sum EXACTLY to `total`.
 *
 * The shared primitive behind the ERPNext export's two day-level splits: a day's NET
 * hours across sessions (weighted by raw hours) and a day's OVERTIME across sessions
 * (weighted by net hours). Zero total weight → all zeros; a single bucket → the whole total.
 *
 * @param {number[]} weights  non-negative bucket weights, in order
 * @param {number}   total    the amount to distribute (2dp)
 * @returns {number[]} one value (2dp) per weight, in order; Σ === total
 */
export function allocateProRata(weights, total) {
  const w = (Array.isArray(weights) ? weights : []).map((x) => Math.max(Number(x) || 0, 0));
  const n = w.length;
  if (n === 0) return [];

  const sumW = w.reduce((a, b) => a + b, 0);
  const t = Math.max(Number(total) || 0, 0);

  // No weight at all (e.g. an all-empty day): nothing to distribute.
  if (sumW <= 0) return w.map(() => 0);
  // Single bucket: the whole total lands on it.
  if (n === 1) return [round2(t)];

  const out = w.map((x) => round2((x / sumW) * t));
  const residual = round2(t - out.reduce((a, b) => a + b, 0));
  if (residual !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < n; i++) if (w[i] > w[maxIdx]) maxIdx = i;
    out[maxIdx] = round2(out[maxIdx] + residual);
  }
  return out;
}

/**
 * Allocate a day's NET worked hours across its sessions, PRO-RATA by each session's
 * RAW worked hours.
 *
 * Breaks are a single day-level deduction (see computeAttendanceTotals) — a session
 * carries only its raw `workedHours`, never a per-session net. This spreads the day's
 * break deduction across sessions in proportion to their raw share, so the per-session
 * net sums EXACTLY back to the day net (`record.totalWorkHours`). Used by the ERPNext
 * timesheet export so that per-job/project cost reconciles to the net hours actually
 * paid. On a single-session day the whole net (and thus the whole break) sits on that
 * one session.
 *
 * @param {Array<{workedHours?: number}>} sessions  the day's sessions (raw workedHours each)
 * @param {number} dayNetHours                       record.totalWorkHours (net, already 2dp)
 * @returns {number[]} one net-hours value (2dp) per session, in input order; Σ === dayNetHours
 */
export function allocateSessionNetHours(sessions, dayNetHours) {
  const raws = (Array.isArray(sessions) ? sessions : []).map(
    (s) => Math.max(Number(s?.workedHours) || 0, 0)
  );
  return allocateProRata(raws, dayNetHours);
}

export function computeAttendanceTotals(rawHours, workConfig, breaksTaken = null, holidayInfo = null) {
  const { fullDayHours, halfDayHours, overtimeThreshold } = workConfig;
  const breakDurationHours = (workConfig.breakDurationMinutes || 0) / 60;

  // STEP 1 – Status from raw hours (never affected by break deduction)
  let status = 'absent';
  if (rawHours >= fullDayHours)       status = 'fullday';
  else if (rawHours >= halfDayHours)  status = 'halfday';

  // STEP 2 – Number of breaks to apply
  const autoBreaks = computeAutoBreaks(rawHours, resolveBreakMinHours(workConfig));
  const breaksApplied = (breaksTaken !== null && breaksTaken !== undefined && breaksTaken >= 0)
    ? Math.min(breaksTaken, MAX_BREAKS_PER_DAY)
    : autoBreaks;
  const totalBreakHours = breaksApplied * breakDurationHours;

  // STEP 3 – Net work hours (floor at 0)
  const netWorkHours = Number(Math.max(rawHours - totalBreakHours, 0).toFixed(2));

  // STEP 4 – Overtime on net hours
  let overtimeHours = netWorkHours > overtimeThreshold
    ? Number((netWorkHours - overtimeThreshold).toFixed(2))
    : 0;

  // STEP 5 – Holiday: no overtime; holiday hours = the day's net worked hours
  let holidayHours = 0;
  if (holidayInfo && holidayInfo.isHoliday) {
    overtimeHours = 0;
    holidayHours = netWorkHours;
  }

  return { netWorkHours, status, overtimeHours, breaksApplied, holidayHours };
}

/**
 * Recompute an attendance record's day totals IN PLACE from its current sessions,
 * using the record's own break override and holiday state. For write paths that
 * change a record's sessions outside a full submit/edit (removing a session,
 * auto-closing one) so their totals stay identical to what those paths produce.
 *
 * @param {object} record      Attendance document (sessions, breaksTaken, isHoliday, holidayReason)
 * @param {object} workConfig  WorkSchedule document
 * @returns {{ netWorkHours, status, overtimeHours, breaksApplied, holidayHours }}
 */
export function recomputeRecordTotals(record, workConfig) {
  const rawHours = (record.sessions || []).reduce((sum, s) => sum + (s.workedHours || 0), 0);
  const totals = computeAttendanceTotals(
    rawHours,
    workConfig,
    record.breaksTaken ?? null,
    { isHoliday: record.isHoliday, reason: record.holidayReason }
  );
  record.totalWorkHours = totals.netWorkHours;
  record.status = totals.status;
  record.overtimeHours = totals.overtimeHours;
  record.holidayHours = totals.holidayHours;
  return totals;
}
