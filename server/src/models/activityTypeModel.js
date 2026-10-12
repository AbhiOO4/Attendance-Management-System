import mongoose from "mongoose"

/**
 * An ERPNext Activity Type (a costing/billing rate band) that employees are allocated to.
 *
 * The timesheet export stamps the employee's allocated type on their time-logs, so ERPNext
 * costs each job at that type's default rates with no per-employee Activity Cost. Every type
 * has an OVERTIME twin that is never stored: its name is `overtimeNameFor(name)` and its rates
 * are these × WorkSchedule.overtimeActivityMultiplier (utils/activityTypes.js). The rates are
 * ERPNext master data only — nothing in AMS computes with them.
 *
 * `name` is the ERPNext link key, so it is fixed after create; only the rates can be edited.
 */
const activityTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Activity type name is required"],
      trim: true,
      unique: true,
    },

    costingRate: {
      type: Number,
      required: [true, "Costing rate is required"],
      min: 0,
    },

    billingRate: {
      type: Number,
      required: [true, "Billing rate is required"],
      min: 0,
    },
  },
  { timestamps: true }
)

export default mongoose.model("ActivityType", activityTypeSchema)
