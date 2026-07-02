
import mongoose from "mongoose";

const jobTitleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Worker category. 'skilled' = blue-collar field workers (welders, fitters);
    // 'staff' = white-collar office workers. Source of truth for an employee's
    // collarType, which is denormalized onto the Employee at create/edit time.
    collarType: {
      type: String,
      enum: ["skilled", "staff"],
      default: "skilled",
    },
  },
  { timestamps: true }
);

export default mongoose.model("JobTitle", jobTitleSchema);