import mongoose from "mongoose";

// An ANNUAL (paid) leave allocation: `days` of annual leave an employee may take
// between fromDate and toDate (both inclusive, UTC midnight). This is the only
// source of annual-leave allowance — an employee with no allocation covering a day
// cannot take annual leave on it. Emergency leave is unpaid and uncapped, so it
// needs no allocation.
//
// One employee's allocations never overlap (enforced by the allocation endpoints),
// so every annual-leave day belongs to at most one allocation. "Used" is NOT stored:
// it is derived by counting Attendance.isPaidLeave records inside the range (see
// utils/leaveBalance.js), exactly like the old per-year balance.
const leaveAllocationSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: [true, "An allocation must belong to an employee"],
    },

    fromDate: {
      type: Date,
      required: true,
    },

    toDate: {
      type: Date,
      required: true,
    },

    // Annual leave days allocated for the period.
    days: {
      type: Number,
      required: true,
      min: 0,
    },

    note: {
      type: String,
      default: "",
      maxlength: 500,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

leaveAllocationSchema.index({ employee: 1, fromDate: 1 });

export default mongoose.model("LeaveAllocation", leaveAllocationSchema);
