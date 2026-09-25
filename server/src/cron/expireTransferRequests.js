import cron from "node-cron"
import TransferRequest from "../models/transferRequestModel.js"
import { getTodayLocal, getDateLocal, isWithinCarryoverWindow } from "../utils/timeLocal.js"

/**
 * Expire stale transfer requests.
 *   - "pull" requests are a same-day handover: closed once their day is no longer today.
 *   - "push" requests (midday/night transfers) continue their SOURCE record's timeline,
 *     which stays live until the carryover window closes (local noon the next day) — so a
 *     night transfer sent at 23:30 can still be accepted after midnight. Closed after that.
 * acceptRequest enforces the same rule, so a request the cron hasn't reached yet can't be
 * accepted late. Runs hourly (a missed run just clears on the next tick).
 */
export async function runExpireTransferRequests() {
  try {
    const today = getTodayLocal()
    const set = { $set: { status: "expired", decidedAt: new Date(), note: "Expired at day rollover" } }

    // Pulls (and legacy docs without a direction): anything not from today.
    const pulls = await TransferRequest.updateMany(
      { status: "pending", direction: { $ne: "push" }, dateLocal: { $ne: today } },
      set
    )

    // Pushes: keep today's and — until local noon — yesterday's source records.
    const liveDays = [today]
    if (isWithinCarryoverWindow(getDateLocal(-1))) liveDays.push(getDateLocal(-1))
    const pushes = await TransferRequest.updateMany(
      {
        status: "pending",
        direction: "push",
        $or: [
          { attendanceDate: { $ne: null, $nin: liveDays } },
          // Legacy push docs (no attendanceDate) fall back to the day they were made.
          { attendanceDate: null, dateLocal: { $nin: liveDays } },
        ],
      },
      set
    )

    const expired = pulls.modifiedCount + pushes.modifiedCount
    if (expired > 0) {
      console.log(`[ExpireRequests] Expired ${expired} stale transfer request(s)`)
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
