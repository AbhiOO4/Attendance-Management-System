// Client mirror of the server's holiday pay math
// (server/src/utils/attendanceMath.js). Used by the edit/backfill modals to
// preview holiday hours in real time; the server recomputes on save and stays
// the source of truth. Constants must match the server's WEEKLY_HOLIDAY_HOURS.

export type HolidayReason = "weekly" | "public" | null

export const WEEKLY_HOLIDAY_HOURS: Record<string, number> = {
  fullday: 15,
  halfday: 10,
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
 * Hours credited for working on a holiday.
 *  - public holiday → the day's net worked hours
 *  - weekly holiday → flat 15 (fullday) / 10 (halfday) / 0 (absent)
 *  - not a holiday  → 0
 *
 * `status` must be the raw-hours status (fullday/halfday/absent), matching the
 * server's computeAttendanceTotals — not display statuses like "sick"/"pending".
 */
export function computeHolidayHours(
  netWorkHours: number,
  status: "fullday" | "halfday" | "absent",
  reason: HolidayReason
): number {
  if (reason === "public") return netWorkHours
  if (reason === "weekly") return WEEKLY_HOLIDAY_HOURS[status] ?? 0
  return 0
}
