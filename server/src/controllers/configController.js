import workModel from '../models/workModel.js'
import holidayModel from '../models/holidayModel.js';
import siteModel from '../models/siteModel.js';
import {
  DEFAULT_OVERTIME_MULTIPLIER,
  DEFAULT_MONTHLY_HOURS_DIVISOR,
} from '../utils/payMath.js';

/**
 * Backfill the relative-OT pay fields onto a config that predates them, and drop the
 * flat overtimeRatePerHour they replaced.
 *
 * Idempotent — called on boot. Not merely defensive: monthlyReport reads the config with
 * .lean(), which returns raw BSON and therefore SKIPS the schema defaults. Without this
 * write, a doc saved before these fields existed makes every overtimePay NaN.
 */
export const ensureOvertimePayFields = async () => {
  // Raw driver read, deliberately: Mongoose strips fields absent from the schema when it
  // hydrates, which would hide the legacy overtimeRatePerHour we need to detect here.
  const raw = await workModel.collection.findOne({ type: "default" });
  if (!raw) return;

  const missing = {};
  if (typeof raw.overtimeMultiplier !== "number") {
    missing.overtimeMultiplier = DEFAULT_OVERTIME_MULTIPLIER;
  }
  if (typeof raw.monthlyHoursDivisor !== "number") {
    missing.monthlyHoursDivisor = DEFAULT_MONTHLY_HOURS_DIVISOR;
  }

  // Dropping a field from the schema does not remove it from stored docs — unset it so
  // the collection matches the schema.
  const hasLegacyRate = raw.overtimeRatePerHour !== undefined;

  if (Object.keys(missing).length === 0 && !hasLegacyRate) return;

  const update = {};
  if (Object.keys(missing).length > 0) update.$set = missing;
  if (hasLegacyRate) update.$unset = { overtimeRatePerHour: "" };

  await workModel.collection.updateOne({ _id: raw._id }, update);

  const changes = Object.entries(missing).map(([k, v]) => `${k}=${v}`);
  if (hasLegacyRate) changes.push("dropped overtimeRatePerHour");
  console.log(`[Config] Relative-OT pay migration: ${changes.join(", ")}`);
};

export const getWorkSchedule = async (req, res) => {
  try {

    const schedule = await workModel.findOne({ type: "default" });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Work schedule not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch work schedule",
      error,
    });
  }
};

export const updateWorkSchedule = async (req, res) => {
  try {
    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
      overtimeMultiplier,
      monthlyHoursDivisor,
      weeklyHolidays,
      nightShiftCutoffHour,
      breakDurationMinutes,
    } = req.body;


    const schedule = await workModel.findOne({
      type: "default",
    });

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Work schedule not found",
      });
    }

    // Update only provided fields

    if (fullDayHours !== undefined) {
      schedule.fullDayHours = fullDayHours;
    }

    if (halfDayHours !== undefined) {
      schedule.halfDayHours = halfDayHours;
    }

    if (overtimeThreshold !== undefined) {
      schedule.overtimeThreshold =
        overtimeThreshold;
    }

    if (overtimeMultiplier !== undefined) {
      if (!Number.isFinite(Number(overtimeMultiplier)) || Number(overtimeMultiplier) < 0) {
        return res.status(400).json({
          success: false,
          message: "Overtime multiplier must be a number of 0 or more",
        });
      }
      schedule.overtimeMultiplier = Number(overtimeMultiplier);
    }

    if (monthlyHoursDivisor !== undefined) {
      // A 0 divisor would make every hourly rate Infinity.
      if (!Number.isFinite(Number(monthlyHoursDivisor)) || Number(monthlyHoursDivisor) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Monthly hours divisor must be greater than 0",
        });
      }
      schedule.monthlyHoursDivisor = Number(monthlyHoursDivisor);
    }

    if (weeklyHolidays !== undefined) {
      schedule.weeklyHolidays =
        weeklyHolidays;
    }

    // The night-shift cutoff hour no longer exists: cross-midnight is recorded per session
    // as an explicit day offset. An incoming nightShiftCutoffHour is deliberately IGNORED —
    // not rejected — so stale PWA clients that still send it can keep saving other fields.
    void nightShiftCutoffHour;

    if (breakDurationMinutes !== undefined) {
      if (breakDurationMinutes < 0 || breakDurationMinutes > 480) {
        return res.status(400).json({
          success: false,
          message: "Break duration must be between 0 and 480 minutes",
        });
      }
      schedule.breakDurationMinutes = breakDurationMinutes;
    }

    // Optional validation
    if (
      schedule.halfDayHours >
      schedule.fullDayHours
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Half day hours cannot exceed full day hours",
      });
    }

    if (
      schedule.overtimeThreshold <
      schedule.fullDayHours
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Overtime threshold cannot be less than full day hours",
      });
    }

    const updatedSchedule =
      await schedule.save();

    return res.status(200).json({
      success: true,
      message: "Work schedule updated successfully",
      data: updatedSchedule,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Failed to update work schedule",
      error: error.message,
    });
  }
};

export const addCustomHoliday = async (req, res) => {
  try {
    const { date, reason } = req.body;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const holiday = await holidayModel.create({
      date,
      reason,
    });

    return res.status(201).json({
      success: true,
      message: "Custom holiday added successfully",
      data: holiday,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to add custom holiday",
      error,
    });
  }
};

export const deleteCustomHoliday = async (req, res) => {
  try {
    const { holidayId } = req.params;

    if (!holidayId) {
      return res.status(400).json({
        success: false,
        message: "Holiday ID is required",
      });
    }

    const deletedHoliday = await holidayModel.findByIdAndDelete(holidayId);

    if (!deletedHoliday) {
      return res.status(404).json({
        success: false,
        message: "Custom holiday not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Custom holiday deleted successfully",
      data: deletedHoliday,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete custom holiday",
      error,
    });
  }
};

export const getAllHolidays = async (req, res) => {
  try {
    let { month, year } = req.query;

    const currentDate = new Date();

    // Default to current month/year if not provided
    month = month ? parseInt(month) : currentDate.getMonth() + 1;
    year = year ? parseInt(year) : currentDate.getFullYear();

    if (month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid month value",
      });
    }

    // Build date range for the month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const holidays = await holidayModel.find({
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).sort({ date: 1 });

    return res.status(200).json({
      success: true,
      message: "Holidays fetched successfully",
      data: holidays,
      meta: {
        month,
        year,
        count: holidays.length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch holidays",
      error,
    });
  }
};

export const isHoliday = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    // Normalize date range (start -> end of day)
    const targetDate = new Date(date);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const holiday = await holidayModel.findOne({
      date: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });

    // Holiday exists
    if (holiday) {
      return res.status(200).json({
        success: true,
        isHoliday: true,
        reason: holiday.reason,
      });
    }

    // No holiday
    return res.status(200).json({
      success: true,
      isHoliday: false,
      reason: null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to check holiday",
      error,
    });
  }
};

const configController = {
    getWorkSchedule,
    addCustomHoliday,
    deleteCustomHoliday,
    getAllHolidays,
    updateWorkSchedule,
    isHoliday,
    ensureOvertimePayFields

}

export default configController