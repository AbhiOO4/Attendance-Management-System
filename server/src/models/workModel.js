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
  },
  { timestamps: true }
);

export default mongoose.model(
  "WorkSchedule",
  workScheduleSchema
);