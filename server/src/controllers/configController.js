import workModel from '../models/workModel.js'
import holidayModel from '../models/holidayModel.js';
import siteModel from '../models/siteModel.js';
import { getFeatures } from '../utils/features.js';
import { MIN_OVERTIME_MULTIPLIER, MAX_OVERTIME_MULTIPLIER } from '../utils/activityTypes.js';
import { MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS } from '../utils/backfillWindow.js';

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
      // Runtime feature switches (utils/features.js) — clients read them here.
      features: getFeatures(),
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
      weeklyHolidays,
      nightShiftCutoffHour,
      breakDurationMinutes,
      breakMinHours,
      checkoutReminderTime,
      checkoutReminderGraceMinutes,
      checkoutRemarkGraceMinutes,
      lopDeductionAmount,
      erpCompanyName,
      erpDefaultActivityType,
      erpOvertimeActivityType,
      erpOvertimeType,
      erpPaidLeaveType,
      countUnmarkedAsAbsent,
      overtimeActivityMultiplier,
      supervisorBackfillWindowDays,
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

    if (breakMinHours !== undefined) {
      // null / "" resets to the fallback (fullDayHours); otherwise 0 < hours ≤ 24.
      if (breakMinHours === null || breakMinHours === "") {
        schedule.breakMinHours = null;
      } else {
        const hours = Number(breakMinHours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
          return res.status(400).json({
            success: false,
            message: "Break threshold must be more than 0 and at most 24 hours",
          });
        }
        schedule.breakMinHours = hours;
      }
    }

    if (checkoutReminderTime !== undefined) {
      // Empty string disables the fallback reminder; otherwise require HH:mm.
      if (checkoutReminderTime !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(checkoutReminderTime)) {
        return res.status(400).json({
          success: false,
          message: "Checkout reminder time must be in HH:mm format",
        });
      }
      schedule.checkoutReminderTime = checkoutReminderTime;
    }

    if (checkoutReminderGraceMinutes !== undefined) {
      if (checkoutReminderGraceMinutes < 0 || checkoutReminderGraceMinutes > 240) {
        return res.status(400).json({
          success: false,
          message: "Checkout reminder grace must be between 0 and 240 minutes",
        });
      }
      schedule.checkoutReminderGraceMinutes = checkoutReminderGraceMinutes;
    }

    if (checkoutRemarkGraceMinutes !== undefined) {
      if (checkoutRemarkGraceMinutes < 0 || checkoutRemarkGraceMinutes > 240) {
        return res.status(400).json({
          success: false,
          message: "Check-out remark grace must be between 0 and 240 minutes",
        });
      }
      schedule.checkoutRemarkGraceMinutes = checkoutRemarkGraceMinutes;
    }

    if (lopDeductionAmount !== undefined) {
      if (lopDeductionAmount < 0 || lopDeductionAmount > 10000) {
        return res.status(400).json({
          success: false,
          message: "LOP deduction amount must be between 0 and 10000 OMR",
        });
      }
      schedule.lopDeductionAmount = lopDeductionAmount;
    }

    // ERPNext export labels (free text; no rate logic). Empty string is allowed —
    // the export falls back to its built-in defaults when a field is blank.
    if (erpCompanyName !== undefined) {
      schedule.erpCompanyName = String(erpCompanyName).trim();
    }

    if (erpDefaultActivityType !== undefined) {
      schedule.erpDefaultActivityType = String(erpDefaultActivityType).trim();
    }

    if (erpOvertimeActivityType !== undefined) {
      schedule.erpOvertimeActivityType = String(erpOvertimeActivityType).trim();
    }

    if (erpOvertimeType !== undefined) {
      schedule.erpOvertimeType = String(erpOvertimeType).trim();
    }

    if (erpPaidLeaveType !== undefined) {
      schedule.erpPaidLeaveType = String(erpPaidLeaveType).trim();
    }

    // Activity-type overtime twin multiplier (admin + superadmin, like the Activity Types page).
    if (overtimeActivityMultiplier !== undefined) {
      const m = Number(overtimeActivityMultiplier);
      if (
        overtimeActivityMultiplier === null ||
        overtimeActivityMultiplier === "" ||
        !Number.isFinite(m) ||
        m < MIN_OVERTIME_MULTIPLIER ||
        m > MAX_OVERTIME_MULTIPLIER
      ) {
        return res.status(400).json({
          success: false,
          message: `Overtime activity multiplier must be between ${MIN_OVERTIME_MULTIPLIER} and ${MAX_OVERTIME_MULTIPLIER}`,
        });
      }
      schedule.overtimeActivityMultiplier = m;
    }

    // Unmarked days (no record) → absent (true, the default) or paid (false) in the
    // report and timesheet, matching ERPNext's "Consider Unmarked Attendance As".
    if (countUnmarkedAsAbsent !== undefined) {
      if (typeof countUnmarkedAsAbsent !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "countUnmarkedAsAbsent must be true or false",
        });
      }
      schedule.countUnmarkedAsAbsent = countUnmarkedAsAbsent;
    }

    // Supervisor backfill window: whole days, 1 to the hard-coded maximum.
    if (supervisorBackfillWindowDays !== undefined) {
      const days = Number(supervisorBackfillWindowDays);
      if (
        supervisorBackfillWindowDays === null ||
        supervisorBackfillWindowDays === "" ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS
      ) {
        return res.status(400).json({
          success: false,
          message: `Supervisor backfill window must be a whole number of days from 1 to ${MAX_SUPERVISOR_BACKFILL_WINDOW_DAYS}`,
        });
      }
      schedule.supervisorBackfillWindowDays = days;
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

}

export default configController