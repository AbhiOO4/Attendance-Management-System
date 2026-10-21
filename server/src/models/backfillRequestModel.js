import mongoose from "mongoose";

// A supervisor's BACKFILL REQUEST for one site + one past business day: the records they
// missed, drafted here and sent to an admin for approval. A driver supervisor's document sits
// on the hidden Drivers pool site (their assignedSite) and its sessions carry a job split. Nothing reaches `attendances`
// until an admin approves (controllers/backfillRequestController.js), which then creates
// one record per row via utils/backfillRecord.js.
//
// Lifecycle: draft → submitted → approved, or submitted → rejected → (edited) → submitted.
// Only a draft/rejected document is editable by the supervisor; only a submitted one by an
// admin. Once submitted or approved, the supervisor can no longer backfill that site/day.
//
// Times are stored as the Attendance source of truth is: raw "HH:mm" + explicit day offsets
// from `date`. Dates are derived only at approval (combineFromOffset).

const MAX_BREAKS_PER_DAY = 1;

const backfillSessionSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
    // Drivers pool documents only (utils/jobSplit.js): the site the driver served (null =
    // "General", global jobs) and the jobs its hours are split equally across; jobId stays null.
    servedSiteId: { type: mongoose.Schema.Types.ObjectId, ref: "Site", default: null },
    splitJobIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Job" }], default: [] },
    checkIn: { type: String, required: true }, // "HH:mm"
    checkOut: { type: String, required: true }, // "HH:mm"
    checkInNextDay: { type: Boolean, default: false },
    checkOutNextDay: { type: Boolean, default: false },
  },
  { _id: false }
);

const backfillRowSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    sessions: { type: [backfillSessionSchema], default: [] },
    // null = automatic (computeAutoBreaks); 0/1 = supervisor override, clamped like Attendance.
    breaksTaken: {
      type: Number,
      default: null,
      set: (v) =>
        v === null || v === undefined || v === "" ? null : Math.min(Math.max(Math.round(Number(v)) || 0, 0), MAX_BREAKS_PER_DAY),
    },
    // The employee was not on this site's current roster when added (picked from "recently
    // at your site" or a search) — flagged so the admin looks twice at review.
    offRoster: { type: Boolean, default: false },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Set by the approval: what happened to this row.
    outcome: { type: String, enum: ["created", "skipped", "failed", null], default: null },
    outcomeMessage: { type: String, default: "" },
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: "Attendance", default: null },
  },
  { _id: false }
);

const backfillRequestSchema = new mongoose.Schema(
  {
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    // Business day at UTC midnight (same convention as Attendance.date).
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected"],
      default: "draft",
    },
    rows: { type: [backfillRowSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: "" },
    // Once rejected, the supervisor may fix and resubmit even after the window has passed.
    wasRejected: { type: Boolean, default: false },

    approvalSummary: {
      createdCount: { type: Number, default: 0 },
      skippedCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
    },
  },
  // Every save checks __v, so two devices editing one document can't overwrite each other.
  { timestamps: true, optimisticConcurrency: true }
);

backfillRequestSchema.index({ siteId: 1, date: 1 }, { unique: true });
backfillRequestSchema.index({ status: 1, date: -1 });
backfillRequestSchema.index({ date: 1, "rows.employee": 1 });

export default mongoose.model("BackfillRequest", backfillRequestSchema);
