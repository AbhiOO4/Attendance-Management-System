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
