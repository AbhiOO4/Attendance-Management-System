// Supervisor backfill window (WorkSchedule.supervisorBackfillWindowDays): a supervisor may
// backfill the PAST N days — yesterday back to N days ago, never today. Mirror of the server's
// utils/backfillWindow.js — keep in sync. The server is the authority; this only drives the UI.

import { getCurrentTargetDateString } from "@/lib/dateUtils"

export const MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS = 10
export const DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS = 3

export function resolveBackfillWindowDays(cfg: { supervisorBackfillWindowDays?: number | null } | null | undefined): number {
  const n = Number(cfg?.supervisorBackfillWindowDays)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SUPERVISOR_BACKFILL_WINDOW_DAYS
  return Math.min(Math.floor(n), MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS)
}

/** "YYYY-MM-DD" shifted by `days` (UTC arithmetic on a business-day key). */
export function shiftDay(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The window's days, newest first: yesterday … N days ago. */
export function supervisorBackfillDays(cfg: { supervisorBackfillWindowDays?: number | null } | null | undefined): string[] {
  const today = getCurrentTargetDateString()
  const n = resolveBackfillWindowDays(cfg)
  return Array.from({ length: n }, (_, i) => shiftDay(today, -(i + 1)))
}

export function isInSupervisorWindow(
  dateStr: string,
  cfg: { supervisorBackfillWindowDays?: number | null } | null | undefined
): boolean {
  return supervisorBackfillDays(cfg).includes(dateStr.slice(0, 10))
}
