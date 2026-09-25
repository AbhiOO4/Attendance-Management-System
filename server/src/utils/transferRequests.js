/**
 * Closing transfer requests that a direct action has overtaken.
 *
 * A pending request stops being meaningful the moment the employee is placed some
 * other way (Send to site, Insta-add, an admin Transfer), removed from their home
 * site, or one of the request's sites is deactivated/deleted. Leaving it pending
 * strands a card in someone's inbox whose Accept can only fail — or, worse, succeed
 * against a situation nobody intended. Callers mark such requests `expired` (with a
 * reason) inside their own transaction, then notify the requesters AFTER commit.
 */
import TransferRequest from "../models/transferRequestModel.js"
import empModel from "../models/empModel.js"
import { notifyUser } from "./notify.js"

/**
 * Expire every PENDING request matching `filter` (e.g. `{ employee }` or
 * `{ $or: [{ fromSite }, { toSite }] }`). Runs in the caller's session. Returns the
 * expired requests (lean) so the caller can notify their requesters after commit.
 */
export async function supersedePendingRequests({ filter, note, decidedBy = null, session = null }) {
  const pending = await TransferRequest.find({ ...filter, status: "pending" })
    .select("_id employee requestedBy")
    .session(session || null)
    .lean()
  if (pending.length === 0) return []

  await TransferRequest.updateMany(
    { _id: { $in: pending.map((r) => r._id) }, status: "pending" },
    { $set: { status: "expired", note, decidedBy, decidedAt: new Date() } },
    { session: session || undefined }
  )
  return pending
}

/**
 * Tell each requester their request was closed (best-effort; call after commit).
 * Skips `exceptUserId` — the person who just acted already knows.
 */
export async function notifySuperseded(requests, note, { exceptUserId = null } = {}) {
  const targets = (requests || []).filter(
    (r) => !exceptUserId || String(r.requestedBy) !== String(exceptUserId)
  )
  if (targets.length === 0) return

  try {
    const empIds = [...new Set(targets.map((r) => String(r.employee)))]
    const emps = await empModel.find({ _id: { $in: empIds } }).select("name").lean()
    const nameById = new Map(emps.map((e) => [String(e._id), e.name]))

    await Promise.all(
      targets.map((r) =>
        notifyUser(r.requestedBy, {
          type: "request_expired",
          title: "Transfer request closed",
          body: `Your request for ${nameById.get(String(r.employee)) || "the employee"} was closed: ${note}`,
          url: "/requests",
          relatedRequest: r._id,
        })
      )
    )
  } catch (err) {
    console.error("[requests] failed to notify superseded requesters:", err.message)
  }
}
