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
  session = null,
}) {
  try {
    const row = {
      type,
      actor: actor?.actorId ?? null,
      actorName: actor?.actorName ?? "System",
      employee,
      employeeName: employeeName || "",
      fromSiteId,
      toSiteId,
      siteId,
      summary,
      dateLocal: getTodayLocal(),
    }
    await siteActivityModel.create([row], session ? { session } : {})
  } catch (err) {
    console.error("[siteActivity] failed to record:", err.message)
  }
}
