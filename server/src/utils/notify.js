/**
 * In-app + web-push notification helpers for the transfer-request feature.
 *
 * Notifications are best-effort side effects — call these AFTER any db
 * transaction commits, never inside it. A failed notification (or push) is
 * logged and swallowed so it can never roll back the action it accompanies.
 */
import notificationModel from "../models/notificationModel.js"
import userModel from "../models/userModel.js"
import { sendPushToUser } from "./webPush.js"

/**
 * Persist an in-app notification for one user and fan a web push to their
 * devices. `payload` = { type, title, body?, url?, relatedRequest? }.
 */
export async function notifyUser(userId, payload) {
  if (!userId) return
  const { type, title, body = "", url = "/requests", relatedRequest = null } = payload

  try {
    await notificationModel.create({ user: userId, type, title, body, url, relatedRequest })
  } catch (err) {
    console.error("[notify] failed to create notification:", err.message)
  }

  try {
    const user = await userModel.findById(userId).select("pushSubscriptions")
    if (user) await sendPushToUser(user, { title, body, url, tag: type })
  } catch (err) {
    console.error("[notify] failed to send push:", err.message)
  }
}

/** Notify every admin/superadmin (used when a home site has no supervisor). */
export async function notifyAdmins(payload) {
  try {
    const admins = await userModel
      .find({ role: { $in: ["admin", "superadmin"] } })
      .select("_id")
    await Promise.all(admins.map((a) => notifyUser(a._id, payload)))
  } catch (err) {
    console.error("[notify] failed to notify admins:", err.message)
  }
}

/** The supervisor User assigned to a site, or null if the site has none. */
export async function findSiteSupervisor(siteId) {
  if (!siteId) return null
  return userModel
    .findOne({ assignedSite: siteId, role: "supervisor" })
    .select("_id name")
}
