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
  },
  { timestamps: true }
);

export default mongoose.model(
  "WorkSchedule",
  workScheduleSchema
);