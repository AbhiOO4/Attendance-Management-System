import mongoose from "mongoose"

/**
 * A cross-site transfer request. Two directions share this model, told apart by
 * `direction`:
 *
 *   - "pull" (default) — the DESTINATION site's supervisor asks the HOME site's
 *     supervisor to hand an employee over for a clean full-day handover (the employee
 *     is not yet marked today). The HOME site (fromSite) decides. Created via
 *     POST /api/requests.
 *   - "push" — a SOURCE site's supervisor transfers an employee MID-DAY (already
 *     marked and checked out at the source) to another site; the DESTINATION site
 *     (toSite) must accept before the arrival is placed. Created inside
 *     attendanceController.transferEmployee (admins bypass and transfer immediately).
 *
 * The deciding site is fromSite for "pull" and toSite for "push" — resolved in
 * requestController (incomingFilterFor / mayDecide). See requestController.js.
 *
 * `mode` is chosen by the requester (pull) or derived from the "only for today"
 * toggle (push):
 *   - "today"     → a full-day visit at the destination; home currentSite/currentJob
 *                   are untouched (back home tomorrow). Applied via the pendingTransfer*
 *                   stash on the employee (empModel.js), same rails as transferEmployee.
 *   - "permanent" → the employee's home moves to the destination going forward
 *                   (currentSite/currentJob repoint + job membership). A linked
 *                   supervisor's User.assignedSite (auth scope) follows the move.
 *
 * `carriedCheckIn` is set only for a "push": the source check-out snapshotted at
 * request time, replayed as the destination check-in when the request is accepted
 * (only if the source check-out is unchanged by then), on the `attendanceDate` record.
 *
 * `approver` is a REPRESENTATIVE supervisor of the DECIDING site kept for display; null
 * means that site had no supervisor at creation. It is NOT the authorization key — a site
 * may have several supervisors and ANY of them may decide (resolved by the deciding site
 * === assignedSite in requestController), and every admin sees and may decide every request.
 * Lifecycle:
 *   pending → accepted | rejected | cancelled | expired
 * A partial-unique index enforces at most one pending request per employee (either
 * direction), which also blocks a push while a pull is pending and vice versa.
 */
const transferRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },

    // Home site at request time (resolved server-side from employee.currentSite —
    // never trusted from the client).
    fromSite: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
    },

    fromJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },

    // Requesting (destination) site.
    toSite: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
    },

    toJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
    },

    mode: {
      type: String,
      enum: ["today", "permanent"],
      required: true,
    },

    // Which way the request flows (see the header comment). "pull" = destination asks
    // home (home decides); "push" = source sends, destination decides. Absent on
    // pre-existing docs → treated as "pull".
    direction: {
      type: String,
      enum: ["pull", "push"],
      default: "pull",
      index: true,
    },

    // The source check-out carried forward as the destination check-in (a midday second
    // session). "push": set when the request is made. "pull": set on accept only when the
    // decider split the day (dayHandling "split"); null otherwise.
    carriedCheckIn: {
      type: Date,
      default: null,
    },

    // "pull" only, set on accept when the employee had already checked in at their home
    // site today: "move" = that session was removed and the destination took the whole day;
    // "split" = that session was closed at carriedCheckIn and the destination starts there.
    // null when there was nothing to decide (not yet checked in) and on "push".
    dayHandling: {
      type: String,
      enum: ["move", "split"],
      default: null,
    },

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Representative supervisor of the DECIDING site (fromSite for pull, toSite for
    // push), kept for display. null → that site had no supervisor, admins decide.
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled", "expired"],
      default: "pending",
      index: true,
    },

    // Local business day ("YYYY-MM-DD") the request was made on. A "pull" is a
    // today-only handover, so the expiry cron closes it once this is no longer today.
    dateLocal: {
      type: String,
      required: true,
    },

    // "push" only: business day ("YYYY-MM-DD") of the SOURCE attendance record the carried
    // check-out lives on. A night shift sits on the record of the day it started, so a
    // transfer made or accepted after midnight continues THAT record, and the request stays
    // acceptable until the carryover window closes (local noon the next day). null on pull
    // requests and on push requests created before this field existed (use dateLocal).
    attendanceDate: {
      type: String,
      default: null,
    },

    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    decidedAt: {
      type: Date,
      default: null,
    },

    // Legacy: stamped by the removed stale-request escalation cron. Admins now see every
    // request in their inbox, so nothing needs escalating; kept so existing docs still load.
    escalatedAt: {
      type: Date,
      default: null,
    },

    note: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
)

// At most one OPEN request per employee — blocks duplicate/competing requests.
transferRequestSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
)

// Fast inbox lookups + the badge count.
// Supervisor inbox is site-based (any supervisor of the deciding site decides): pull
// requests key off fromSite, push requests off toSite. Admins still query by approver
// (self / null), so all these indexes earn their keep.
transferRequestSchema.index({ fromSite: 1, status: 1 })
transferRequestSchema.index({ toSite: 1, status: 1 })
transferRequestSchema.index({ approver: 1, status: 1 })
transferRequestSchema.index({ requestedBy: 1, status: 1 })
// Expiry sweep.
transferRequestSchema.index({ status: 1, dateLocal: 1 })

export default mongoose.model("TransferRequest", transferRequestSchema)
