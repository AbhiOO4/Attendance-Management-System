import { api } from "@/lib/api"
import type { HolidayReason } from "@/lib/attendanceUtils"

export type DayHoliday = { isHoliday: boolean; reason: HolidayReason }

/**
 * Whether a business day ("YYYY-MM-DD") is a holiday, and why — same priority as the
 * server's checkHolidayForDate: a custom/public holiday wins, else a weekly-holiday weekday
 * match. Used by the backfill previews (no record exists yet to carry the holiday state).
 * A failed lookup of the custom holiday falls through to the weekly check.
 */
export async function resolveDayHoliday(date: string, weeklyHolidays: string[] = []): Promise<DayHoliday> {
  try {
    const res = await api.get("/api/config/custom-holidays/check", { params: { date } })
    if (res.data?.isHoliday) return { isHoliday: true, reason: "public" }
  } catch (error) {
    console.log(error)
  }
  const [year, month, day] = date.split("-").map(Number)
  const dayName = new Date(Date.UTC(year, month - 1, day))
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    .toLowerCase()
  return weeklyHolidays.includes(dayName)
    ? { isHoliday: true, reason: "weekly" }
    : { isHoliday: false, reason: null }
}
