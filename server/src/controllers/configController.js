import workModel from '../models/workModel.js'
import holidayModel from '../models/holidayModel.js';
import siteModel from '../models/siteModel.js';
import {
  getCurrentCutoff,
  LEGACY_CUTOFF_EPOCH,
  DEFAULT_CUTOFF_HOUR,
} from '../utils/cutoff.js';
import {
  deriveSiteCutoff,
  applyDerivedCutoff,
  seedHistoryFromGlobal,
} from '../utils/siteCutoff.js';
import {
  DEFAULT_OVERTIME_MULTIPLIER,
  DEFAULT_MONTHLY_HOURS_DIVISOR,
} from '../utils/payMath.js';

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

/**
 * Per-site cutoff maintenance. Idempotent — called on boot, after
 * initializePermanentSite() and ensureCutoffHistory().
 *
 * Two passes over every site (including inactive/completed/deleted ones — their
 * historical records are still read):
 * 1. MIGRATION: a site with an empty cutoffHistory gets a COPY of the global history,
 *    because the global cutoff is what actually governed that site's past records.
 * 2. RE-DERIVE: the site's cutoff is re-derived from its default times on EVERY boot,
 *    not just at seeding — when the derivation rule changes (e.g. day-only sites now
 *    derive 0/midnight), existing sites pick it up here. applyDerivedCutoff schedules
 *    the change effective TOMORROW, so past days keep the cutoff their records were
 *    written under. Sites with contradictory default times keep their current value
 *    and are logged — boot never fails.
 */
export const ensureSiteCutoffHistories = async () => {
  const schedule = await workModel.findOne({ type: "default" });
  const sites = await siteModel.find({});

  for (const site of sites) {
    const needsSeed = !Array.isArray(site.cutoffHistory) || site.cutoffHistory.length === 0;
    if (needsSeed) {
      site.cutoffHistory = seedHistoryFromGlobal(schedule, LEGACY_CUTOFF_EPOCH, DEFAULT_CUTOFF_HOUR);
      site.nightShiftCutoffHour = getCurrentCutoff(site);
    }

    const derived = deriveSiteCutoff(site);
    if (derived.conflict) {
      console.warn(
        `[Config] Site "${site.siteName}" has contradictory default times; kept the ` +
        `current cutoff (${site.nightShiftCutoffHour}:00). ${derived.conflict}`
      );
      if (needsSeed) await site.save();
      continue;
    }

    const historyBefore = JSON.stringify(site.cutoffHistory);
    const change = applyDerivedCutoff(site, derived.cutoffHour);
    const historyChanged = JSON.stringify(site.cutoffHistory) !== historyBefore;

    if (needsSeed || historyChanged) {
      await site.save();
    }
    if (needsSeed) {
      console.log(
        `[Config] Seeded cutoff history for site "${site.siteName}" ` +
        `(active ${site.nightShiftCutoffHour}:00, derived ${derived.cutoffHour}:00)`
      );
    } else if (change) {
      console.log(
        `[Config] Site "${site.siteName}": derived cutoff ${change.cutoffHour}:00 scheduled ` +
        `effective ${new Date(change.effectiveFrom).toISOString().split("T")[0]}`
      );
    }
  }
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

    // The cutoff hour is per-site now, derived from each site's default shift times
    // (utils/siteCutoff.js). The global value only remains as a seed/fallback for sites
    // with no times. An incoming nightShiftCutoffHour is deliberately IGNORED — not
    // rejected — so stale PWA clients that still send it can keep saving the other fields.
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

    // Keep the top-level field mirroring the cutoff that is ACTIVE right now — a change
    // scheduled for tomorrow must not flip it today.
    schedule.nightShiftCutoffHour = getCurrentCutoff(schedule);

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
    ensureCutoffHistory,
    ensureOvertimePayFields

}

export default configController