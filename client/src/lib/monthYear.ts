import { getCurrentTargetDateString, getCurrentTargetTime } from "@/lib/dateUtils"

/** A calendar month; `month` is 1-12. */
export type MonthYear = { month: number; year: number }

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** The current month in the app's configured timezone (not the browser's). */
export function currentMonthYear(): MonthYear {
  const t = getCurrentTargetTime()
  return { month: t.getUTCMonth() + 1, year: t.getUTCFullYear() }
}

/** An inclusive span of business days, as "YYYY-MM-DD" strings. */
export type DateRange = { from: string; to: string }

/** Longest range the date-range report accepts (the server's MAX_REPORT_RANGE_DAYS). */
export const MAX_RANGE_DAYS = 366

const DAY_MS = 86_400_000

// "YYYY-MM-DD" → UTC midnight, or null for anything malformed or impossible
// (2026-02-31 would otherwise roll over into March).
function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const d = new Date(`${day}T00:00:00.000Z`)
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day ? d : null
}

/** Number of days in the range, inclusive — 0 when a bound is invalid or reversed. */
export function daysInRange(range: DateRange): number {
  const from = parseDay(range.from)
  const to = parseDay(range.to)
  if (!from || !to || from > to) return 0
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1
}

/** `day` moved by `delta` calendar days. */
export function shiftDay(day: string, delta: number): string {
  const d = parseDay(day)
  if (!d) return day
  return new Date(d.getTime() + delta * DAY_MS).toISOString().slice(0, 10)
}

/** The current month so far: its 1st through today (app timezone). */
export function currentMonthToDate(): DateRange {
  const today = getCurrentTargetDateString()
  return { from: `${today.slice(0, 8)}01`, to: today }
}

/** "1 Sep – 15 Sep 2026", "28 Dec 2025 – 3 Jan 2026", or "15 Sep 2026" for one day. */
export function formatDateRange(range: DateRange): string {
  const from = parseDay(range.from)
  const to = parseDay(range.to)
  if (!from || !to) return "Select dates"
  const dayMonth = (d: Date) =>
    `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)}`
  if (range.from === range.to) return `${dayMonth(to)} ${to.getUTCFullYear()}`
  if (from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${dayMonth(from)} – ${dayMonth(to)} ${to.getUTCFullYear()}`
  }
  return `${dayMonth(from)} ${from.getUTCFullYear()} – ${dayMonth(to)} ${to.getUTCFullYear()}`
}
