// Client mirror of the server's holiday pay math
// (server/src/utils/attendanceMath.js). Used by the edit/backfill modals to
// preview holiday hours in real time; the server recomputes on save and stays
// the source of truth. Keep in sync with the server's computeAttendanceTotals.

export type HolidayReason = "weekly" | "public" | null

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
 *  - public or weekly holiday → the day's net worked hours
 *  - not a holiday            → 0
 */
export function computeHolidayHours(netWorkHours: number, reason: HolidayReason): number {
  return reason === "public" || reason === "weekly" ? netWorkHours : 0
}
