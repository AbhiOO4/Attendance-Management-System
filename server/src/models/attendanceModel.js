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

    // Drivers only (sessions on the Drivers pool, utils/driverPool.js): the session is logged
    // against a SITE and its hours are split EQUALLY across `splitJobIds` — jobs of
    // `servedSiteId`, or global jobs when `servedSiteId` is null (the "General" place). Both
    // are set by the server from the jobs (utils/jobSplit.js resolveDriverSplit); `jobId` is
    // null on such a session. A session's jobs are `splitJobIds` when non-empty, else
    // `[jobId]` — always read them through sessionJobIds().
    servedSiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      default: null,
    },

    splitJobIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Job" }],
      default: [],
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

    // Hours credited for working on a holiday (any holiday, public or weekly):
    // the day's net worked hours. Always 0 when isHoliday is false.
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

    // Marks the day as approved annual PAID leave (granted over a from–to range;
    // see the leave endpoints in attendanceController.js). Like isSickLeave it is a
    // whole-day annotation on an otherwise-absent day, but unlike sick leave the
    // monthly report credits it as a PAYABLE day (it does not lower attendance %).
    // Same invariant (pre-save hook): only valid when every session is empty, and
    // mutually exclusive with isSickLeave (paid leave wins). Each paid-leave record
    // is one day of the employee's annual balance; "used" is derived by counting
    // these records per calendar year rather than stored anywhere.
    isPaidLeave: {
      type: Boolean,
      default: false,
    },

    // Marks the day as EMERGENCY leave — an EXCUSED but UNPAID absence (like sick
    // leave), granted by an admin over a from–to range through the same leave
    // endpoints as annual leave (Leave.type = "emergency"). It has no balance and is
    // not a payable day: the record keeps status "absent", so the monthly report and
    // the ERPNext export treat it like sick leave. Like paid leave, a granted day is
    // LOCKED against marking until the grant is cancelled. Same invariant (pre-save
    // hook): only valid when every session is empty. Precedence: paid > emergency >
    // sick > lop.
    isEmergencyLeave: {
      type: Boolean,
      default: false,
    },

    // Marks the day as LOP (Loss of Pay) — an UNEXCUSED absence that carries a
    // monetary penalty (the sister of isSickLeave, which is an EXCUSED absence).
    // Like sick/paid leave it is a whole-day annotation on an otherwise-absent day
    // and obeys the same invariant (pre-save hook): only valid when every session
    // is empty; any filled session forces it back to false. Mutually exclusive with
    // both isSickLeave and isPaidLeave (precedence: paid > sick > lop). It has no
    // effect on the monthly report (a LOP day is an unpaid absent day, same as sick);
    // the "Deduct <amount> OMR" penalty lives in the record's `remark`, auto-filled
    // by the controller when this is toggled on.
    isLop: {
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

    // Number of breaks the employee actually took — 0 or 1 (a day has at most one).
    // null  → auto-computed by computeAutoBreaks(rawHours, breakMinHours) via
    //         computeAttendanceTotals (see attendanceMath.js).
    // 0 / 1 → supervisor override (e.g. skipped the break).
    // The setter clamps new writes to 1; it does not run on hydration, so a legacy
    // stored 2+ is left as-is (computeAttendanceTotals clamps it when recomputed).
    // No schema `max` for the same reason — it would fail those legacy docs' next save.
    breaksTaken: {
      type: Number,
      default: null,
      min: 0,
      set: (v) => (v === null || v === undefined ? v : Math.min(v, 1)),
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
  const hasFilledSession =
    Array.isArray(this.sessions) &&
    this.sessions.some((s) => s && (s.checkIn || s.checkOut));

  if (this.isSickLeave && hasFilledSession) {
    this.isSickLeave = false;
  }

  // Paid leave obeys the same "no worked session" invariant as sick leave, and
  // the two are mutually exclusive — a day marked as paid leave is never also
  // sick leave (paid leave wins).
  if (this.isPaidLeave && hasFilledSession) {
    this.isPaidLeave = false;
  }
  if (this.isPaidLeave && this.isSickLeave) {
    this.isSickLeave = false;
  }

  // Emergency leave: same "no worked session" invariant. Paid leave outranks it, and
  // it outranks sick leave (both are excused absences; the granted one wins).
  if (this.isEmergencyLeave && hasFilledSession) {
    this.isEmergencyLeave = false;
  }
  if (this.isPaidLeave && this.isEmergencyLeave) {
    this.isEmergencyLeave = false;
  }
  if (this.isEmergencyLeave && this.isSickLeave) {
    this.isSickLeave = false;
  }

  // LOP (Loss of Pay) obeys the same "no worked session" invariant and is mutually
  // exclusive with both other leave annotations. Precedence is paid > sick > lop, so
  // a conflict clears LOP. The controller sets the counterpart to false explicitly on
  // every toggle, so this tie-break only guards against inconsistent data reaching save.
  if (this.isLop && hasFilledSession) {
    this.isLop = false;
  }
  if ((this.isPaidLeave || this.isEmergencyLeave) && this.isLop) {
    this.isLop = false;
  }
  if (this.isSickLeave && this.isLop) {
    this.isLop = false;
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
