// Client mirror of the server's day math (server/src/utils/attendanceMath.js). Every
// edit/backfill preview goes through computeAttendanceTotals below — never an inline copy —
// so what a supervisor or admin sees is what the server stores. The server recomputes on
// save and stays the source of truth. Keep in sync; the shared golden fixtures in
// server/test/fixtures/parity/ run against BOTH (server node:test + client vitest).

export type HolidayReason = "weekly" | "public" | null

/**
 * A day carries at most ONE break, however long it runs. Mirror of the server's
 * MAX_BREAKS_PER_DAY (server/src/utils/attendanceMath.js) — keep in sync.
 */
export const MAX_BREAKS_PER_DAY = 1

/**
 * Raw hours a day must reach before the automatic break is deducted: the configured
 * `breakMinHours` when set, else `fullDayHours`. Mirror of the server's
 * resolveBreakMinHours — keep in sync.
 */
export function resolveBreakMinHours(
  cfg: { breakMinHours?: number | null; fullDayHours?: number | null } | null | undefined
): number {
  const configured = Number(cfg?.breakMinHours)
  if (configured > 0) return configured
  return Number(cfg?.fullDayHours) || 0
}

/**
 * Auto break count from a day's RAW (pre-deduction) worked hours: one break once the
 * day reaches `breakMinHours`, otherwise none. Mirror of the server's
 * computeAutoBreaks — keep in sync.
 */
export function computeAutoBreaks(rawHours: number, breakMinHours: number): number {
  return breakMinHours > 0 && rawHours >= breakMinHours ? 1 : 0
}

/** A stored/edited `breaksTaken` override clamped to 0–MAX_BREAKS_PER_DAY (null = auto). */
export function clampBreaks(value: number): number
export function clampBreaks(value: number | null | undefined): number | null
export function clampBreaks(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return Math.min(Math.max(value, 0), MAX_BREAKS_PER_DAY)
}

/**
 * Hours credited for working on a holiday. Mirrors the server's
 * computeAttendanceTotals holiday branch — keep in sync.
 *  - public or weekly holiday → the day's net worked hours
 *  - not a holiday            → 0
 */
export function computeHolidayHours(netWorkHours: number, reason: HolidayReason): number {
  return reason === "public" || reason === "weekly" ? netWorkHours : 0
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * A day's RAW hours: the sessions' EXACT durations summed, rounded ONCE. Mirror of the
 * server's sumRawHours — never add up per-session rounded hours (3 sessions totalling 8h
 * can otherwise read 7.99 and demote a full day). Sessions carry absolute instants
 * (checkIn/checkOut); one without both falls back to its workedHours, an open one is 0.
 */
export function sumRawHours(
  sessions: ReadonlyArray<{ checkIn?: string | Date | null; checkOut?: string | Date | null; workedHours?: number | null } | null | undefined>
): number {
  let ms = 0
  let fallbackHours = 0
  for (const s of sessions ?? []) {
    if (!s) continue
    const inMs = s.checkIn ? new Date(s.checkIn).getTime() : NaN
    const outMs = s.checkOut ? new Date(s.checkOut).getTime() : NaN
    if (Number.isFinite(inMs) && Number.isFinite(outMs)) ms += Math.max(outMs - inMs, 0)
    else if (!s.checkIn || s.checkOut) fallbackHours += Math.max(Number(s.workedHours) || 0, 0)
  }
  return round2(ms / 3600000 + fallbackHours)
}

/** What computeAttendanceTotals needs from the work schedule. */
export interface DayMathConfig {
  fullDayHours: number
  halfDayHours: number
  overtimeThreshold: number
  breakDurationMinutes?: number | null
  breakMinHours?: number | null
}

export interface DayTotals {
  status: "fullday" | "halfday" | "absent"
  breaksApplied: number
  netWorkHours: number
  overtimeHours: number
  holidayHours: number
}

/**
 * The day's totals from its raw hours — exact mirror of the server's
 * computeAttendanceTotals: status from RAW hours; 0–1 break (auto once raw reaches
 * breakMinHours, or the clamped override); net = raw − break (≥ 0); OT on net over the
 * threshold; on a holiday OT is 0 and the whole net is holiday hours. `isHoliday` must
 * already account for temporary workers (they get no holiday treatment).
 */
export function computeAttendanceTotals(
  rawHours: number,
  cfg: DayMathConfig,
  breaksTaken: number | null | undefined,
  isHoliday: boolean
): DayTotals {
  const breakDurationHours = (Number(cfg.breakDurationMinutes) || 0) / 60

  let status: DayTotals["status"] = "absent"
  if (rawHours >= cfg.fullDayHours) status = "fullday"
  else if (rawHours >= cfg.halfDayHours) status = "halfday"

  const autoBreaks = computeAutoBreaks(rawHours, resolveBreakMinHours(cfg))
  const breaksApplied =
    breaksTaken !== null && breaksTaken !== undefined && breaksTaken >= 0
      ? Math.min(breaksTaken, MAX_BREAKS_PER_DAY)
      : autoBreaks

  const netWorkHours = Number(Math.max(rawHours - breaksApplied * breakDurationHours, 0).toFixed(2))
  let overtimeHours =
    netWorkHours > cfg.overtimeThreshold ? Number((netWorkHours - cfg.overtimeThreshold).toFixed(2)) : 0
  let holidayHours = 0
  if (isHoliday) {
    overtimeHours = 0
    holidayHours = netWorkHours
  }
  return { status, breaksApplied, netWorkHours, overtimeHours, holidayHours }
}
