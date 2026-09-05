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
 *                   (currentSite/currentJob repoint + job membership + supervisor auth).
 *
 * `carriedCheckIn` is set only for a "push": the source check-out snapshotted at
 * request time, replayed as the destination check-in when the request is accepted.
 *
 * `approver` is a REPRESENTATIVE supervisor of the DECIDING site kept for display; null
 * means that site had no supervisor at creation, so the request falls to admins. It is
 * NOT the authorization key — a site may have several supervisors and ANY of them (or
 * an admin) may decide, resolved by the deciding site === assignedSite in requestController.
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

    // "push" only: the source check-out carried forward as the destination check-in
    // when the request is accepted (a midday second session). null for "pull".
    carriedCheckIn: {
      type: Date,
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

    // Local business day ("YYYY-MM-DD") the request targets. Requests are a
    // today-only setup action, so the expiry cron closes anything not from today.
    dateLocal: {
      type: String,
      required: true,
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
