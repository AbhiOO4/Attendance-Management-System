import mongoose from "mongoose"

/**
 * An append-only, per-site, per-day activity feed for employee MOVEMENTS — the site-level
 * counterpart to the per-record AttendanceAudit. It answers "what happened at this site on
 * this day, and who did it": transfer requests sent/decided, direct midday transfers,
 * source "send to site" pushes, and employees added/removed from the roster.
 *
 * A transfer touches two sites, so each event stores fromSiteId/toSiteId (single-site events
 * like add/remove use siteId). A site's daily feed matches any of the three site fields, so a
 * move shows in BOTH the losing and the gaining site's log. Each row is an immutable
 * point-in-time event (a request being accepted is a new row, not an edit of the "sent" row),
 * with snapshots of the actor and employee names so it reads without populate and survives
 * later renames/deletes. `actor` null + `actorName` "System" for cron writes (e.g. expiry).
 *
 * Kept in its own collection, fetched on demand by { dateLocal, site } — never on the hot
 * attendance list/report paths. Disposable/prunable like the Notification feed.
 */
const siteActivitySchema = new mongoose.Schema(
  {
    // Movement endpoints. Transfers set from/to; single-site events set siteId.
    fromSiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
    },
    toSiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
    },

    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    employeeName: {
      type: String,
      default: "",
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorName: {
      type: String,
      default: "System",
    },

    type: {
      type: String,
      enum: [
        "request_sent", // a transfer request was created
        "request_accepted", // a request was accepted (employee handed over)
        "request_rejected", // a request was rejected
        "request_cancelled", // the requester cancelled it
        "request_expired", // the expiry cron closed a stale request
        "transfer_today", // direct same-day visit transfer (transferEmployee, onlyForToday)
        "transfer_permanent", // direct permanent move (transferEmployee)
        "sent_to_site", // source-initiated "send to site" push
        "employee_added", // added to this site's roster
        "employee_removed", // removed from this site's roster
        "scheduled_removal", // deferred removal scheduled for a future day
      ],
      required: true,
    },

    // Human-readable line (site names baked in as text, so no populate needed on read).
    summary: {
      type: String,
      required: true,
    },

    // Local business day ("YYYY-MM-DD") the event belongs to — the feed's primary filter.
    dateLocal: {
      type: String,
      default: "",
      index: true,
    },
  },
  { timestamps: true }
)

// A site's daily feed matches any of the three site roles for one business day.
siteActivitySchema.index({ dateLocal: 1, siteId: 1 })
siteActivitySchema.index({ dateLocal: 1, fromSiteId: 1 })
siteActivitySchema.index({ dateLocal: 1, toSiteId: 1 })

export default mongoose.model("SiteActivity", siteActivitySchema)
