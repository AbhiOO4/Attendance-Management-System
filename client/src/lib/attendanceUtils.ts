// Client mirror of the server's holiday pay math
// (server/src/utils/attendanceMath.js). Used by the edit/backfill modals to
// preview holiday hours in real time; the server recomputes on save and stays
// the source of truth. Keep in sync with the server's computeAttendanceTotals.

export type HolidayReason = "weekly" | "public" | null

// Fallback weekly-holiday award knobs, matching the server's
// WEEKLY_HOLIDAY_AWARD_DEFAULTS. Used when the config predates these fields.
export const WEEKLY_HOLIDAY_AWARD_DEFAULTS = {
  enabled: true,
  awardHours: 4,
  minHours: 6,
}

/**
 * Auto break count from a day's RAW (pre-deduction) worked hours. Mirror of the
 * server's computeAutoBreaks (server/src/utils/attendanceMath.js) — keep in sync.
 *
 * One break per day: the first break is earned once the day reaches a full day
 * (`fullDayHours`), and one further break is added for each ADDITIONAL two full
 * days worked. With a full day of 8h: <8h → 0, 8–23h → 1, 24h → 2, 40h → 3.
 */
export function computeAutoBreaks(rawHours: number, fullDayHours: number): number {
  if (!(fullDayHours > 0) || rawHours < fullDayHours) return 0
  return 1 + Math.floor((rawHours - fullDayHours) / (2 * fullDayHours))
}

/**
 * Hours credited for working on a holiday. Mirrors the server's
 * computeAttendanceTotals holiday branch — keep in sync.
 *  - public holiday → the day's net worked hours
 *  - weekly holiday → flat `weekly.awardHours` when enabled and RAW hours reach
 *                     `weekly.minHours`, else 0
 *  - not a holiday  → 0
 *
 * The weekly gate compares RAW worked hours (break-agnostic), so pass the raw
 * total, not the net. Any undefined `weekly` value falls back to the shared
 * WEEKLY_HOLIDAY_AWARD_DEFAULTS.
 */
export function computeHolidayHours(
  rawWorkHours: number,
  netWorkHours: number,
  reason: HolidayReason,
  weekly?: { enabled?: boolean; minHours?: number; awardHours?: number }
): number {
  if (reason === "public") return netWorkHours
  if (reason === "weekly") {
    const enabled = weekly?.enabled ?? WEEKLY_HOLIDAY_AWARD_DEFAULTS.enabled
    const minHours = weekly?.minHours ?? WEEKLY_HOLIDAY_AWARD_DEFAULTS.minHours
    const awardHours = weekly?.awardHours ?? WEEKLY_HOLIDAY_AWARD_DEFAULTS.awardHours
    return enabled && rawWorkHours >= minHours ? awardHours : 0
  }
  return 0
}
