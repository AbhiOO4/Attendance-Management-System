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

    // OT pay rate per hour
    overtimeRatePerHour: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
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

    // Hour (0-12) when the "logical business day" ends.
    // Times before this cutoff are treated as belonging to the previous day.
    // Mirrors the currently-active entry of cutoffHistory. Read it through
    // getCurrentCutoff()/resolveCutoffForDate() (utils/cutoff.js), never directly:
    // a record must be interpreted with the cutoff in force on ITS OWN business day.
    nightShiftCutoffHour: {
      type: Number,
      required: true,
      min: 0,
      max: 12,
      // 0 = midnight: plain calendar days. Machine-managed mirror — real values come from
      // cutoffHistory via getCurrentCutoff(); pre-migration deployments carry their own
      // stored value (historically 7).
      default: 0,
    },

    // Effective-dated history of the cutoff hour, ascending by effectiveFrom.
    // Append-only: a change takes effect from tomorrow's business day, so records already
    // written keep the cutoff their stored check-in/out Dates were combined with.
    cutoffHistory: {
      type: [
        {
          cutoffHour: {
            type: Number,
            required: true,
            min: 0,
            max: 12,
          },
          // UTC-midnight of the first business day this cutoff applies to.
          effectiveFrom: {
            type: Date,
            required: true,
          },
          _id: false,
        },
      ],
      default: [],
    },

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