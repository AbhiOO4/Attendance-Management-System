/**
 * Supervisor backfill window (WorkSchedule.supervisorBackfillWindowDays).
 *
 * A supervisor may backfill the PAST `N` days of their site — yesterday back to N days ago.
 * Today is never in it (today goes through the Site Attendance sheet). N is configurable by
 * admins on the Configure page, capped at MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS (hard-coded).
 *
 * All day keys come from getTodayLocal()/getDateLocal() (the app timezone), never a raw
 * new Date(), so the window doesn't slip a day around local midnight.
 *
 * Mirrored by client/src/lib/backfillWindow.ts — keep in sync.
 */
import { getDateLocal } from "./timeLocal.js"

export const MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS = 10
export const DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS = 3

/** The configured window in days, falling back to the default and clamped to 1–10. */
export function resolveBackfillWindowDays(workConfig) {
  const n = Number(workConfig?.supervisorBackfillWindowDays)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS
  return Math.min(Math.floor(n), MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS)
}

/** `{ from, to, days }` as "YYYY-MM-DD": to = yesterday, from = today − N (both inclusive). */
export function supervisorBackfillRange(workConfig) {
  const days = resolveBackfillWindowDays(workConfig)
  return { from: getDateLocal(-days), to: getDateLocal(-1), days }
}

/** True when the business day `dateStr` is inside the supervisor window. */
export function isInSupervisorWindow(dateStr, workConfig) {
  if (!dateStr) return false
  const day = String(dateStr).slice(0, 10)
  const { from, to } = supervisorBackfillRange(workConfig)
  return day >= from && day <= to
}
