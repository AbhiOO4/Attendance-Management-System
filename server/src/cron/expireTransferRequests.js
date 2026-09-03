import cron from "node-cron"
import TransferRequest from "../models/transferRequestModel.js"
import { getTodayLocal } from "../utils/timeLocal.js"

/**
 * Expire stale transfer requests. Requests are a today-only roster-setup action,
 * so any request still `pending` from an earlier local business day is closed as
 * `expired`. A single indexed updateMany ({ status, dateLocal }) — negligible on
 * the small instance. Runs hourly (a missed run just clears on the next tick).
 */
async function runExpireTransferRequests() {
  try {
    const today = getTodayLocal()
    const result = await TransferRequest.updateMany(
      { status: "pending", dateLocal: { $ne: today } },
      { $set: { status: "expired", decidedAt: new Date(), note: "Expired at day rollover" } }
    )
    if (result.modifiedCount > 0) {
      console.log(`[ExpireRequests] Expired ${result.modifiedCount} stale transfer request(s)`)
    }
  } catch (error) {
    console.error("[ExpireRequests] Cron job error:", error)
  }
}

/** Start the hourly transfer-request expiry cron (also runs once at boot). */
export function startExpireTransferRequestsCron() {
  runExpireTransferRequests()
  cron.schedule("0 * * * *", runExpireTransferRequests)
  console.log("[ExpireRequests] Cron job started (runs hourly)")
}
