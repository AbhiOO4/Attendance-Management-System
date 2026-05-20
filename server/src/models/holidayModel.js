import mongoose from "mongoose";

const customHolidaySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },

    reason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

customHolidaySchema.index({ date: 1 });

export default mongoose.model("CustomHoliday", customHolidaySchema);