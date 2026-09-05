import mongoose from "mongoose"

/**
 * A cross-site transfer request: a destination site's supervisor asks the home
 * site's supervisor (the employee's owner) to hand an employee over for TODAY.
 * This is the "Request" lane — a COMPLETE handover of the day, distinct from the
 * source-initiated midday "Transfer" (a second session). See requestController.js.
 *
 * `mode` is chosen by the requester:
 *   - "today"     → a full-day visit at the destination; home currentSite/currentJob
 *                   are untouched (back home tomorrow). Applied via the pendingTransfer*
 *                   stash on the employee (empModel.js), same rails as transferEmployee.
 *   - "permanent" → the employee's home moves to the destination going forward
 *                   (currentSite/currentJob repoint + job membership + supervisor auth).
 *
 * `approver` is a REPRESENTATIVE home-site supervisor kept for display; null means
 * the home site had no supervisor at creation, so the request falls to admins. It is
 * NOT the authorization key — a site may have several supervisors and ANY of them (or
 * an admin) may decide, resolved by fromSite === assignedSite in requestController.
 * Lifecycle:
 *   pending → accepted | rejected | cancelled | expired
 * A partial-unique index enforces at most one pending request per employee.
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

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Home-site supervisor who decides. null → no site supervisor, admins decide.
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
// Supervisor inbox is site-based (any supervisor of the home site decides); admins
// still query by approver (self / null), so both indexes earn their keep.
transferRequestSchema.index({ fromSite: 1, status: 1 })
transferRequestSchema.index({ approver: 1, status: 1 })
transferRequestSchema.index({ requestedBy: 1, status: 1 })
// Expiry sweep.
transferRequestSchema.index({ status: 1, dateLocal: 1 })

export default mongoose.model("TransferRequest", transferRequestSchema)
