import mongoose from "mongoose"

/**
 * An immutable edit-log entry for a single Attendance record. Attendance docs are
 * touched by many hands and paths (a supervisor submits, another edits sessions, an
 * admin backfills or bulk-checks-out, a cron auto-closes an open shift) and until now
 * there was no trail of who changed a day's record or what changed — the record only
 * carries a single `markedBy`, which several edit paths don't even update. Each row here
 * records one meaningful change: who (a snapshot of the actor's name, so it survives a
 * user rename/delete; `actor` null + `actorName` "System" for cron writes), what
 * (`action` + a human-readable `summary`), and when (`timestamps`).
 *
 * Kept in its OWN collection (never embedded on the Attendance doc) so the hot
 * daily/monthly/report list queries never drag the growing history along — it is fetched
 * only on demand for one record via the compound index below. Rows are append-only and
 * disposable: prune with a TTL/job later if volume ever warrants it.
 */
const attendanceAuditSchema = new mongoose.Schema(
  {
    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
      index: true,
    },

    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },

    // The record's site, denormalized so supervisor-scope checks and filtering don't
    // have to load the Attendance doc.
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
    },

    // The acting user. null = a system/cron write (see actorName).
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Snapshot of the actor's name at write time (so the log still reads after the user
    // is renamed or deleted). "System" for cron/system writes.
    actorName: {
      type: String,
      default: "System",
    },

    type: {
      type: String,
      enum: [
        "submitted", // attendance first saved for the day
        "edited", // sessions/times edited
        "breaks_changed", // supervisor break override changed (shifts net hours/OT)
        "session_added", // a session added to an existing record
        "transferred_in", // a session added via a cross-site transfer
        "backfilled", // a past-day record created after the fact
        "bulk_checkout", // closed via the admin bulk check-out
        "night_shift_assigned", // a night session assigned
        "auto_checkout", // an open shift auto-closed by the system cron
        "default_propagated", // a site default-time change was applied to this record
        "remark_updated", // the supervisor remark was set/changed
      ],
      required: true,
    },

    // The human-readable line shown in the UI (site/time/values baked in as text, so no
    // populate is needed and deleted refs still read).
    summary: {
      type: String,
      required: true,
    },

    // Local business day ("YYYY-MM-DD"), for grouping/filtering alongside the UTC timestamps.
    dateLocal: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
)

// Reverse-chronological history for one attendance record (the on-demand popover fetch).
attendanceAuditSchema.index({ attendance: 1, createdAt: -1 })

export default mongoose.model("AttendanceAudit", attendanceAuditSchema)
