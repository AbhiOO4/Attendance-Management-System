import workModel from '../models/workModel.js'
import holidayModel from '../models/holidayModel.js';
import siteModel from '../models/siteModel.js';
import { getDateLocal } from '../utils/timeLocal.js';
import {
  getCurrentCutoff,
  normalizeBusinessDate,
  validateSiteDefaultsAgainstCutoff,
  LEGACY_CUTOFF_EPOCH,
} from '../utils/cutoff.js';

/**
 * Seed cutoffHistory for a config that predates effective-dating.
 *
 * Idempotent — called on boot. Asserts that the current cutoff has always applied, which is
 * true for any deployment that never changed it. If the cutoff HAS been changed before this
 * shipped, records written under the older value are already inconsistent and cannot be
 * recovered here; that needs a hand-written history plus a recalculation pass in seed/seed.js.
 */
export const ensureCutoffHistory = async () => {
  const schedule = await workModel.findOne({ type: "default" });
  if (!schedule) return;
  if (Array.isArray(schedule.cutoffHistory) && schedule.cutoffHistory.length > 0) return;

  schedule.cutoffHistory = [
    {
      cutoffHour: schedule.nightShiftCutoffHour,
      effectiveFrom: LEGACY_CUTOFF_EPOCH,
    },
  ];
  await schedule.save();
  console.log(
    `[Config] Seeded cutoffHistory with the current cutoff (${schedule.nightShiftCutoffHour}:00)`
  );
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
      overtimeRatePerHour,
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

    if (
      overtimeRatePerHour !== undefined
    ) {
      schedule.overtimeRatePerHour =
        overtimeRatePerHour;
    }

    if (weeklyHolidays !== undefined) {
      schedule.weeklyHolidays =
        weeklyHolidays;
    }

    let cutoffChange = null;

    if (nightShiftCutoffHour !== undefined) {
      if (nightShiftCutoffHour < 0 || nightShiftCutoffHour > 12) {
        return res.status(400).json({
          success: false,
          message: "Night shift cutoff hour must be between 0 and 12",
        });
      }

      // A change can only take effect from TOMORROW's business day: the cutoff is baked into
      // every stored check-in/out Date, so records already written today must keep the cutoff
      // they were combined and validated with.
      const effectiveFrom = normalizeBusinessDate(getDateLocal(1));
      const isPending = (entry) =>
        normalizeBusinessDate(entry.effectiveFrom).getTime() >= effectiveFrom.getTime();

      const history = [...(schedule.cutoffHistory || [])];
      const activeCutoff = getCurrentCutoff(schedule);
      const pending = history.find(isPending);

      // What the cutoff would become if we left things alone — an already-scheduled change
      // counts, otherwise it's just today's value.
      const scheduledCutoff = pending ? pending.cutoffHour : activeCutoff;

      if (nightShiftCutoffHour !== scheduledCutoff) {
        if (nightShiftCutoffHour === activeCutoff) {
          // Reverting to the active value: drop the scheduled change rather than scheduling a
          // second one, otherwise the pending entry would still flip the cutoff tomorrow.
          schedule.cutoffHistory = history.filter((entry) => !isPending(entry));
        } else {
          // A cutoff the sites' default times don't straddle would make the auto check-in/out
          // crons stamp times onto the wrong calendar day. Refuse, and name the sites to fix.
          const sites = await siteModel.find({
            isActive: true,
            isDeleted: { $ne: true },
          });

          const conflicts = sites
            .map((site) => ({
              siteName: site.siteName,
              errors: validateSiteDefaultsAgainstCutoff(site, nightShiftCutoffHour),
            }))
            .filter((s) => s.errors.length > 0);

          if (conflicts.length > 0) {
            return res.status(400).json({
              success: false,
              message:
                `Cannot set the cutoff to ${nightShiftCutoffHour}:00 — the default shift times on ` +
                `${conflicts.length} site(s) would fall outside it. Update these sites first: ` +
                conflicts.map((c) => c.siteName).join(", "),
              data: { conflicts },
            });
          }

          // Replace (don't stack) an existing scheduled change — an admin changing their mind
          // before it takes effect.
          const next = history.filter((entry) => !isPending(entry));
          next.push({ cutoffHour: nightShiftCutoffHour, effectiveFrom });
          next.sort(
            (a, b) =>
              normalizeBusinessDate(a.effectiveFrom).getTime() -
              normalizeBusinessDate(b.effectiveFrom).getTime()
          );

          schedule.cutoffHistory = next;
          cutoffChange = { cutoffHour: nightShiftCutoffHour, effectiveFrom };
        }
      }
    }

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

    // Keep the top-level field mirroring the cutoff that is ACTIVE right now — a change
    // scheduled for tomorrow must not flip it today.
    schedule.nightShiftCutoffHour = getCurrentCutoff(schedule);

    const updatedSchedule =
      await schedule.save();

    return res.status(200).json({
      success: true,
      message: cutoffChange
        ? `Work schedule updated. The ${cutoffChange.cutoffHour}:00 cutoff takes effect from ` +
          `${cutoffChange.effectiveFrom.toISOString().split("T")[0]}; existing records keep the ` +
          `cutoff they were created under.`
        : "Work schedule updated successfully",
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
    ensureCutoffHistory

}

export default configController