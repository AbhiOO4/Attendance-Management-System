import mongoose from "mongoose";

// One employee's TIMESHEET APPROVAL for one calendar month — the gate every per-employee
// export checks (ERPNext CSVs, the summary and timesheet spreadsheets). See
// utils/timesheetApproval.js (blockers, fingerprint) and utils/timesheetMonth.js (status).
//
// No document, or status "revoked", means NOT approved. `fingerprint` is the content hash of
// the month's records at approval time: when the records no longer hash the same (ANY write
// path — an edit, a backfill, a cron, a recalc script), the approval is auto-revoked the next
// time it is read (revokeReason "records_changed").

const historySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["approved", "revoked", "auto_revoked"],
      required: true,
    },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const timesheetApprovalSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },

    status: {
      type: String,
      enum: ["approved", "revoked"],
      required: true,
    },

    fingerprint: { type: String, default: null },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },

    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedByName: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    revokeReason: {
      type: String,
      enum: ["manual", "records_changed", null],
      default: null,
    },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

timesheetApprovalSchema.index({ employee: 1, year: 1, month: 1 }, { unique: true });
timesheetApprovalSchema.index({ year: 1, month: 1 });

const TimesheetApproval = mongoose.model("TimesheetApproval", timesheetApprovalSchema);

export default TimesheetApproval;
