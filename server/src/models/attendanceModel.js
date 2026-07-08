import mongoose from "mongoose";

const attendanceSessionSchema = new mongoose.Schema(
  {
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: [true, "Site ID is required"],
    },

    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },

    checkIn: {
      type: Date,
    },

    checkOut: {
      type: Date,
    },

    workedHours: {
      type: Number,
      default: 0,
    },

    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "The supervisor/admin marking attendance must be recorded"],
    },

    // When true, AM times (before cutoff) are treated as next-day
    isNightShift: {
      type: Boolean,
      default: false,
    },

    // Source site this session was transferred in from. Set when a transfer
    // (or a consumed pending transfer) lands this session at its destination
    // site. Powers the "Transferred from <Site>" indicator on the destination
    // site's attendance page. Null for normal (non-transfer) sessions.
    transferredFromSiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
    },

    // True when a supervisor explicitly cleared this session's times (the
    // "Absent" button / manual empty). Distinguishes "deliberately absent"
    // from "empty because the site had no default yet", so a later
    // empty→time default change never refills a deliberate absence.
    // Reset to false whenever a check-in is set by any path.
    manuallyCleared: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "Attendance must belong to an employee"],
    },

    // Primary/default site reference (optional but useful)
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: [true, "Site ID is required"],
    },

    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
    },

    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "The supervisor/admin marking attendance must be recorded"],
    },

    date: {
      type: Date,
      required: [true, "Date is required"],
    },

    status: {
      type: String,
      enum: {
        values: ["fullday", "halfday", "absent"],
        message: "{VALUE} is not a valid status",
      },
      required: true,
    },

    // Marks if the day is a holiday
    isHoliday: {
      type: Boolean,
      default: false,
    },

    // Marks the day as sick leave. Purely an annotation of *why* an absent
    // day is absent — it has no effect on pay. Enforced invariant (see the
    // pre-save hook below): can only be true when every session is empty
    // (no checkIn/checkOut). Any filled session forces this back to false.
    isSickLeave: {
      type: Boolean,
      default: false,
    },

    // Total worked hours across all sessions
    totalWorkHours: {
      type: Number,
      default: 0,
    },

    overtimeHours: {
      type: Number,
      default: 0,
    },

    // Night shift tracking
    shiftType: {
      type: String,
      enum: ["day", "night", "flexible"],
      default: "day",
    },

    crossedMidnight: {
      type: Boolean,
      default: false,
    },

    // Multi-site work sessions
    sessions: {
      type: [attendanceSessionSchema],
      default: [],
    },

    // Number of breaks the employee actually took.
    // null  → auto-computed as floor(totalWorkHours / fullDayHours) at save time.
    // 0+    → supervisor override (e.g. skipped one break out of two due).
    breaksTaken: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// INVARIANT: sick leave is only valid when the whole day has no worked
// sessions. If any session has a check-in or check-out (this site or another),
// sick leave is force-cleared. This is the single source of truth for the rule
// and covers every write path (submit, edit, inline, backfill, recalc, crons)
// since they all go through .save().
attendanceSchema.pre("save", async function () {
  if (
    this.isSickLeave &&
    Array.isArray(this.sessions) &&
    this.sessions.some((s) => s && (s.checkIn || s.checkOut))
  ) {
    this.isSickLeave = false;
  }
});

// Prevent duplicate attendance per employee per day
attendanceSchema.index(
  { employee: 1, date: 1 },
  { unique: true }
);

attendanceSchema.index({date: 1});

// Useful for site/day queries
attendanceSchema.index({ siteId: 1, date: 1 });

// Useful for querying temporary workers by session site
attendanceSchema.index({"sessions.siteId": 1, date: 1});

export default mongoose.model("Attendance", attendanceSchema);
