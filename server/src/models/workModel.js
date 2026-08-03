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

    // OT is paid at this multiple of the employee's normal hourly rate.
    overtimeMultiplier: {
      type: Number,
      required: true,
      min: 0,
      default: 1.25,
    },

    // Hours per month used to derive an employee's normal hourly rate from their
    // monthlySalary: hourlyRate = monthlySalary / monthlyHoursDivisor. Read both of
    // these through utils/payMath.js — the monthly report loads this config with
    // .lean(), which skips these defaults on docs written before the fields existed.
    monthlyHoursDivisor: {
      type: Number,
      required: true,
      min: 1,
      default: 240,
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
    // Total break deduction = floor(rawHours / fullDayHours) * breakDurationMinutes / 60
    // Set to 0 to disable break deductions entirely.
    breakDurationMinutes: {
      type: Number,
      min: 0,
      max: 480,
      default: 60,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "WorkSchedule",
  workScheduleSchema
);