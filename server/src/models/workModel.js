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

    // Weekly-holiday award: when an employee WORKS on a weekly holiday and puts in
    // at least `weeklyHolidayMinHours` RAW worked hours, they are credited a flat
    // `weeklyHolidayAwardHours` holiday-hour bonus (independent of full/half-day
    // status). Below the minimum, or when disabled, the credit is 0. Public
    // holidays are unaffected (they still credit the day's net worked hours).
    // See computeAttendanceTotals in utils/attendanceMath.js (mirrored in the
    // client's lib/attendanceUtils.ts — keep them in sync).
    weeklyHolidayAwardEnabled: {
      type: Boolean,
      default: true,
    },

    // Flat holiday-hour credit awarded for working the minimum hours on a weekly holiday.
    weeklyHolidayAwardHours: {
      type: Number,
      min: 0,
      max: 24,
      default: 4,
    },

    // Minimum RAW worked hours on a weekly holiday to earn the award.
    weeklyHolidayMinHours: {
      type: Number,
      min: 0,
      max: 26,
      default: 6,
    },

    // NOTE: nightShiftCutoffHour / cutoffHistory were removed with the cutoff redesign.
    // A session's business day is Attendance.date and cross-midnight is an explicit
    // per-session day offset (rawCheckIn/rawCheckOut + checkInNextDay/checkOutNextDay),
    // so no global business-day boundary hour exists any more.

    // Duration of a single break in minutes.
    // Total break deduction = computeAutoBreaks(rawHours, fullDayHours) * breakDurationMinutes / 60
    // (one break per day; see attendanceMath.js). Set to 0 to disable break deductions entirely.
    breakDurationMinutes: {
      type: Number,
      min: 0,
      max: 480,
      default: 60,
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

    // Global default annual PAID-LEAVE entitlement, in working days per calendar
    // year. Applies to every employee unless overridden by Employee.annualLeaveEntitlement.
    // "Used" is never stored — it is derived from paid-leave attendance records
    // (Attendance.isPaidLeave) for the year, so this is purely the allowance.
    annualLeaveDefaultDays: {
      type: Number,
      min: 0,
      default: 30,
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