/**
 * Notifications for supervisor backfill requests (controllers/backfillRequestController.js):
 *   submitted → every admin/superadmin, deep-linked to the review page;
 *   approved / sent back → the site's supervisors (plus whoever sent it, if they have since
 *   moved site), deep-linked to their backfill day.
 * In-app rows (Requests → Activity, counted in the sidebar badge) + web push, via
 * utils/notify.js. Best-effort: called after the write is saved, and never throws.
 */
import userModel from "../models/userModel.js"
import { notifyAdmins, notifyUser, findSiteSupervisors } from "./notify.js"

const dayKey = (date) => new Date(date).toISOString().slice(0, 10)

// "Fri, 16 Oct" — the business day is stored at UTC midnight, so format it in UTC.
const dayLabel = (date) =>
  new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`

async function userName(id) {
  if (!id) return "Someone"
  const user = await userModel.findById(id).select("name").lean()
  return user?.name || "Someone"
}

/** The site's supervisors + the sender, minus the acting admin. */
async function supervisorTargets(doc, actorId) {
  const ids = new Set((await findSiteSupervisors(doc.siteId)).map((s) => String(s._id)))
  if (doc.submittedBy) ids.add(String(doc.submittedBy))
  if (actorId) ids.delete(String(actorId))
  return [...ids]
}

/** A supervisor sent `doc` for approval. `siteName` from the caller (already loaded). */
export async function notifyBackfillSubmitted(doc, { siteName, actorId }) {
  try {
    const who = await userName(actorId)
    await notifyAdmins({
      type: "backfill_submitted",
      title: `Backfill to approve · ${siteName} · ${dayLabel(doc.date)}`,
      body: `${who} sent ${plural(doc.rows.length, "employee")} for approval.`,
      url: `/attendance/edit/backfill-requests/${doc._id}`,
    })
  } catch (err) {
    console.error("[backfillNotify] submitted:", err.message)
  }
}

/** An admin approved `doc`; `summary` = { createdCount, skippedCount, failedCount }. */
export async function notifyBackfillApproved(doc, { siteName, actorId, summary }) {
  try {
    const who = await userName(actorId)
    const notCreated = (summary?.skippedCount || 0) + (summary?.failedCount || 0)
    const payload = {
      type: "backfill_approved",
      title: `Backfill approved · ${siteName} · ${dayLabel(doc.date)}`,
      body:
        `${who} approved it — ${plural(summary?.createdCount || 0, "record")} created` +
        (notCreated ? `, ${notCreated} not (see the rows).` : "."),
      url: `/backfill/${dayKey(doc.date)}`,
    }
    const targets = await supervisorTargets(doc, actorId)
    await Promise.all(targets.map((id) => notifyUser(id, payload)))
  } catch (err) {
    console.error("[backfillNotify] approved:", err.message)
  }
}

/** An admin sent `doc` back with `reason`. */
export async function notifyBackfillRejected(doc, { siteName, actorId, reason }) {
  try {
    const who = await userName(actorId)
    const payload = {
      type: "backfill_rejected",
      title: `Backfill sent back · ${siteName} · ${dayLabel(doc.date)}`,
      body: `${who}: ${reason}`,
      url: `/backfill/${dayKey(doc.date)}`,
    }
    const targets = await supervisorTargets(doc, actorId)
    await Promise.all(targets.map((id) => notifyUser(id, payload)))
  } catch (err) {
    console.error("[backfillNotify] rejected:", err.message)
  }
}
