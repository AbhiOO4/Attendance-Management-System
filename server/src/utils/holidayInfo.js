import customHolidayModel from "../models/holidayModel.js";
import workModel from "../models/workModel.js";

/**
 * Resolves whether a given date is a holiday and why.
 * @returns {Promise<{isHoliday: boolean, reason: "weekly"|"public"|null}>}
 *          "public" = CustomHoliday doc (incl. manually declared); "weekly" = WorkSchedule.weeklyHolidays.
 */
export async function checkHolidayForDate(dateObj) {
  const targetDate = new Date(dateObj);
  targetDate.setUTCHours(0, 0, 0, 0);

  const startOfDay = new Date(targetDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  // 1. Check CustomHoliday
  const customHoliday = await customHolidayModel.findOne({
    date: {
      $gte: startOfDay,
      $lte: endOfDay,
    },
  });

  if (customHoliday) {
    return { isHoliday: true, reason: "public" };
  }

  // 2. Check WorkSchedule / weeklyHolidays
  const workConfig = await workModel.findOne({ type: "default" });
  if (workConfig) {
    const weeklyHolidays = workConfig.weeklyHolidays || [];
    const dayName = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
    if (weeklyHolidays.includes(dayName)) {
      return { isHoliday: true, reason: "weekly" };
    }
  }

  return { isHoliday: false, reason: null };
}

/**
 * Temporary workers get no holiday treatment — a holiday is an ordinary working
 * day for them (normal hours + overtime, no holiday-hours credit). Collapse the
 * day's holiday info to "not a holiday" so isHoliday/holidayReason/holidayHours
 * are cleared and overtime is computed normally.
 */
export function holidayInfoForEmployee(baseHolidayInfo, employmentType) {
  if (employmentType === "temporary") return { isHoliday: false, reason: null };
  return baseHolidayInfo;
}
