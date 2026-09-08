import mongoose from "mongoose";

// A single grant of annual PAID leave over a from–to range. This is the grant
// LEDGER — the authoritative object for listing history and for cancelling a
// grant exactly. The balance itself is NOT tracked here: "used" days are derived
// by counting paid-leave attendance records (Attendance.isPaidLeave) per calendar
// year, so this ledger and the attendance flags can never silently diverge.
//
// `days` records every working day the grant actually marked (holidays and days
// the employee already worked are skipped and never appear here), plus whether
// that day's Attendance record was newly CREATED by the grant (so cancellation can
// delete it) or an existing absent record CONVERTED to leave (so cancellation just
// clears the flag).
const leaveDaySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    // true  → the grant created a fresh Attendance record for this day
    // false → the grant converted an existing (empty/absent) record
    created: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const leaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "Leave must belong to an employee"],
    },

    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "The admin granting leave must be recorded"],
    },

    // The requested range as entered (inclusive). Both normalized to UTC midnight.
    fromDate: {
      type: Date,
      required: true,
    },

    toDate: {
      type: Date,
      required: true,
    },

    // Free-text reason/note for the grant.
    note: {
      type: String,
      default: "",
      maxlength: 500,
    },

    // Count of working days actually marked (= days.length). Denormalized so the
    // history list needn't expand the days array.
    workingDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    days: {
      type: [leaveDaySchema],
      default: [],
    },

    status: {
      type: String,
      enum: {
        values: ["active", "cancelled"],
        message: "{VALUE} is not a valid leave status",
      },
      default: "active",
    },

    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// History list: an employee's grants, newest first.
leaveSchema.index({ employee: 1, status: 1, createdAt: -1 });

export default mongoose.model("Leave", leaveSchema);
