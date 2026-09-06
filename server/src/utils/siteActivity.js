/**
 * Writer for the per-site, per-day activity feed (models/siteActivityModel.js) — employee
 * movements: transfer requests, direct transfers, send-to-site, add/remove.
 *
 * Best-effort: a failed log line is caught and swallowed so it can never stall or roll back
 * the action it accompanies. Pass a mongoose `session` to join a transaction; otherwise it's
 * a plain separate write. Reuses resolveActor from attendanceAudit.js (generic req.user →
 * { actorId, actorName }).
 */
import siteActivityModel from "../models/siteActivityModel.js"
import { getTodayLocal } from "./timeLocal.js"

export { resolveActor, SYSTEM_ACTOR } from "./attendanceAudit.js"

/**
 * Build a plain site-activity row (maps `actor` → actorId/actorName, defaults dateLocal to
 * today). Use for recordSiteActivityBatch; also used internally by the single writer.
 * Pass `dateLocal` to file the event under a business day other than today — e.g. a night
 * auto-checkout that modifies yesterday's record must surface in yesterday's feed.
 */
export function buildSiteActivityRow({
  type,
  actor,
  employee = null,
  employeeName = "",
  fromSiteId = null,
  toSiteId = null,
  siteId = null,
  summary,
  dateLocal = null,
}) {
  return {
    type,
    actor: actor?.actorId ?? null,
    actorName: actor?.actorName ?? "System",
    employee,
    employeeName: employeeName || "",
    fromSiteId,
    toSiteId,
    siteId,
    summary,
    dateLocal: dateLocal || getTodayLocal(),
  }
}

/**
 * Record one site-activity event. `actor` is the object from resolveActor (or SYSTEM_ACTOR).
 * Provide fromSiteId/toSiteId for a transfer, or siteId for a single-site event.
 */
export async function recordSiteActivity({
  type,
  actor,
  employee = null,
  employeeName = "",
  fromSiteId = null,
  toSiteId = null,
  siteId = null,
  summary,
  dateLocal = null,
  session = null,
}) {
  try {
    const row = buildSiteActivityRow({
      type,
      actor,
      employee,
      employeeName,
      fromSiteId,
      toSiteId,
      siteId,
      summary,
      dateLocal,
    })
    await siteActivityModel.create([row], session ? { session } : {})
  } catch (err) {
    console.error("[siteActivity] failed to record:", err.message)
  }
}

/** Best-effort batch write for bulk paths. `rows` = buildSiteActivityRow(...) outputs. */
export async function recordSiteActivityBatch(rows, session = null) {
  if (!Array.isArray(rows) || rows.length === 0) return
  try {
    await siteActivityModel.insertMany(rows, session ? { session } : {})
  } catch (err) {
    console.error("[siteActivity] failed to record batch:", err.message)
  }
}
