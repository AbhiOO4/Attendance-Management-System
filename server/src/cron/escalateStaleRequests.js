import cron from "node-cron"
import TransferRequest from "../models/transferRequestModel.js"
import { getTodayLocal } from "../utils/timeLocal.js"
import { notifyAdmins } from "../utils/notify.js"

/**
 * Escalate stuck transfer requests to admins.
 *
 * A transfer request notifies the deciding site's supervisor(s) at creation, but that
 * delivery is best-effort — a web push can silently fail (no subscription, permission
 * off, iOS without an installed PWA), leaving only a passive in-app badge the supervisor
 * may never open. And when a site HAS supervisors, admins are deliberately NOT notified at
 * creation, so a missed request can sit unseen until the day-rollover expiry closes it —
 * exactly how a real request went unhandled and an admin had to place the employee by hand.
 *
 * This safety net pings every admin about any request still `pending` after
 * REQUEST_ESCALATE_AFTER_MINUTES (default 30), so someone with authority always ends up
 * looking at it. `escalatedAt` guards it to a single escalation per request (not every
 * tick). Only requests that actually WENT to a supervisor are escalated (`approver` set) —
 * a request with no supervisor already went to admins at creation, so re-pinging is skipped.
 *
 * Today-only, like the requests themselves: yesterday's stragglers are closed by the
 * expiry cron, so we scope to today's business day.
 */
const ESCALATE_AFTER_MINUTES = Number(process.env.REQUEST_ESCALATE_AFTER_MINUTES) || 30

async function runEscalateStaleRequests() {
  try {
    const cutoff = new Date(Date.now() - ESCALATE_AFTER_MINUTES * 60 * 1000)

    const stale = await TransferRequest.find({
      status: "pending",
      dateLocal: getTodayLocal(),
      escalatedAt: null,
      approver: { $ne: null },
      createdAt: { $lte: cutoff },
    })
      .limit(50)
      .populate("employee", "name")
      .populate("fromSite", "siteName")
      .populate("toSite", "siteName")

    for (const r of stale) {
      const empName = r.employee?.name || "an employee"
      const fromName = r.fromSite?.siteName || "their site"
      const toName = r.toSite?.siteName || "another site"

      // notifyAdmins is best-effort and swallows its own errors; do the escalation stamp
      // regardless so a transient notify failure doesn't loop us into re-escalating forever.
      await notifyAdmins({
        type: "request_escalated",
        title: "Transfer request still pending",
        body: `A request to move ${empName} from ${fromName} to ${toName} has been waiting ${ESCALATE_AFTER_MINUTES}+ min with no decision. You can approve or reject it.`,
        url: "/requests",
        relatedRequest: r._id,
      })

      r.escalatedAt = new Date()
      await r.save()
    }

    if (stale.length > 0) {
      console.log(`[EscalateRequests] Escalated ${stale.length} stale transfer request(s) to admins`)
    }
  } catch (error) {
    console.error("[EscalateRequests] Cron job error:", error)
  }
}

/** Start the stale-request escalation cron (runs every 5 minutes). */
export function startEscalateStaleRequestsCron() {
  cron.schedule("*/5 * * * *", runEscalateStaleRequests)
  console.log("[EscalateRequests] Cron job started (runs every 5 minutes)")
}
