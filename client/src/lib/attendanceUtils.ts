// Client mirror of the server's holiday pay math
// (server/src/utils/attendanceMath.js). Used by the edit/backfill modals to
// preview holiday hours in real time; the server recomputes on save and stays
// the source of truth. Keep in sync with the server's computeAttendanceTotals.

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
  return Number(cfg?.fullDayHours) || 8
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
