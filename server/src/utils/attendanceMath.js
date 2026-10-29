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
 * The shared primitive behind the day-level splits (allocateDaySessionHours) and a driver
 * session's equal per-job slices. Zero total weight → all zeros; a single bucket → the whole total.
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
 * net sums EXACTLY back to the day net (`record.totalWorkHours`). On a single-session day
 * the whole net (and thus the whole break) sits on that one session. The ERPNext timesheet
 * and Jobs report use allocateDaySessionHours, which also places the day's overtime.
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

// A session's exact length in ms: check-out − check-in when both Dates exist, else its
// stored workedHours (legacy / hand-built), and 0 for an open session — sumRawHours' rule.
function sessionLengthMs(s) {
  if (!s) return 0;
  const inMs = s.checkIn ? new Date(s.checkIn).getTime() : NaN;
  const outMs = s.checkOut ? new Date(s.checkOut).getTime() : NaN;
  if (Number.isFinite(inMs) && Number.isFinite(outMs)) return Math.max(outMs - inMs, 0);
  if (!s.checkIn || s.checkOut) return Math.max(Number(s.workedHours) || 0, 0) * 3600000;
  return 0;
}

/**
 * Split a day's stored totals across its sessions: each session's NET hours, and how much
 * of it is REGULAR vs PREMIUM (overtime, or the holiday credit on a worked holiday).
 *
 * Overtime belongs to the OVERTIME WINDOW — the last `overtimeHours` of the worked day — so
 * only the sessions worked in that window carry it. The break is part of the regular block
 * (regular raw = threshold + break), so it never comes out of OT time: e.g. 07:00–17:00 =
 * 10 raw − 1 break = 9 net, threshold 8 → 1 OT, window 16:00–17:00. With job A 07:00–15:00
 * and job B 15:00–17:00, B carries the whole hour of OT. The window is walked back from the
 * latest check-out over WORKED time, so gaps between sessions are skipped.
 *
 * The break (and any rounding) is deducted from the regular portions PRO-RATA by their raw
 * length: above, A 8 raw + B 1 raw share 8 regular net → A 7.11, B 0.89 (+ 1 OT).
 * A worked holiday is all premium, split by raw length; a day with no OT is split by raw
 * length exactly like allocateSessionNetHours.
 *
 * Used by the ERPNext timesheet export and the Jobs report, so the two agree per job.
 *
 * @param {Array<{checkIn?, checkOut?, workedHours?}>} sessions  the day's WORKED sessions
 * @param {{netHours: number, overtimeHours?: number, holidayHours?: number}} totals  stored day totals
 * @returns {Array<{net: number, regular: number, premium: number}>} per session, input order;
 *          Σnet === netHours, Σpremium === overtimeHours + holidayHours, net = regular + premium
 */
export function allocateDaySessionHours(sessions, { netHours = 0, overtimeHours = 0, holidayHours = 0 } = {}) {
  const list = Array.isArray(sessions) ? sessions : [];
  const raws = list.map(sessionLengthMs);
  const net = Math.max(Number(netHours) || 0, 0);
  const holiday = Math.max(Number(holidayHours) || 0, 0);
  const ot = Math.min(Math.max(Number(overtimeHours) || 0, 0), net);

  // A worked holiday: every hour is premium.
  if (holiday > 0) {
    const nets = allocateProRata(raws, net);
    const premiums = allocateProRata(nets, Math.min(holiday, net));
    return nets.map((n, i) => ({ net: n, regular: round2(n - premiums[i]), premium: premiums[i] }));
  }

  if (ot <= 0) {
    return allocateProRata(raws, net).map((n) => ({ net: n, regular: n, premium: 0 }));
  }

  // Each session's overlap with the OT window, walking back from the latest check-out.
  const endMs = (s) => (s?.checkOut ? new Date(s.checkOut).getTime() : -Infinity);
  const byEndDesc = list.map((s, i) => i).sort((a, b) => endMs(list[b]) - endMs(list[a]));
  const overlaps = raws.map(() => 0);
  let remaining = Math.round(ot * 3600000);
  for (const i of byEndDesc) {
    if (remaining <= 0) break;
    overlaps[i] = Math.min(raws[i], remaining);
    remaining -= overlaps[i];
  }

  const premiums = allocateProRata(overlaps, ot);
  const regularRaws = raws.map((r, i) => r - overlaps[i]);
  const regularWeights = regularRaws.some((r) => r > 0) ? regularRaws : raws;
  const regulars = allocateProRata(regularWeights, round2(net - ot));
  return regulars.map((r, i) => ({ net: round2(r + premiums[i]), regular: r, premium: premiums[i] }));
}

/**
 * A day's RAW worked hours: the sessions' EXACT durations summed, rounded ONCE to 2dp.
 *
 * Never sum the stored per-session `workedHours`: each is already rounded to 2dp, so three
 * sessions that add up to exactly 8h (06:00–08:20, 08:20–10:40, 10:40–14:00 → 2.33 + 2.33 +
 * 3.33) would sum to 7.99 and demote a full day to a half day. A session without both
 * Dates (legacy, or a hand-built object) falls back to its `workedHours`; an open session
 * contributes 0. Every write path feeds computeAttendanceTotals with this.
 *
 * @param {Array<{checkIn?: Date|string|null, checkOut?: Date|string|null, workedHours?: number}>} sessions
 * @returns {number}
 */
export function sumRawHours(sessions) {
  let ms = 0;
  let fallbackHours = 0;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s) continue;
    const inMs = s.checkIn ? new Date(s.checkIn).getTime() : NaN;
    const outMs = s.checkOut ? new Date(s.checkOut).getTime() : NaN;
    if (Number.isFinite(inMs) && Number.isFinite(outMs)) {
      ms += Math.max(outMs - inMs, 0);
    } else if (!s.checkIn || s.checkOut) {
      // No usable Dates: trust the stored hours. (Checked in, no check-out = open → 0.)
      fallbackHours += Math.max(Number(s.workedHours) || 0, 0);
    }
  }
  return round2(ms / 3600000 + fallbackHours);
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
  const rawHours = sumRawHours(record.sessions);
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
