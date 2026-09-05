import mongoose from "mongoose";
import { deriveRawOffsetFields } from "../utils/timeLocal.js";

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

    // Absolute UTC instants. As of the cutoff redesign these are a DERIVED CACHE
    // recomputed from date + raw{CheckIn,CheckOut} + {checkIn,checkOut}NextDay on
    // every write; the raw fields + offsets below are the source of truth. Kept
    // because sorting / overlap / hours math read an absolute instant.
    checkIn: {
      type: Date,
    },

    checkOut: {
      type: Date,
    },

    // Source of truth (cutoff redesign): the times exactly as entered ("HH:mm"),
    // plus a per-endpoint day offset from the record's business day (Attendance.date).
    // A punch is on `date` when its NextDay flag is false, or on `date + 1` when true.
    // This makes cross-midnight an explicit fact instead of inferring it from a
    // global cutoff hour. Optional during migration; populated on every write.
    rawCheckIn: {
      type: String,
      default: null,
    },

    rawCheckOut: {
      type: String,
      default: null,
    },

    checkInNextDay: {
      type: Boolean,
      default: false,
    },

    checkOutNextDay: {
      type: Boolean,
      default: false,
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

    // Why the day is a holiday: a recurring weekly holiday (WorkSchedule.weeklyHolidays)
    // or a one-off public holiday (CustomHoliday, incl. manually declared days).
    // Only meaningful when isHoliday is true; null otherwise.
    holidayReason: {
      type: String,
      enum: {
        values: ["weekly", "public"],
        message: "{VALUE} is not a valid holiday reason",
      },
      default: null,
    },

    // Hours credited for working on a holiday (paid at the OT rate by the
    // monthly report). public → net worked hours; weekly → flat 15 (fullday)
    // or 10 (halfday). Always 0 when isHoliday is false.
    holidayHours: {
      type: Number,
      default: 0,
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
    // null  → auto-computed by computeAutoBreaks(rawHours, fullDayHours) via
    //         computeAttendanceTotals (one break per day; see attendanceMath.js).
    // 0+    → supervisor override (e.g. skipped one break out of two due).
    breaksTaken: {
      type: Number,
      default: null,
      min: 0,
    },

    // Free-text supervisor remark for this day's record ("left early — family
    // emergency"). A single editable note (overwrite-in-place); every change is captured
    // in the AttendanceAudit log, so the remark's own history survives. Length-capped so
    // it stays cheap to carry on record reads.
    remark: {
      type: String,
      default: "",
      maxlength: 500,
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

  // Cutoff redesign — stamp each session's source-of-truth raw times + day offsets
  // from its already-computed absolute Dates + this record's business day. Derived
  // from the Dates so it stays consistent with whatever produced them, and — like the
  // sick-leave invariant above — covers every write path because they all go through
  // .save(). (Phase 4 inverts this: raw+offset become the input and Dates the output.)
  if (Array.isArray(this.sessions)) {
    for (const s of this.sessions) {
      if (!s) continue;
      const { rawCheckIn, rawCheckOut, checkInNextDay, checkOutNextDay } =
        deriveRawOffsetFields(this.date, s.checkIn, s.checkOut);
      s.rawCheckIn = rawCheckIn;
      s.rawCheckOut = rawCheckOut;
      s.checkInNextDay = checkInNextDay;
      s.checkOutNextDay = checkOutNextDay;
    }
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
