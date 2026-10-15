import mongoose from "mongoose";

const workScheduleSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      default: "default",
      unique: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Hours required for full-day attendance
    fullDayHours: {
      type: Number,
      required: true,
      min: 1,
      default: 8,
    },

    // Minimum hours required for half-day attendance
    halfDayHours: {
      type: Number,
      required: true,
      min: 1,
      default: 4,
    },

    // Hours after which overtime starts
    overtimeThreshold: {
      type: Number,
      required: true,
      min: 1,
      default: 8,
    },

    weeklyHolidays: {
      type: [String],
      enum: [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
      default: [],
    },

    // NOTE: nightShiftCutoffHour / cutoffHistory were removed with the cutoff redesign.
    // A session's business day is Attendance.date and cross-midnight is an explicit
    // per-session day offset (rawCheckIn/rawCheckOut + checkInNextDay/checkOutNextDay),
    // so no global business-day boundary hour exists any more.

    // Duration of the (single) daily break in minutes. A day deducts at most ONE break
    // (MAX_BREAKS_PER_DAY in attendanceMath.js), so the deduction is 0 or this many
    // minutes. Set to 0 to disable break deductions entirely.
    breakDurationMinutes: {
      type: Number,
      min: 0,
      max: 480,
      default: 60,
    },

    // Minimum RAW hours worked in a day before the automatic break is deducted.
    // null → falls back to fullDayHours (resolveBreakMinHours in attendanceMath.js).
    breakMinHours: {
      type: Number,
      min: 0,
      max: 24,
      default: null,
    },

    // Fallback "HH:mm" local time after which an open session that the
    // auto-checkout cron will NOT close (e.g. a category with no default
    // check-out set) triggers a push reminder to the supervisor. See
    // utils/openSessionAudit.js and cron/checkoutReminder.js. Empty disables the
    // fallback rule (sessions the cron does handle still auto-close as normal).
    checkoutReminderTime: {
      type: String,
      default: "20:00",
    },

    // Minutes of slack after a session's expected auto-checkout time before it is
    // treated as "forgotten" — gives the per-minute auto-checkout cron time to act.
    checkoutReminderGraceMinutes: {
      type: Number,
      min: 0,
      max: 240,
      default: 15,
    },

    // Minutes a manually-edited check-out may run past the employee's category
    // default check-out before a supervisor remark becomes mandatory to save the
    // record. Enforced client-side in EditSiteRecord (see the requiresRemark gate).
    checkoutRemarkGraceMinutes: {
      type: Number,
      min: 0,
      max: 240,
      default: 15,
    },

    // ERPNext export settings. The app holds no rates — these only label the exported
    // Data Import rows so they link to the right ERPNext masters. `erpCompanyName` fills
    // the Company column on the Attendance/Timesheet files; `erpDefaultActivityType` is
    // the Activity Type stamped on every Timesheet time-log (the Activity Cost per
    // employee, and thus the costing rate, lives in ERPNext). See utils/erpnextExport.js.
    erpCompanyName: {
      type: String,
      trim: true,
      // The ERPNext Company master name (link field — must match ERPNext exactly). This
      // differs from the app's printed letterhead ("NEW GULF DESSERT PROJECT LLC").
      default: "New Gulf Desert Projects LLC",
    },

    erpDefaultActivityType: {
      type: String,
      trim: true,
      default: "Construction",
    },

    // ERPNext Activity Type for the OVERTIME portion of a timesheet. When set, the
    // Timesheet export splits each working session into a regular line (erpDefaultActivityType)
    // and an overtime line (this) so ERPNext can cost OT at a premium via its own Activity
    // Cost per employee. Empty → no split (all hours on the regular activity type).
    erpOvertimeActivityType: {
      type: String,
      trim: true,
      default: "",
    },

    // ERPNext Overtime Type (a master) stamped on Attendance rows that carry overtime,
    // alongside actual_overtime_duration = the day's OT hours (a worked holiday's holiday
    // hours). Empty → OT and worked holidays are left off the Attendance export. Set this
    // to a valid Overtime Type from your ERPNext to feed OT into payroll from the same import.
    erpOvertimeType: {
      type: String,
      trim: true,
      default: "",
    },

    // ERPNext Leave Type used for PAID (annual) leave rows in the Attendance export
    // (status "On Leave"). Only paid leave maps to On Leave; sick/LOP are unpaid → Absent.
    // Must match a Leave Type master in ERPNext.
    erpPaidLeaveType: {
      type: String,
      trim: true,
      default: "Annual Leave",
    },

    // Rate multiplier of every activity type's automatic OVERTIME twin (Activity Types page):
    // twin rates = the type's costing/billing rate × this. Derived on read, so changing it
    // re-rates every twin at once (re-import the master CSV into ERPNext afterwards).
    // Superadmin-only to change. See utils/activityTypes.js.
    overtimeActivityMultiplier: {
      type: Number,
      min: 1,
      max: 5,
      default: 1.25,
    },

    // Mirrors ERPNext Payroll Settings → "Consider Unmarked Attendance As". A day with no
    // attendance record at all (up to yesterday; holidays excluded except for temporary
    // workers) is never in the ERPNext CSV, so ERPNext applies its own rule to it. true
    // (Absent) → the monthly report and the employee timesheet deduct those days from
    // Payment Days as plain absences; false (Present) → they count as paid. Read it as
    // `!== false` (utils/unmarkedDays.js) so config docs that predate the field are ON.
    countUnmarkedAsAbsent: {
      type: Boolean,
      default: true,
    },

    // Monetary penalty (in OMR) attached to a Loss-of-Pay (LOP) day. When a
    // supervisor toggles an absent record to LOP (Attendance.isLop), the record's
    // remark is auto-filled with "Deduct <lopDeductionAmount> OMR". Purely an
    // annotation surfaced in the timesheet — there is no pay/money logic that
    // consumes it. Change the amount here without a code change.
    lopDeductionAmount: {
      type: Number,
      min: 0,
      default: 3.5,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "WorkSchedule",
  workScheduleSchema
);