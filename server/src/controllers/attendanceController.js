import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import Employee from '../models/empModel.js';
import empModel from '../models/empModel.js';
import mongoose from 'mongoose';
import workModel from '../models/workModel.js';
import Site from '../models/siteModel.js';
import siteModel from '../models/siteModel.js';
import { escapeRegExp } from '../utils/escapeRegExp.js';
import userModel from '../models/userModel.js';
import Job from '../models/jobModel.js';
import customHolidayModel from '../models/holidayModel.js';
import { getStaffEmployeeIds } from '../utils/collar.js';
import { combineDateAndTimeLocal } from '../utils/timeLocal.js';
import { hasSessionOverlap } from '../utils/sessionOverlap.js';


// --- NIGHT SHIFT HELPERS ---

/**
 * Combines a date string ("YYYY-MM-DD") and time string ("HH:mm")
 * into a Date object.
 *
 * When isNightShift = true:
 *   Times < cutoffHour are placed on the NEXT calendar day.
 *   Times >= cutoffHour stay on the same calendar day (the evening).
 *
 * When isNightShift = false (default):
 *   If referenceCheckIn is provided and the time is earlier,
 *   the date is advanced by one day (auto cross-midnight detection).
 */
function combineDateAndTime(dateStr, timeStr, { referenceCheckIn = null, isNightShift = false, cutoffHour = 7, timezoneOffset = null } = {}) {
  // If timezoneOffset is passed (e.g. "-330"), construct standard offset string like "+05:30"
  let offsetStr = "";
  let targetOffset = timezoneOffset;
  if (targetOffset === null || targetOffset === undefined) {
    targetOffset = process.env.APP_TIMEZONE_OFFSET;
  }

  if (targetOffset !== null && targetOffset !== undefined && targetOffset !== "") {
    const offsetVal = parseInt(targetOffset, 10);
    if (!isNaN(offsetVal)) {
      const sign = offsetVal <= 0 ? "+" : "-";
      const absMinutes = Math.abs(offsetVal);
      const hours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
      const mins = String(absMinutes % 60).padStart(2, "0");
      offsetStr = `${sign}${hours}:${mins}`;
    }
  }

  if (!offsetStr) {
    // Default to Indian Standard Time offset (+05:30) if not specified to prevent UTC shift when hosted
    offsetStr = "+05:30";
  }

  const dt = new Date(`${dateStr}T${timeStr}:00${offsetStr}`);
  const [h] = timeStr.split(":").map(Number);

  if (isNightShift) {
    // Night shift mode: AM times before cutoff → next day
    if (h < cutoffHour) {
      dt.setDate(dt.getDate() + 1);
    }
  } else if (referenceCheckIn) {
    // Auto cross-midnight: checkOut < checkIn → next day
    const [inH, inM] = referenceCheckIn.split(":").map(Number);
    const [outH, outM] = timeStr.split(":").map(Number);
    if (outH * 60 + outM < inH * 60 + inM) {
      dt.setDate(dt.getDate() + 1);
    }
  }

  return dt;
}

function toLocalTimeString(dateVal, offsetVal) {
  if (!dateVal) return null;
  const dateObj = new Date(dateVal);
  if (isNaN(dateObj.getTime())) return null;
  const localTime = new Date(dateObj.getTime() - offsetVal * 60 * 1000);
  const h = String(localTime.getUTCHours()).padStart(2, '0');
  const m = String(localTime.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function validateSessionTimes(checkIn, checkOut, isNightShift = false, cutoffHour = 7) {
  // 1. RULE: Check-out without check-in is NOT allowed
  if (!checkIn && checkOut) {
    return "Check-out cannot exist without check-in";
  }

  // If check-in is present but no check-out, it's valid (representing an active shift)
  if (checkIn && !checkOut) {
    return null;
  }

  // If both are empty, it's valid (representing no shift)
  if (!checkIn && !checkOut) {
    return null;
  }

  const [inH, inM] = checkIn.split(":").map(Number);
  const [outH, outM] = checkOut.split(":").map(Number);
  const inMin = inH * 60 + inM;
  const outMin = outH * 60 + outM;
  const cutoffMin = cutoffHour * 60;

  // 2. RULE (New - Early Morning Check-in):
  // If check-in is between 12:00 AM and cutoffHour (00:00 - 07:00)
  if (inH >= 0 && inH < cutoffHour) {
    const isOutInCutoffRange = (outMin >= 0) && (outMin <= cutoffMin);
    if (!isOutInCutoffRange || inMin >= outMin) {
      return `Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) if checked in before ${cutoffHour}:00 AM.`;
    }
    return null;
  }

  // Detect if shift crosses midnight (check-out time < check-in time)
  const crossesMidnight = outMin < inMin;

  // 3. RULE (Corrected - Through Midnight Shift):
  // If check-out is between 12:00 AM and cutoffHour (00:00 - 07:00) and shift crosses midnight
  if (crossesMidnight && (outMin >= 0 && outMin <= cutoffMin)) {
    if (inH < 12) {
      return `For night shifts crossing midnight and ending before ${cutoffHour}:00 AM, the check-in time must be 12:00 PM (noon) or later.`;
    }
  }

  // 4. RULE (Existing - Night Shift Check-in):
  if (isNightShift || crossesMidnight) {
    if (inH >= cutoffHour && inH < 12) {
      return `Check-in time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`;
    }
  }

  // 5. RULE (Existing - Night Shift Check-out):
  if (isNightShift || crossesMidnight) {
    if (outMin > cutoffMin && outH < 12) {
      return `Check-out time must be before or equal to the cutoff hour (${cutoffHour}:00 AM) for night shifts.`;
    }
  }

  return null;
}

/**
 * Determines if any session in the array is a night shift.
 * Checks both the isNightShift flag and auto-detects cross-midnight.
 */
function detectCrossedMidnight(sessions, timezoneOffset = null) {
  let fallbackOffset = -330;
  if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
    const parsedFallback = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
    if (!isNaN(parsedFallback)) {
      fallbackOffset = parsedFallback;
    }
  }

  // Parse timezone offset
  let offsetVal = fallbackOffset;
  if (timezoneOffset !== null && timezoneOffset !== undefined) {
    const parsed = parseInt(timezoneOffset, 10);
    if (!isNaN(parsed)) {
      offsetVal = parsed;
    }
  }

  const getLocalInfo = (dateObj) => {
    const localTime = new Date(dateObj.getTime() - offsetVal * 60 * 1000);
    return {
      date: localTime.getUTCDate(),
      hours: localTime.getUTCHours(),
      minutes: localTime.getUTCMinutes(),
    };
  };

  return sessions.some((s) => {
    // Explicit night shift flag
    if (s.isNightShift) return true;

    if (!s.checkIn || !s.checkOut) return false;
    // Auto-detect from Date objects
    let inTime, outTime;
    if (typeof s.checkIn === "string" && s.checkIn.length === 5) {
      inTime = s.checkIn;
      outTime = s.checkOut;
    } else {
      const inDate = new Date(s.checkIn);
      const outDate = new Date(s.checkOut);

      const localIn = getLocalInfo(inDate);
      const localOut = getLocalInfo(outDate);

      // If checkOut is on a different date than checkIn, it crossed midnight
      if (localOut.date !== localIn.date) return true;

      inTime = `${String(localIn.hours).padStart(2, "0")}:${String(localIn.minutes).padStart(2, "0")}`;
      outTime = `${String(localOut.hours).padStart(2, "0")}:${String(localOut.minutes).padStart(2, "0")}`;
    }
    const [inH] = inTime.split(":").map(Number);
    const [outH] = outTime.split(":").map(Number);
    const inMinutes = inH * 60 + (parseInt(inTime.split(":")[1]) || 0);
    const outMinutes = outH * 60 + (parseInt(outTime.split(":")[1]) || 0);
    return outMinutes < inMinutes;
  });
}

/**
 * Resolves whether a given date is a holiday (either custom public holiday or weekly holiday).
 */
async function checkHolidayForDate(dateObj) {
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
    return true;
  }

  // 2. Check WorkSchedule / weeklyHolidays
  const workConfig = await workModel.findOne({ type: "default" });
  if (workConfig) {
    const weeklyHolidays = workConfig.weeklyHolidays || [];
    const dayName = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
    if (weeklyHolidays.includes(dayName)) {
      return true;
    }
  }

  return false;
}

/**
 * Automatically sets the check-out time of a previous session at a different site
 * to the check-in time of the current session, if the previous session is check-in only.
 */
function autoClosePreviousSiteSessions(sessions, timezoneOffset = null, workConfig = null) {
  if (!Array.isArray(sessions) || sessions.length <= 1) return sessions;

  // 1. Sort sessions chronologically by checkIn time. Empty check-ins go last.
  const sorted = [...sessions].sort((a, b) => {
    if (!a.checkIn && !b.checkIn) return 0;
    if (!a.checkIn) return 1;
    if (!b.checkIn) return -1;
    return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
  });

  let fallbackOffset = -330;
  if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
    const parsedFallback = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
    if (!isNaN(parsedFallback)) {
      fallbackOffset = parsedFallback;
    }
  }

  let offsetVal = fallbackOffset;
  if (timezoneOffset !== null && timezoneOffset !== undefined) {
    const parsed = parseInt(timezoneOffset, 10);
    if (!isNaN(parsed)) {
      offsetVal = parsed;
    }
  }

  if (!workConfig || workConfig.nightShiftCutoffHour === undefined || workConfig.nightShiftCutoffHour === null) {
    throw new Error("Work schedule configuration nightShiftCutoffHour is required.");
  }
  const cutoffHour = workConfig.nightShiftCutoffHour;

  // 2. Process sessions
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (!current.checkIn) continue;

    // Search backwards for the most recent session from a different site that is open
    for (let j = i - 1; j >= 0; j--) {
      const prev = sorted[j];
      if (!prev.checkIn) continue; // Skip empty check-ins

      const diffSite = prev.siteId && current.siteId && prev.siteId.toString() !== current.siteId.toString();
      const prevIsOpen = !prev.checkOut;

      if (diffSite && prevIsOpen) {
        // Set prev checkout to current checkin
        prev.checkOut = current.checkIn;

        // Recalculate worked hours
        const inTime = new Date(prev.checkIn);
        const outTime = new Date(prev.checkOut);
        let workedHours = (outTime.getTime() - inTime.getTime()) / (1000 * 60 * 60);
        if (workedHours < 0) workedHours = 0;
        prev.workedHours = Number(workedHours.toFixed(2));

        // Recalculate isNightShift for prev session
        let sessionIsNight = prev.isNightShift || false;
        const localInTime = new Date(inTime.getTime() - offsetVal * 60 * 1000);
        const inH = localInTime.getUTCHours();
        if (inH >= 0 && inH < cutoffHour) {
          sessionIsNight = true;
        }

        const inStr = toLocalTimeString(prev.checkIn, offsetVal);
        const outStr = toLocalTimeString(prev.checkOut, offsetVal);
        if (inStr && outStr) {
          const [prevInH, prevInM] = inStr.split(":").map(Number);
          const [prevOutH, prevOutM] = outStr.split(":").map(Number);
          if (prevOutH * 60 + prevOutM < prevInH * 60 + prevInM) {
            sessionIsNight = true;
          }
        }
        prev.isNightShift = sessionIsNight;

        break; // Only close the most recent previous session
      }
    }
  }

  return sorted;
}



// --- BREAK / HOURS HELPER ---

/**
 * Computes net work hours, attendance status, and overtime from raw session hours.
 *
 * Design rules:
 *  1. STATUS   — determined from RAW hours (break-agnostic) to prevent edge-case demotions.
 *  2. BREAKS   — proportional: floor(raw / fullDayHours) per day, unless supervisor overrides.
 *  3. NET HRS  — raw minus total break deduction (never below 0).
 *  4. OVERTIME — calculated on NET hours against overtimeThreshold.
 *
 * @param {number}      rawHours    Sum of all session workedHours
 * @param {object}      workConfig  WorkSchedule document (needs fullDayHours, halfDayHours,
 *                                  overtimeThreshold, breakDurationMinutes)
 * @param {number|null} breaksTaken null = auto; 0+ = supervisor override
 * @returns {{ netWorkHours, status, overtimeHours, breaksApplied }}
 */
function computeAttendanceTotals(rawHours, workConfig, breaksTaken = null) {
  const { fullDayHours, halfDayHours, overtimeThreshold } = workConfig;
  const breakDurationHours = (workConfig.breakDurationMinutes || 0) / 60;

  // STEP 1 – Status from raw hours (never affected by break deduction)
  let status = 'absent';
  if (rawHours >= fullDayHours)       status = 'fullday';
  else if (rawHours >= halfDayHours)  status = 'halfday';

  // STEP 2 – Number of breaks to apply
  const autoBreaks = fullDayHours > 0 ? Math.floor(rawHours / fullDayHours) : 0;
  const breaksApplied = (breaksTaken !== null && breaksTaken !== undefined && breaksTaken >= 0)
    ? breaksTaken
    : autoBreaks;
  const totalBreakHours = breaksApplied * breakDurationHours;

  // STEP 3 – Net work hours (floor at 0)
  const netWorkHours = Number(Math.max(rawHours - totalBreakHours, 0).toFixed(2));

  // STEP 4 – Overtime on net hours
  const overtimeHours = netWorkHours > overtimeThreshold
    ? Number((netWorkHours - overtimeThreshold).toFixed(2))
    : 0;

  return { netWorkHours, status, overtimeHours, breaksApplied };
}


// --- ADMINS ---


// POST /api/attendance/submit



//PATCH /api/attendance/unlock
export const unlockAttendance = async (req, res) => {
  try {
    const { siteId, date } = req.body

    const parsedDate = new Date(date)
    parsedDate.setUTCHours(0, 0, 0, 0)

    const lock = await AttendanceLock.findOneAndUpdate(
      { siteId, date: parsedDate },
      {
        isLocked: false,
        unlockedBy: req.user?.id || '69f33152d121b1a10b175d46',
        unlockedAt: new Date()
      },
      { new: true }
    )

    res.json({ message: "Attendance unlocked", lock })

  } catch (err) {
    res.status(500).json({ message: "Failed to unlock", error: err.message })
  }
} //

//GET /api/attendance/reports/monthly
export const monthlyReport = async (req, res) => {
  try {
    const { month, year } = req.params;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year are required",
      });
    }

    const monthNum = Number(month);
    const yearNum = Number(year);

    if (
      isNaN(monthNum) ||
      isNaN(yearNum) ||
      monthNum < 1 ||
      monthNum > 12
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid month or year",
      });
    }

    const startDate = new Date(
      yearNum,
      monthNum - 1,
      1
    );

    const endDate = new Date(
      yearNum,
      monthNum,
      1
    );

    const daysInMonth = new Date(
      yearNum,
      monthNum,
      0
    ).getDate();

    const SALARY_DIVISOR = 26;

    const [employees, attendances, workConfig] =
      await Promise.all([
        empModel.find({}).lean(),

        Attendance.find({
          date: {
            $gte: startDate,
            $lt: endDate,
          },
        }).lean(),

        workModel.findOne({ type: "default" }).lean(),
      ]);

    if (!workConfig) {
      return res.status(404).json({
        success: false,
        message: "Work schedule configuration not found",
      });
    }

    // Calculate expected working days dynamically for this month
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-indexed
    const currentDay = today.getDate();

    let lastDayToCount = daysInMonth;
    if (yearNum === currentYear && monthNum === currentMonth) {
      lastDayToCount = currentDay;
    }

    const weeklyHolidays = workConfig.weeklyHolidays || [];
    let expectedWorkingDays = 0;

    for (let d = 1; d <= lastDayToCount; d++) {
      const date = new Date(yearNum, monthNum - 1, d);
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
      if (!weeklyHolidays.includes(dayName)) {
        expectedWorkingDays++;
      }
    }

    const attendanceMap = new Map();

    for (const attendance of attendances) {
      const employeeId =
        attendance.employee.toString();

      if (!attendanceMap.has(employeeId)) {
        attendanceMap.set(employeeId, []);
      }

      attendanceMap
        .get(employeeId)
        .push(attendance);
    }

    const round = (num) =>
      Number(num.toFixed(2));

    const report = employees.map(
      (employee) => {
        const records =
          attendanceMap.get(
            employee._id.toString()
          ) || [];

        let fullDays = 0;
        let halfDays = 0;
        let overtimeHours = 0;
        let payableDays = 0;
        let holidayRecords = 0;
        let absentDays = 0;

        for (const record of records) {
          // Holiday work:
          // - Ignore status
          // - No payable day
          // - Entire worked hours are OT
          if (record.isHoliday) {
            holidayRecords += 1;

            overtimeHours +=
              record.totalWorkHours || 0;

            continue;
          }

          overtimeHours +=
            record.overtimeHours || 0;

          if (record.status === "fullday") {
            fullDays += 1;
            payableDays += 1;
          }

          else if (
            record.status === "halfday"
          ) {
            halfDays += 1;
            payableDays += 0.5;
          }

          else if (record.status === "absent") {
            absentDays += 1;
          }
        }

        const dailySalary =
          employee.monthlySalary /
          SALARY_DIVISOR;

        const normalPay =
          payableDays * dailySalary;

        const overtimePay =
          overtimeHours *
          workConfig.overtimeRatePerHour;

        const salary =
          normalPay + overtimePay;

        const attendancePercentage = expectedWorkingDays > 0
          ? Math.min((payableDays / expectedWorkingDays) * 100, 100)
          : 0;

        return {
          employeeName: employee.name,
          employeeId: employee.employeeId,
          jobTitle: employee.jobTitle,
          isActive: employee.isActive !== false,

          fullDays,
          halfDays,
          absentDays,

          attendancePercentage: round(
            attendancePercentage
          ),

          overtimeHours: round(
            overtimeHours
          ),

          payableDays: round(
            payableDays
          ),

          normalPay: round(
            normalPay
          ),

          overtimePay: round(
            overtimePay
          ),

          salary: round(
            salary
          ),
        };
      }
    );

    report.sort((a, b) => {
      const aActive = a.isActive !== false;
      const bActive = b.isActive !== false;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return a.employeeName.localeCompare(b.employeeName);
    });

    return res.status(200).json({
      success: true,
      month: monthNum,
      year: yearNum,
      report,
    });
  }

  catch (error) {
    console.error(
      "monthlyReport error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to generate monthly report",
      error: error.message,
    });
  }
}; //


//GET /api/attendance/daily-summary
export const getSummary = async (req, res) => {
  try {
    let targetDate;

    if (req.query.date) {
      targetDate = new Date(req.query.date);

      if (isNaN(targetDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date",
        });
      }
    } else {
      targetDate = new Date();
    }

    const startOfDay = new Date(targetDate);

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );

    const endOfDay = new Date(targetDate);

    endOfDay.setHours(
      23,
      59,
      59,
      999
    );

    // Active employees
    const totalEmployees =
      await empModel.countDocuments({
        isActive: true,
      });

    // Staff (white-collar) are excluded from man-hours / man-days stats but
    // still counted in headcount/attendance below.
    const staffIds = await getStaffEmployeeIds();
    const staffIdSet = new Set(staffIds.map((s) => s.toString()));

    // Attendance records for selected day
    const attendances =
      await Attendance.find({
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      }).lean();

    let presentToday = 0;

    let manHoursToday = 0;

    const siteMap = new Map();

    for (const attendance of attendances) {
      // Present count: count records with at least a session with a checkin filled (or status is fullday/halfday)
      const isPresent =
        attendance.status === "fullday" ||
        attendance.status === "halfday" ||
        (attendance.sessions &&
          attendance.sessions.some((s) => s.checkIn));
      if (isPresent) {
        presentToday++;
      }

      // Staff are excluded from all man-hours / per-site productivity stats.
      if (staffIdSet.has(attendance.employee.toString())) {
        continue;
      }

      // Total man hours
      manHoursToday +=
        attendance.totalWorkHours || 0;

      for (const session of attendance.sessions) {
        const siteId =
          session.siteId?.toString();

        if (!siteId) continue;

        if (!siteMap.has(siteId)) {
          siteMap.set(siteId, {
            siteId,
            manHoursToday: 0,

            // employeeId -> total hours worked
            employeeHours:
              new Map(),

            // Set of checked-in employee IDs
            checkedInEmployees: new Set(),
          });
        }

        const siteStats =
          siteMap.get(siteId);

        const employeeId =
          attendance.employee.toString();

        if (session.checkIn) {
          siteStats.checkedInEmployees.add(employeeId);
        }

        const workedHours =
          session.workedHours || 0;

        siteStats.manHoursToday +=
          workedHours;

        const existingHours =
          siteStats.employeeHours.get(
            employeeId
          ) || 0;

        siteStats.employeeHours.set(
          employeeId,
          existingHours +
            workedHours
        );
      }
    }

    // Active sites only
    const activeSites =
      await siteModel.find({
        isActive: true,
        isDeleted: { $ne: true }
      })
        .select("siteName")
        .lean();

    const activeSiteMap =
      new Map(
        activeSites.map((site) => [
          site._id.toString(),
          site,
        ])
      );

    const sites = [];

    for (const [
      siteId,
      stats,
    ] of siteMap.entries()) {
      const site =
        activeSiteMap.get(siteId);

      if (!site) continue;

      const employeesToday = stats.checkedInEmployees ? stats.checkedInEmployees.size : 0;

      sites.push({
        siteId,

        siteName: site.siteName,

        employeesToday,

        manHoursToday: Number(
          stats.manHoursToday.toFixed(
            2
          )
        ),

        averageHoursPerWorker:
          employeesToday > 0
            ? Number(
                (
                  stats.manHoursToday /
                  employeesToday
                ).toFixed(2)
              )
            : 0,
      });
    }

    sites.sort(
      (a, b) =>
        b.manHoursToday -
        a.manHoursToday
    );

    const attendancePercentage =
      totalEmployees > 0
        ? Number(
            (
              (presentToday /
                totalEmployees) *
              100
            ).toFixed(2)
          )
        : 0;

    return res.status(200).json({
      success: true,

      date:
        startOfDay
          .toISOString()
          .split("T")[0],

      attendance: {
        presentToday,
        totalEmployees,
        attendancePercentage,
      },

      totals: {
        manHoursToday: Number(
          manHoursToday.toFixed(2)
        ),
      },

      sites,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message:
        "Internal Server Error",
    });
  }
}; //


export const toggleHolidayStatus = async (req, res) => {
  const { date, isHoliday } = req.body

  if (!date) {
    return res.status(400).json({
      message: "Date is required",
    })
  }

  if (typeof isHoliday !== "boolean") {
    return res.status(400).json({
      message: "isHoliday must be a boolean",
    })
  }

  // Create day range in UTC
  const targetDate = new Date(date)
  targetDate.setUTCHours(0, 0, 0, 0)

  const startOfDay = new Date(targetDate)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const endOfDay = new Date(targetDate)
  endOfDay.setUTCHours(23, 59, 59, 999)

  // Check weekly holiday safeguard if trying to remove holiday status
  if (!isHoliday) {
    try {
      const workConfig = await workModel.findOne({ type: "default" })
      if (workConfig) {
        const weeklyHolidays = workConfig.weeklyHolidays || []
        const dayName = targetDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase()
        if (weeklyHolidays.includes(dayName)) {
          return res.status(400).json({
            success: false,
            message: "Cannot remove weekly holidays",
          })
        }
      }
    } catch (error) {
      console.log(error)
      return res.status(500).json({
        message: "Failed to update holiday status",
      })
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update CustomHoliday collection
    if (isHoliday) {
      const existingHoliday = await customHolidayModel.findOne({
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      }).session(session)

      if (!existingHoliday) {
        await customHolidayModel.create([{
          date: startOfDay,
          reason: "Manual Holiday",
        }], { session })
      }
    } else {
      await customHolidayModel.deleteMany({
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      }).session(session)
    }

    // Update all attendance records for that day
    const result = await Attendance.updateMany(
      {
        date: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      },
      {
        $set: {
          isHoliday,
        },
      }
    ).session(session)

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: isHoliday
        ? "Day marked as holiday successfully"
        : "Holiday removed successfully",

      modifiedCount: result.modifiedCount,
    })
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error)

    return res.status(500).json({
      message: "Failed to update holiday status",
    })
  }
} 


// pst req to /api/attendance/submit
export const siteFirstSubmitAttendance = async (req, res) => {
  const {
    siteId,
    date,
    isHoliday = false,
    attendance,
  } = req.body

  const markedBy = req.user?.id
  const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
    ? process.env.APP_TIMEZONE_OFFSET
    : req.headers['x-timezone-offset']

  // -----------------------------
  // VALIDATION (outside transaction)
  // -----------------------------
  if (!siteId || !date || !Array.isArray(attendance) || attendance.length === 0) {
    return res.status(400).json({
      success: false,
      message: "siteId, date and attendance are required",
    })
  }

  const attendanceDate = new Date(date)
  attendanceDate.setUTCHours(0, 0, 0, 0)

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const throwValidationError = (status, message, extra = {}) => {
      const err = new Error(message);
      err.status = status;
      err.extra = extra;
      throw err;
    };

    // LOCK CHECK (site-first guarantee)
    const existingLock = await AttendanceLock.findOne({
      siteId,
      date: attendanceDate,
      isLocked: true,
    }).session(session)

    if (existingLock) {
      throwValidationError(400, "Attendance already submitted and locked for this site/date");
    }

    const workConfig = await workModel.findOne().session(session)
    if (!workConfig) {
      throwValidationError(404, "Work configuration not found");
    }

    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
    } = workConfig

    const processedRecords = []
    const isHolidayResolved = await checkHolidayForDate(attendanceDate);

    // -----------------------------
    // MAIN LOOP (EMPLOYEES)
    // -----------------------------
    for (const entry of attendance) {
      const {
        employee,
        employeeId,
        jobId,
        sessions,
        breaksTaken = null,
        isSickLeave = false,
      } = entry

      const empId = employee?._id

      if (!empId) {
        throwValidationError(400, "employee is required");
      }

      if (!Array.isArray(sessions)) {
        throwValidationError(400, "sessions must be an array");
      }

      let attendanceDoc = await Attendance.findOne({
        employee: empId,
        date: attendanceDate,
      }).session(session)

      if (!attendanceDoc) {
        attendanceDoc = new Attendance({
          employee: empId,
          date: attendanceDate,
          siteId,
          jobId: jobId || null,
          markedBy,
          isHoliday: isHolidayResolved,
          status: "absent",
          sessions: [],
        })
      }

      // -----------------------------
      // BUILD SESSIONS
      // -----------------------------
      const updatedSessions = []

      for (const sessionObj of sessions) {
        const {
          siteId: sessionSiteId,
          job,
          checkIn,
          checkOut,
        } = sessionObj

        const finalSiteId = sessionSiteId || siteId
        const cutoffHour = workConfig.nightShiftCutoffHour

        let sessionIsNight = false;
        if (checkIn) {
          const [inH, inM] = checkIn.split(":").map(Number);
          if (inH >= 0 && inH < cutoffHour) {
            sessionIsNight = true;
          }
          if (checkOut) {
            const [outH, outM] = checkOut.split(":").map(Number);
            if ((outH * 60 + outM) < (inH * 60 + inM)) {
              sessionIsNight = true;
            }
          }
        }

        const boundsError = validateSessionTimes(checkIn, checkOut, sessionIsNight, cutoffHour);
        if (boundsError) {
          throwValidationError(400, boundsError);
        }

        let workedHours = 0

        // VALID SESSION ONLY IF BOTH EXIST
        if (checkIn && checkOut) {
          const inTime = combineDateAndTime(date, checkIn, { isNightShift: sessionIsNight, cutoffHour, timezoneOffset })
          const outTime = combineDateAndTime(date, checkOut, { referenceCheckIn: checkIn, isNightShift: sessionIsNight, cutoffHour, timezoneOffset })

          if (
            isNaN(inTime.getTime()) ||
            isNaN(outTime.getTime())
          ) {
            throwValidationError(400, "Invalid checkIn/checkOut");
          }

          workedHours =
            (outTime.getTime() - inTime.getTime()) /
            (1000 * 60 * 60)

          if (workedHours < 0 || workedHours > 24) {
            throwValidationError(400, "Invalid shift duration");
          }
        }

        const cutoffOpts = { isNightShift: sessionIsNight, cutoffHour, timezoneOffset }

        const checkInDate = checkIn
          ? combineDateAndTime(date, checkIn, cutoffOpts)
          : null

        const checkOutDate = checkOut
          ? combineDateAndTime(date, checkOut, { referenceCheckIn: checkIn, ...cutoffOpts })
          : null

        // RULE: checkIn only OR null/null → 0 hours
        updatedSessions.push({
          siteId: finalSiteId,
          jobId: job?._id || null,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          workedHours: Number(workedHours.toFixed(2)),
          markedBy,
          isNightShift: sessionIsNight,
        })
      }

      // -----------------------------
      // MERGE WITH OTHER SITE SESSIONS
      // -----------------------------

      const otherSiteSessions =
        attendanceDoc.sessions.filter(
          (s) =>
            s.siteId.toString() !==
            siteId.toString()
        )

      const mergedSessions = [
        ...otherSiteSessions,
        ...updatedSessions,
      ]

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      autoClosePreviousSiteSessions(mergedSessions, timezoneOffset, workConfig);

      // -----------------------------
      // SORT ALL SESSIONS
      // -----------------------------

      mergedSessions.sort((a, b) => {
        if (!a.checkIn && !b.checkIn)
          return 0

        if (!a.checkIn)
          return 1

        if (!b.checkIn)
          return -1

        return (
          new Date(a.checkIn).getTime() -
          new Date(b.checkIn).getTime()
        )
      })

      // -----------------------------
      // OVERLAP CHECK
      // -----------------------------

      const validSessions = mergedSessions
        .filter((s) => s.checkIn)
        .map((s) => {
          const plain = typeof s.toObject === "function" ? s.toObject() : s;
          return {
            ...plain,
            _start: new Date(plain.checkIn),
            _end: plain.checkOut
              ? new Date(plain.checkOut)
              : new Date(plain.checkIn),
          };
        })

      for (
        let i = 0;
        i < validSessions.length - 1;
        i++
      ) {
        const a = validSessions[i]
        const b = validSessions[i + 1]

        const hasOverlap =
          a._start < b._end &&
          a._end > b._start

        if (hasOverlap) {
          let conflicting = b;
          if (siteId && a.siteId && a.siteId.toString() !== siteId.toString()) {
            conflicting = a;
          }
          const site = await Site.findById(conflicting.siteId)
            .select("siteName").session(session)

          if (!site) {
            throwValidationError(404, "Site not found");
          }

          throwValidationError(400, "Attendance sessions overlap", {
            overlap: {
              employeeId: empId,
              conflictingSession: {
                siteId: conflicting.siteId,
                siteName: site.siteName || "Unknown Site",
                jobId: conflicting.jobId,
                checkIn: conflicting.checkIn,
                checkOut: conflicting.checkOut,
              },
            },
          });
        }
      }

      // -----------------------------
      // ASSIGN MERGED SESSIONS
      // -----------------------------

      attendanceDoc.sessions = mergedSessions

      // -----------------------------
      // TOTAL HOURS, STATUS & OT
      // -----------------------------
      const rawHours = mergedSessions.reduce((sum, s) => sum + (s.workedHours || 0), 0)

      // Preserve existing breaksTaken override if not supplied in this submission
      const effectiveBreaksTaken = (breaksTaken !== null && breaksTaken !== undefined)
        ? breaksTaken
        : (attendanceDoc.breaksTaken ?? null)

      const { netWorkHours, status, overtimeHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken
      )

      attendanceDoc.totalWorkHours = netWorkHours
      attendanceDoc.status = status
      attendanceDoc.overtimeHours = overtimeHours
      if (breaksTaken !== undefined) {
        attendanceDoc.breaksTaken = breaksTaken
      }
      attendanceDoc.isHoliday = isHolidayResolved
      // Soft: pass through the requested value; the pre-save hook force-clears it
      // if any session (this site or another) turns out to be filled.
      attendanceDoc.isSickLeave = !!isSickLeave

      // Night shift detection
      const hasCrossedMidnight = detectCrossedMidnight(mergedSessions, timezoneOffset)
      attendanceDoc.crossedMidnight = hasCrossedMidnight
      attendanceDoc.shiftType = hasCrossedMidnight ? "night" : "day"
      attendanceDoc.siteId = siteId
      attendanceDoc.jobId = jobId || null
      attendanceDoc.markedBy = markedBy

      await attendanceDoc.save({ session })

      // Consume the pending-transfer stash if it targeted this exact
      // site/date. The filter re-checks the match so a newer transfer
      // (pointing elsewhere) isn't accidentally cleared.
      await empModel.updateOne(
        {
          _id: empId,
          pendingTransferSiteId: siteId,
          pendingTransferDate: attendanceDate,
        },
        {
          $set: {
            pendingTransferCheckIn: null,
            pendingTransferSiteId: null,
            pendingTransferDate: null,
          },
        },
        { session }
      )

      processedRecords.push(attendanceDoc)
    }

    // -----------------------------
    // CREATE LOCK
    // -----------------------------
    await AttendanceLock.create([{
      siteId,
      date: attendanceDate,
      isLocked: true,
      lockedBy: markedBy,
      lockedAt: new Date(),
    }], { session })

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Attendance submitted successfully",
      recordsProcessed: processedRecords.length,
      data: processedRecords,
    })

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to submit attendance",
      error: error.message,
      ...(error.extra || {}),
    })
  }
}//


//get saved attendance for a site 
export const getSiteAttendance = async (req, res) => {
  try {
    const { date, siteId } = req.query

    if (!date || !siteId) {
      return res.status(400).json({
        success: false,
        message: "date and siteId are required",
      })
    }

    const queryDate = new Date(date)

    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)

    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    const siteObjectId = new mongoose.Types.ObjectId(siteId)

    const pipeline = [
      {
        $match: {
          date: { $gte: start, $lte: end },
          "sessions.siteId": siteObjectId
        },
      },

      // filter sessions by site
      {
        $addFields: {
          totalRawHours: { $sum: "$sessions.workedHours" },
          filteredSessions: {
            $filter: {
              input: "$sessions",
              as: "session",
              cond: {
                $eq: ["$$session.siteId", siteObjectId],
              },
            },
          },
        },
      },


      {
        $match: {
          filteredSessions: { $ne: [] },
        },
      },

      // employee lookup
      {
        $lookup: {
          from: "employees",
          localField: "employee",
          foreignField: "_id",
          as: "employee",
        },
      },

      { $unwind: "$employee" },

      

      {
        $project: {
          _id: 0,

          attendanceId: "$_id",

          date: "$date",

          isHoliday: "$isHoliday",

          isSickLeave: "$isSickLeave",

          employee: "$employee._id",

          name: "$employee.name",

          employeeId: "$employee.employeeId",

          jobTitle: "$employee.jobTitle",

          user: "$employee.user",

          employmentType: "$employee.employmentType",

          collarType: "$employee.collarType",

          status: "$status",

          totalWorkHours: "$totalWorkHours",

          overtimeHours: "$overtimeHours",

          shiftType: "$shiftType",

          crossedMidnight: "$crossedMidnight",

          breaksTaken: "$breaksTaken",

          totalRawHours: "$totalRawHours",


          sessions: {
            $map: {
              input: "$filteredSessions",
              as: "s",
              in: {
                _id: "$$s._id",

                siteId: "$$s.siteId",

                jobId: "$$s.jobId",

                checkIn: "$$s.checkIn",

                checkOut: "$$s.checkOut",

                workedHours: "$$s.workedHours",

                isNightShift: "$$s.isNightShift",
              },
            },
          },
        },
      },

      { $sort: { name: 1 } },
    ]

    const result = await Attendance.aggregate(pipeline)

    const isHoliday =
      result.length > 0 ? (result[0].isHoliday ?? false) : false

    return res.status(200).json({
      totalRecords: result.length,
      isHoliday,
      data: result,
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance",
      error: error.message,
    })
  }
}//

//fetch attendance records 
export const getAttendanceRecords = async (req, res) => {
  try {
    let {
      date,
      name,
      employeeId,
      jobTitle,
      site,
      page = 1,
      limit = 20,
    } = req.query;

    // -----------------------------
    // Pagination
    // -----------------------------
    page = Number(page) || 1;

    limit = Math.min(Number(limit) || 20, 20);

    const skip = (page - 1) * limit;

    // -----------------------------
    // Attendance filters
    // -----------------------------
    let attendanceFilter = {};

    // Filter by date
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      attendanceFilter.date = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // -----------------------------
    // Employee filters
    // -----------------------------
    let employeeFilter = {};

    if (name) {
      employeeFilter.name = {
        $regex: escapeRegExp(name),
        $options: "i",
      };
    }

    if (employeeId) {
      employeeFilter.employeeId = {
        $regex: escapeRegExp(employeeId),
        $options: "i",
      };
    }

    if (jobTitle) {
      employeeFilter.jobTitle = {
        $regex: escapeRegExp(jobTitle),
        $options: "i",
      };
    }

    // Get employee IDs if employee filters exist
    if (
      name ||
      employeeId ||
      jobTitle
    ) {
      const employees = await Employee.find(
        employeeFilter
      ).select("_id");

      attendanceFilter.employee = {
        $in: employees.map((emp) => emp._id),
      };
    }

    // -----------------------------
    // Site filter
    // -----------------------------
    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      attendanceFilter.siteId = user?.assignedSite || null;
    } else if (site) {
      attendanceFilter.siteId = site
    }

    // -----------------------------
    // Count documents
    // -----------------------------
    const totalRecords =
      await Attendance.countDocuments(
        attendanceFilter
      );

    const totalPages = Math.ceil(
      totalRecords / limit
    );

    // -----------------------------
    // Fetch attendance records
    // -----------------------------
    const attendanceRecords =
      await Attendance.find(attendanceFilter)
        .populate(
          "employee",
          "name employeeId jobTitle"
        )
        .populate("siteId", "siteName")
        .populate("jobId", "name")
        .populate(
          "sessions.siteId",
          "siteName"
        )
        .populate(
          "sessions.jobId",
          "name"
        )
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    // -----------------------------
    // Format response
    // -----------------------------
    const formattedRecords =
      attendanceRecords.map((record) => ({
        attendanceId: record._id,

        employee: record.employee?._id,

        name: record.employee?.name || "",

        employeeId:
          record.employee?.employeeId || "",

        jobTitle:
          record.employee?.jobTitle || "",

        siteId: record.siteId?._id,

        siteName:
          record.siteId?.siteName || "",

        jobId: record.jobId?._id || null,

        jobName:
          record.jobId?.name || "",

        date: record.date,

        status: record.status,

        isHoliday: record.isHoliday,

        isSickLeave: record.isSickLeave || false,

        totalWorkHours:
          record.totalWorkHours,

        overtimeHours:
          record.overtimeHours,

        shiftType: record.shiftType,

        crossedMidnight: record.crossedMidnight,

        breaksTaken: record.breaksTaken,

        sessions: record.sessions.map(
          (session) => ({
            _id: session._id,

            siteId:
              session.siteId?._id,

            siteName:
              session.siteId?.siteName || "",

            jobId:
              session.jobId?._id ||
              null,

            jobName:
              session.jobId?.name ||
              "",

            checkIn:
              session.checkIn,

            checkOut:
              session.checkOut,

            workedHours:
              session.workedHours,

            isNightShift:
              session.isNightShift || false,

            markedBy:
              session.markedBy,
          })
        ),
      }));

    // Common holiday flag
    const isHoliday =
      formattedRecords.length > 0
        ? formattedRecords[0].isHoliday
        : false;

    return res.status(200).json({
      success: true,

      isHoliday,

      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        limit,
      },

      data: formattedRecords,
    });
  } catch (error) {
    console.error(
      "Get attendance records error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};//

export const bulkEditAttendance = async (
  req,
  res
) => {
  const {
    siteId,
    date,
    isHoliday = false,
    attendance,
  } = req.body;

  const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
    ? process.env.APP_TIMEZONE_OFFSET
    : req.headers['x-timezone-offset'];

  // VALIDATION (outside transaction)
  if (
    !siteId ||
    !date ||
    !attendance ||
    !Array.isArray(attendance) ||
    attendance.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: "siteId, date and attendance array are required",
    });
  }

  const markedBy = req.user?.id;

  // NORMALIZE DATE
  const attendanceDate = new Date(date);
  attendanceDate.setUTCHours(0, 0, 0, 0);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const throwValidationError = (status, message, extra = {}) => {
      const err = new Error(message);
      err.status = status;
      err.extra = extra;
      throw err;
    };

    // CHECK LOCK
    const existingLock = await AttendanceLock.findOne({
      siteId,
      date: attendanceDate,
      isLocked: true,
    }).session(session);

    if (existingLock) {
      throwValidationError(400, "Attendance is locked. Unlock before editing.");
    }

    // GET WORK CONFIG
    const workConfig = await workModel.findOne().session(session);

    if (!workConfig) {
      throwValidationError(404, "Work schedule configuration not found");
    }

    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
    } = workConfig;

    const processedRecords = [];
    const isHolidayResolved = await checkHolidayForDate(attendanceDate);

    // PROCESS EACH EMPLOYEE
    for (const entry of attendance) {
      const {
        employeeId,
        jobId,
        checkIn,
        checkOut,
        breaksTaken = null,
        isSickLeave,
      } = entry;


      // FIND ATTENDANCE DOC
      const attendanceDoc = await Attendance.findOne({
        employee: employeeId,
        date: attendanceDate,
      }).session(session);

      // MUST EXIST DURING EDIT
      if (!attendanceDoc) {
        continue;
      }

      // CALCULATE WORKED HOURS
      let workedHours = 0;

      if (checkIn && checkOut) {
        const diffMs = new Date(checkOut) - new Date(checkIn);
        workedHours = diffMs / (1000 * 60 * 60);

        if (workedHours < 0) {
          continue;
        }
      }

      // UPDATED SESSION
      const updatedSession = {
        siteId,
        jobId,
        checkIn,
        checkOut,
        workedHours,
        markedBy,
      };

      // FIND EXISTING SITE SESSION
      const existingSessionIndex = attendanceDoc.sessions.findIndex(
        (sessionObj) => sessionObj.siteId.toString() === siteId.toString()
      );

      // UPDATE EXISTING SESSION
      if (existingSessionIndex !== -1) {
        attendanceDoc.sessions[existingSessionIndex] = {
          ...attendanceDoc.sessions[existingSessionIndex].toObject(),
          ...updatedSession,
        };
      } else {
        // IF SESSION DOESN'T EXIST, ADD IT
        attendanceDoc.sessions.push(updatedSession);
      }

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      const closedSessions = autoClosePreviousSiteSessions(attendanceDoc.sessions, timezoneOffset, workConfig);
      attendanceDoc.sessions = closedSessions;

      // RECALCULATE TOTAL HOURS, STATUS & OT
      const rawHours = attendanceDoc.sessions.reduce(
        (acc, sessionObj) => acc + (sessionObj.workedHours || 0),
        0
      );

      const effectiveBreaksTaken = (breaksTaken !== null && breaksTaken !== undefined)
        ? breaksTaken
        : (attendanceDoc.breaksTaken ?? null);

      const { netWorkHours, status, overtimeHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken
      );

      // UPDATE DOC
      attendanceDoc.totalWorkHours = netWorkHours;
      attendanceDoc.status = status;
      attendanceDoc.overtimeHours = overtimeHours;
      if (breaksTaken !== undefined) {
        attendanceDoc.breaksTaken = breaksTaken;
      }
      attendanceDoc.isHoliday = isHolidayResolved;
      if (isSickLeave !== undefined) {
        // Soft: the pre-save hook clears it if the resulting session is filled.
        attendanceDoc.isSickLeave = !!isSickLeave;
      }



      await attendanceDoc.save({ session });

      processedRecords.push(attendanceDoc);
    }

    // LOCK AFTER EDIT
    await AttendanceLock.findOneAndUpdate(
      {
        siteId,
        date: attendanceDate,
      },
      {
        isLocked: true,
        lockedBy: markedBy,
        lockedAt: new Date(),
        unlockedBy: null,
        unlockedAt: null,
      },
      {
        new: true,
        session,
      }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Attendance edited successfully",
      recordsProcessed: processedRecords.length,
      data: processedRecords,
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to edit attendance",
      error: error.message,
      ...(error.extra || {}),
    });
  }
};//

export const updateAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { sessions, siteId: bodySiteId, breaksTaken, isSickLeave } = req.body;

    const { siteId: querySiteId } = req.query;
    const siteId = querySiteId || bodySiteId;
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];

    let fallbackOffset = -330;
    if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
      const parsedFallback = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
      if (!isNaN(parsedFallback)) {
        fallbackOffset = parsedFallback;
      }
    }

    let offsetVal = fallbackOffset;
    if (timezoneOffset !== null && timezoneOffset !== undefined) {
      const parsed = parseInt(timezoneOffset, 10);
      if (!isNaN(parsed)) {
        offsetVal = parsed;
      }
    }

    const attendance = await Attendance.findById(attendanceId);

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: "Attendance record not found",
      });
    }

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      // Check against the specific site being edited (siteId), not the doc's
      // primary/original site — a multi-site record can have sessions across
      // several sites, and a supervisor should be able to edit their own
      // site's session even if they weren't the one who created the doc.
      if (!user || !user.assignedSite || !siteId || user.assignedSite.toString() !== siteId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Access denied to this attendance record",
        });
      }
    }

    const workConfig = await workModel.findOne({
      type: "default",
    });

    if (!workConfig) {
      return res.status(404).json({
        success: false,
        message:
          "Work schedule configuration not found",
      });
    }

    if (Array.isArray(sessions)) {
      const cutoffHour = workConfig.nightShiftCutoffHour;

      // Validate sessions first
      for (const session of sessions) {
        // Determine if night shift automatically
        let sessionIsNight = session.isNightShift || false;
        if (session.checkIn) {
          const inDate = new Date(session.checkIn);
          const localInTime = new Date(inDate.getTime() - offsetVal * 60 * 1000);
          const inH = localInTime.getUTCHours();
          if (inH >= 0 && inH < cutoffHour) {
            sessionIsNight = true;
          }
          if (session.checkOut) {
            const outDate = new Date(session.checkOut);
            if (outDate < inDate) {
              sessionIsNight = true;
            }
          }
        }

        const inStr = toLocalTimeString(session.checkIn, offsetVal);
        const outStr = toLocalTimeString(session.checkOut, offsetVal);
        const boundsError = validateSessionTimes(inStr, outStr, sessionIsNight, cutoffHour);
        if (boundsError) {
          return res.status(400).json({
            success: false,
            message: boundsError,
          });
        }
      }

      const processedSessions = sessions.map(
        (session) => {
          // -----------------------------
          // Validation
          // -----------------------------
          if (
            !session.checkIn &&
            session.checkOut
          ) {
            throw new Error(
              "Check-out cannot exist without check-in"
            );
          }

          let workedHours = 0;
          let sessionIsNight = session.isNightShift || false;

          if (session.checkIn) {
            const inDate = new Date(session.checkIn);
            const localInTime = new Date(inDate.getTime() - offsetVal * 60 * 1000);
            const inH = localInTime.getUTCHours();
            if (inH >= 0 && inH < cutoffHour) {
              sessionIsNight = true;
            }

            const checkIn = new Date(
              session.checkIn
            );

            if (session.checkOut) {
              const checkOut = new Date(
                session.checkOut
              );

              // Handle cross-midnight: if checkOut is on the next day
              if (checkOut < checkIn) {
                checkOut.setDate(checkOut.getDate() + 1);
                sessionIsNight = true;
              }

              workedHours =
                (checkOut.getTime() -
                  checkIn.getTime()) /
                (1000 * 60 * 60);
            }
          }

          return {
            _id: session._id,
            siteId: session.siteId,
            jobId: session.jobId || null,
            checkIn:
              session.checkIn || null,
            checkOut:
              session.checkOut || null,
            workedHours: Number(
              workedHours.toFixed(2)
            ),
            isNightShift: sessionIsNight,
            markedBy:
              session.markedBy ||
              attendance.markedBy,
          };
        }
      );

      let combinedSessions = [];
      if (siteId) {
        // Filter processed sessions to only include target site sessions
        const siteSessions = processedSessions.filter(
          (session) => session.siteId.toString() === siteId.toString()
        );

        // Find existing sessions for this site
        const existingSiteSessions = attendance.sessions.filter(
          (session) => session.siteId.toString() === siteId.toString()
        );

        // Prevent deleting the only session for this site
        if (existingSiteSessions.length > 0 && siteSessions.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Cannot delete the only session for this site. You can leave its times blank instead.",
          });
        }

        // Preserve all sessions that belong to other sites
        const preservedSessions = attendance.sessions.filter(
          (session) => session.siteId.toString() !== siteId.toString()
        );
        combinedSessions = [...preservedSessions, ...siteSessions];
      } else {
        combinedSessions = processedSessions;
      }

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      combinedSessions = autoClosePreviousSiteSessions(combinedSessions, timezoneOffset, workConfig);

      // -----------------------------
      // Sort by checkIn
      // Empty sessions go last
      // -----------------------------
      combinedSessions.sort((a, b) => {
        if (!a.checkIn && !b.checkIn)
          return 0;

        if (!a.checkIn) return 1;

        if (!b.checkIn) return -1;

        return (
          new Date(a.checkIn) -
          new Date(b.checkIn)
        );
      });

      // -----------------------------
      // Overlap validation
      // -----------------------------
      const sessionsForValidation =
        combinedSessions.filter(
          (session) => session.checkIn
        );

      for (
        let i = 0;
        i <
        sessionsForValidation.length - 1;
        i++
      ) {
        const current =
          sessionsForValidation[i];

        const next =
          sessionsForValidation[i + 1];

        const currentStart = new Date(
          current.checkIn
        );

        const currentEnd = new Date(
          current.checkOut ||
          current.checkIn
        );

        const nextStart = new Date(
          next.checkIn
        );

        const nextEnd = new Date(
          next.checkOut ||
          next.checkIn
        );

        const hasOverlap =
          currentStart < nextEnd &&
          currentEnd > nextStart;

        if (hasOverlap) {
          let conflicting = next;
          if (siteId && current.siteId.toString() !== siteId.toString()) {
            conflicting = current;
          }

          const site = await Site.findById(conflicting.siteId).select("siteName");

          return res.status(400).json({
            success: false,
            message: "Attendance sessions overlap",

            overlap: {
              employeeId: attendance.employee,
              firstIndex: i,
              secondIndex: i + 1,

              sessionA: {
                _id: current._id,
                siteId: current.siteId,
                jobId: current.jobId,
                checkIn: current.checkIn,
                checkOut: current.checkOut,
              },

              sessionB: {
                _id: next._id,
                siteId: next.siteId,
                jobId: next.jobId,
                checkIn: next.checkIn,
                checkOut: next.checkOut,
              },

              conflictingSession: {
                siteId: conflicting.siteId,
                siteName: site ? (site.siteName || "Unknown Site") : "Unknown Site",
                jobId: conflicting.jobId,
                checkIn: conflicting.checkIn,
                checkOut: conflicting.checkOut,
              },
            },
          });
        }
      }

      attendance.sessions = combinedSessions;

      // Night shift detection
      const hasCrossedMidnight = detectCrossedMidnight(combinedSessions, timezoneOffset);
      attendance.crossedMidnight = hasCrossedMidnight;
      attendance.shiftType = hasCrossedMidnight ? "night" : "day";

      // -----------------------------
      // Total hours, status & OT
      // -----------------------------
      const rawHours = combinedSessions.reduce(
        (total, session) => total + (session.workedHours || 0),
        0
      );

      const effectiveBreaksTaken = (breaksTaken !== null && breaksTaken !== undefined)
        ? breaksTaken
        : (attendance.breaksTaken ?? null);

      const { netWorkHours, status: computedStatus, overtimeHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken
      );

      attendance.totalWorkHours = netWorkHours;
      attendance.overtimeHours = overtimeHours;
      attendance.status = computedStatus;
      if (breaksTaken !== undefined) {
        attendance.breaksTaken = breaksTaken;
      }
    }

    // -----------------------------
    // SICK LEAVE (hard validation)
    // -----------------------------
    // The inline/edit caller only ever sees the current site's sessions, so it
    // cannot know about a filled session at another site. If sick leave is
    // requested but the full record has any filled session, reject with a clear
    // message instead of silently flipping it off.
    if (isSickLeave !== undefined) {
      const hasFilledSession = attendance.sessions.some(
        (s) => s && (s.checkIn || s.checkOut)
      );

      if (isSickLeave && hasFilledSession) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot mark sick leave: this employee has attendance recorded at another site/session today.",
        });
      }

      attendance.isSickLeave = !!isSickLeave;
    }

    await attendance.save();

    const updatedAttendance =
      await Attendance.findById(
        attendance._id
      )
        .populate(
          "employee",
          "name employeeId jobTitle user employmentType"
        )
        .populate(
          "siteId",
          "siteName"
        )
        .populate("jobId", "name")
        .populate(
          "sessions.siteId",
          "siteName"
        )
        .populate(
          "sessions.jobId",
          "name"
        );

    const formattedAttendance = {
      attendanceId:
        updatedAttendance._id,

      employee:
        updatedAttendance.employee
          ?._id,

      name:
        updatedAttendance.employee
          ?.name || "",

      employeeId:
        updatedAttendance.employee
          ?.employeeId || "",

      jobTitle:
        updatedAttendance.employee
          ?.jobTitle || "",

      user:
        updatedAttendance.employee
          ?.user || null,

      employmentType:
        updatedAttendance.employee
          ?.employmentType,

      siteId:
        updatedAttendance.siteId
          ?._id,

      siteName:
        updatedAttendance.siteId
          ?.siteName || "",

      jobId:
        updatedAttendance.jobId
          ?._id || null,

      jobName:
        updatedAttendance.jobId
          ?.name || "",

      date: updatedAttendance.date,

      status:
        updatedAttendance.status,

      isHoliday:
        updatedAttendance.isHoliday,

      isSickLeave:
        updatedAttendance.isSickLeave || false,

      totalWorkHours:
        updatedAttendance.totalWorkHours,

      overtimeHours:
        updatedAttendance.overtimeHours,

      shiftType: updatedAttendance.shiftType,

      crossedMidnight: updatedAttendance.crossedMidnight,

      breaksTaken: updatedAttendance.breaksTaken,

      totalRawHours: updatedAttendance.sessions.reduce((total, session) => total + (session.workedHours || 0), 0),


      sessions:
        updatedAttendance.sessions.map(
          (session) => ({
            _id: session._id,

            siteId:
              session.siteId?._id,

            siteName:
              session.siteId
                ?.siteName || "",

            jobId:
              session.jobId?._id ||
              null,

            jobName:
              session.jobId?.name ||
              "",

            checkIn:
              session.checkIn,

            checkOut:
              session.checkOut,

            workedHours:
              session.workedHours,

            isNightShift:
              session.isNightShift || false,

            markedBy:
              session.markedBy,
          })
        ),
    };

    return res.status(200).json({
      success: true,
      message:
        "Attendance updated successfully",
      attendance:
        formattedAttendance,
    });
  } catch (error) {
    console.error(
      "Update attendance error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};//


export const getEmployeeAttendanceByMonth = async (req, res) => {
  try {
    const { employeeId } =
      req.params;

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      const employee = await Employee.findById(employeeId);
      if (!user || !employee || !user.assignedSite || employee.currentSite?.toString() !== user.assignedSite.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: Employee is not assigned to your site" });
      }
    }

    const { month, year } =
      req.query;

    if (
      !employeeId ||
      !month ||
      !year
    ) {
      return res.status(400).json({
        success: false,
        message:
          "employeeId, month and year are required",
      });
    }

    const startDate =
      new Date(
        Number(year),
        Number(month) - 1,
        1
      );

    const endDate =
      new Date(
        Number(year),
        Number(month),
        0,
        23,
        59,
        59,
        999
      );

    const attendance =
      await Attendance.find({
        employee: employeeId,

        date: {
          $gte: startDate,
          $lte: endDate,
        },
      })

        .populate(
          "employee",
          "name employeeId jobTitle"
        )

        .populate(
          "siteId",
          "siteName"
        )

        .populate(
          "jobId",
          "jobName"
        )

        .populate(
          "sessions.siteId",
          "siteName"
        )

        .populate(
          "sessions.jobId",
          "name"
        )

        .sort({
          date: 1,
        });

    const formattedData =
      attendance.map((record) => ({
        attendanceId:
          record._id,

        employee:
          record.employee._id,

        name:
          record.employee.name,

        employeeId:
          record.employee.employeeId,

        jobTitle:
          record.employee.jobTitle,

        siteId:
          record.siteId?._id,

        siteName:
          record.siteId?.siteName,

        jobId:
          record.jobId?._id || null,

        jobName:
          record.jobId?.name ||
          null,

        date: record.date,

        status:
          record.status,

        isHoliday:
          record.isHoliday,

        isSickLeave:
          record.isSickLeave || false,

        totalWorkHours:
          record.totalWorkHours,

        overtimeHours:
          record.overtimeHours,

        shiftType: record.shiftType,

        crossedMidnight: record.crossedMidnight,

        breaksTaken: record.breaksTaken,


        sessions:
          record.sessions.map(
            (session) => ({
              _id: session._id,

              siteId:
                session.siteId?._id,

              siteName:
                session.siteId
                  ?.siteName,

              jobId:
                session.jobId?._id ||
                null,

              jobName:
                session.jobId
                  ?.name ||
                null,

              checkIn:
                session.checkIn,

              checkOut:
                session.checkOut,

              workedHours:
                session.workedHours,

              isNightShift:
                session.isNightShift || false,

              markedBy:
                session.markedBy,
            })
          ),
      }));

    return res.status(200).json({
      success: true,

      totalRecords:
        formattedData.length,

      data: formattedData,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch attendance",
      error: error.message,
    });
  }
};//

export const getAttendanceById = async (req, res) => {
  try {
    const { attendanceId } = req.params
    const { siteId } = req.query

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      const record = await Attendance.findById(attendanceId);
      // Check against the specific site the caller is viewing (siteId), not
      // the doc's primary/original site — a multi-site record can contain
      // sessions for sites other than whichever one created the doc.
      if (
        !record ||
        !user ||
        !user.assignedSite ||
        !siteId ||
        user.assignedSite.toString() !== siteId.toString() ||
        !record.sessions.some((s) => s.siteId.toString() === siteId.toString())
      ) {
        return res.status(403).json({ success: false, message: "Forbidden: Access denied to this attendance record" });
      }
    }

    if (
      !mongoose.Types.ObjectId.isValid(
        attendanceId
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid attendance id",
      })
    }

    const result = await Attendance.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(
            attendanceId
          ),
        },
      },

      // Employee
      {
        $lookup: {
          from: "employees",
          localField: "employee",
          foreignField: "_id",
          as: "employee",
        },
      },
      {
        $unwind: "$employee",
      },

      // Main attendance site
      {
        $lookup: {
          from: "sites",
          localField: "siteId",
          foreignField: "_id",
          as: "attendanceSite",
        },
      },

      // Main attendance job
      {
        $lookup: {
          from: "jobs",
          localField: "jobId",
          foreignField: "_id",
          as: "attendanceJob",
        },
      },

      // Session sites
      {
        $lookup: {
          from: "sites",
          localField: "sessions.siteId",
          foreignField: "_id",
          as: "sessionSites",
        },
      },

      // Session jobs
      {
        $lookup: {
          from: "jobs",
          localField: "sessions.jobId",
          foreignField: "_id",
          as: "sessionJobs",
        },
      },

      {
        $project: {
          _id: 0,

          attendanceId: "$_id",

          employee: "$employee._id",

          name: "$employee.name",

          employeeId:
            "$employee.employeeId",

          jobTitle:
            "$employee.jobTitle",

          siteId: "$siteId",

          siteName: {
            $arrayElemAt: [
              "$attendanceSite.siteName",
              0,
            ],
          },

          jobId: "$jobId",

          jobName: {
            $arrayElemAt: [
              "$attendanceJob.name",
              0,
            ],
          },

          date: "$date",

          status: "$status",

          isHoliday: "$isHoliday",

          totalWorkHours:
            "$totalWorkHours",

          overtimeHours:
            "$overtimeHours",

          shiftType: "$shiftType",

          crossedMidnight: "$crossedMidnight",

          breaksTaken: "$breaksTaken",


          sessions: {
            $map: {
              input: "$sessions",
              as: "s",
              in: {
                _id: "$$s._id",

                siteId:
                  "$$s.siteId",

                siteName: {
                  $let: {
                    vars: {
                      matchedSite: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input:
                                "$sessionSites",
                              as: "site",
                              cond: {
                                $eq: [
                                  "$$site._id",
                                  "$$s.siteId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: "$$matchedSite.siteName",
                  },
                },

                jobId:
                  "$$s.jobId",

                jobName: {
                  $let: {
                    vars: {
                      matchedJob: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input:
                                "$sessionJobs",
                              as: "job",
                              cond: {
                                $eq: [
                                  "$$job._id",
                                  "$$s.jobId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: "$$matchedJob.name",
                  },
                },

                checkIn:
                  "$$s.checkIn",

                checkOut:
                  "$$s.checkOut",

                workedHours:
                  "$$s.workedHours",

                isNightShift:
                  "$$s.isNightShift",

                markedBy:
                  "$$s.markedBy",
              },
            },
          },
        },
      },
    ])

    if (!result.length) {
      return res.status(404).json({
        success: false,
        message:
          "Attendance record not found",
      })
    }

    return res.status(200).json(
      result[0]
    )
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch attendance record",
      error: error.message,
    })
  }
}//

export const addSessionToAttendance = async (
  req,
  res
) => {
  try {
    const { attendanceId } =
      req.params

    const { session } = req.body

    if (!session?.siteId) {
      return res.status(400).json({
        success: false,
        message:
          "Site ID is required",
      })
    }

    const attendance =
      await Attendance.findById(
        attendanceId
      )

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message:
          "Attendance record not found",
      })
    }

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      // Check against the NEW session's own site, not the doc's primary
      // site — this session may belong to a different site than whichever
      // site's submission originally created the doc.
      if (!user || !user.assignedSite || user.assignedSite.toString() !== session.siteId.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: Access denied to this attendance record" });
      }
    }

    // Check if there are any existing sessions for this site that are incomplete
    const incompleteSession = attendance.sessions.find(
      (s) => s.siteId.toString() === session.siteId.toString() && (!s.checkIn || !s.checkOut)
    );

    if (incompleteSession) {
      return res.status(400).json({
        success: false,
        message: "Please complete check-in and check-out for the existing session at this site first.",
      });
    }

    attendance.sessions.push({
      siteId: session.siteId,
      jobId:
        session.jobId || null,
      checkIn:
        session.checkIn || null,
      checkOut:
        session.checkOut || null,
      workedHours: 0,
      markedBy: req.user.id,
    })

    await attendance.save()

    const newSession =
      attendance.sessions[
        attendance.sessions.length - 1
      ]

    return res.status(201).json({
      success: true,
      message:
        "Session added successfully",
      session: newSession,
    })
  } catch (error) {
    console.log(error)

    return res.status(500).json({
      success: false,
      message:
        "Failed to add session",
    })
  }
}//


// POST /api/attendance/transfer
// Moves an employee from their current site to a new one, carrying their
// checkout time at the source site forward as the check-in at the
// destination. See empModel.js pendingTransfer* fields for why this can't
// always create a session directly (destination site may not have any
// saved attendance for today yet).
export const transferEmployee = async (req, res) => {
  const { employeeId, fromSiteId, toSiteId, jobId = null, date } = req.body

  if (!employeeId || !fromSiteId || !toSiteId || !date) {
    return res.status(400).json({
      success: false,
      message: "employeeId, fromSiteId, toSiteId and date are required",
    })
  }

  if (fromSiteId.toString() === toSiteId.toString()) {
    return res.status(400).json({
      success: false,
      message: "Target site must be different from the current site",
    })
  }

  const attendanceDate = new Date(date)
  attendanceDate.setUTCHours(0, 0, 0, 0)

  const dbSession = await mongoose.startSession()
  dbSession.startTransaction()

  try {
    const throwValidationError = (status, message) => {
      const err = new Error(message)
      err.status = status
      throw err
    }

    if (req.user.role === "supervisor") {
      const user = await userModel.findById(req.user.id).session(dbSession)
      if (!user || !user.assignedSite || user.assignedSite.toString() !== fromSiteId.toString()) {
        throwValidationError(403, "Forbidden: Access denied to this site")
      }
    }

    const toSite = await Site.findById(toSiteId).session(dbSession)
    if (!toSite || toSite.isDeleted || !toSite.isActive || toSite.isCompleted) {
      throwValidationError(400, "Target site is not a valid transfer destination")
    }

    if (jobId) {
      const job = await Job.findById(jobId).session(dbSession)
      if (!job || job.site.toString() !== toSiteId.toString()) {
        throwValidationError(400, "Job does not belong to the target site")
      }
    }

    const employee = await empModel.findById(employeeId).session(dbSession)
    if (!employee) {
      throwValidationError(404, "Employee not found")
    }

    const attendanceDoc = await Attendance.findOne({
      employee: employeeId,
      date: attendanceDate,
    }).session(dbSession)

    if (!attendanceDoc) {
      throwValidationError(400, "No attendance record found for this employee today")
    }

    const sourceSession = attendanceDoc.sessions
      .filter((s) => s.siteId.toString() === fromSiteId.toString())
      .sort((a, b) => new Date(b.checkIn || 0) - new Date(a.checkIn || 0))[0]

    if (!sourceSession || !sourceSession.checkIn) {
      throwValidationError(400, "Employee has not checked in at the current site today")
    }

    if (!sourceSession.checkOut) {
      throwValidationError(400, "Please complete the check-out for the current session before transferring")
    }

    const carriedCheckIn = sourceSession.checkOut

    const targetHasSavedRecord = await Attendance.exists({
      date: attendanceDate,
      "sessions.siteId": toSiteId,
    }).session(dbSession)

    if (targetHasSavedRecord) {
      const incompleteAtTarget = attendanceDoc.sessions.find(
        (s) => s.siteId.toString() === toSiteId.toString() && (!s.checkIn || !s.checkOut)
      )

      if (incompleteAtTarget) {
        throwValidationError(400, "Employee already has an incomplete session at the target site today")
      }

      attendanceDoc.sessions.push({
        siteId: toSiteId,
        jobId: jobId || null,
        checkIn: carriedCheckIn,
        checkOut: null,
        workedHours: 0,
        markedBy: req.user.id,
      })

      await attendanceDoc.save({ session: dbSession })
    } else {
      employee.pendingTransferCheckIn = carriedCheckIn
      employee.pendingTransferSiteId = toSiteId
      employee.pendingTransferDate = attendanceDate
    }

    const oldJobId = employee.currentJob
    if (oldJobId) {
      await Job.findByIdAndUpdate(
        oldJobId,
        { $pull: { employees: employee._id } },
        { session: dbSession }
      )
    }

    employee.currentJob = jobId || null
    employee.currentSite = toSiteId
    await employee.save({ session: dbSession })

    if (jobId) {
      await Job.findByIdAndUpdate(
        jobId,
        { $addToSet: { employees: employee._id } },
        { session: dbSession }
      )
    }

    if (employee.user) {
      await userModel.findByIdAndUpdate(
        employee.user,
        { assignedSite: toSiteId },
        { session: dbSession }
      )
    }

    await dbSession.commitTransaction()
    dbSession.endSession()

    await employee.populate("currentJob", "name")
    await employee.populate("currentSite", "siteName")

    return res.status(200).json({
      success: true,
      message: targetHasSavedRecord
        ? "Employee transferred; new session added at target site"
        : "Employee transferred; check-in will apply when the target site's attendance is next opened or submitted",
      pending: !targetHasSavedRecord,
      employee,
    })
  } catch (error) {
    await dbSession.abortTransaction()
    dbSession.endSession()
    console.error(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to transfer employee",
    })
  }
}//



// --- BACKFILL ---

// GET /api/attendance/missing?date=&name=&employeeId=&jobTitle=&page=&limit=
export const getMissingEmployees = async (req, res) => {
  try {
    let { date, name, employeeId, jobTitle, page = 1, limit = 10 } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required' });
    }

    page = Math.max(Number(page) || 1, 1);
    limit = Math.min(Number(limit) || 10, 50);
    const skip = (page - 1) * limit;

    // Date range for the selected day
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    // Get employee IDs that already have a record for this date
    const existingRecords = await Attendance.find({
      date: { $gte: startDate, $lte: endDate },
    }).select('employee').lean();

    const recordedEmployeeIds = existingRecords.map((r) => r.employee.toString());

    // Build employee filter
    let employeeFilter = { isActive: true };

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      if (!user || !user.assignedSite) {
        return res.status(200).json({
          success: true,
          pagination: { currentPage: page, totalPages: 0, totalEmployees: 0, limit },
          data: [],
        });
      }
      employeeFilter.currentSite = user.assignedSite;
    }

    if (recordedEmployeeIds.length > 0) {
      employeeFilter._id = { $nin: recordedEmployeeIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    if (name) {
      employeeFilter.name = { $regex: escapeRegExp(name), $options: 'i' };
    }
    if (employeeId) {
      employeeFilter.employeeId = { $regex: escapeRegExp(employeeId), $options: 'i' };
    }
    if (jobTitle) {
      employeeFilter.jobTitle = { $regex: escapeRegExp(jobTitle), $options: 'i' };
    }

    const totalEmployees = await Employee.countDocuments(employeeFilter);
    const totalPages = Math.ceil(totalEmployees / limit);

    const employees = await Employee.find(
      employeeFilter,
      '_id name employeeId jobTitle currentSite currentJob'
    )
      .populate('currentSite', 'siteName')
      .populate('currentJob', 'name')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      pagination: { currentPage: page, totalPages, totalEmployees, limit },
      data: employees,
    });
  } catch (error) {
    console.error('getMissingEmployees error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch missing employees' });
  }
};

// POST /api/attendance/backfill
// Body: { employeeMongoId, date, sessions: [{siteId, jobId, checkIn, checkOut, isNightShift}] }
export const backfillAttendance = async (req, res) => {
  try {
    const { employeeMongoId, date, sessions = [], breaksTaken = null, isSickLeave = false } = req.body;

    const markedBy = req.user?.id;
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];

    if (!employeeMongoId || !date) {
      return res.status(400).json({ success: false, message: 'employeeMongoId and date are required' });
    }

    // Verify employee exists
    const employee = await Employee.findById(employeeMongoId).lean();
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Check if a record already exists for this employee on this date
    const existing = await Attendance.findOne({ employee: employeeMongoId, date: attendanceDate });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Attendance record already exists for this employee on this date' });
    }

    const workConfig = await workModel.findOne({ type: 'default' });
    if (!workConfig) {
      return res.status(404).json({ success: false, message: 'Work schedule configuration not found' });
    }

    const { fullDayHours, halfDayHours, overtimeThreshold, nightShiftCutoffHour: cutoffHour } = workConfig;

    // Validate and build sessions
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ success: false, message: 'sessions must be an array' });
    }

    const builtSessions = [];

    for (const session of sessions) {
      const { siteId: sessionSiteId, jobId, checkIn, checkOut } = session;

      if (!sessionSiteId) {
        return res.status(400).json({ success: false, message: 'Every session must have a site selected' });
      }

      let sessionIsNight = false;
      if (checkIn) {
        const [inH, inM] = checkIn.split(':').map(Number);
        if (inH >= 0 && inH < cutoffHour) {
          sessionIsNight = true;
        }
        if (checkOut) {
          const [outH, outM] = checkOut.split(':').map(Number);
          if ((outH * 60 + outM) < (inH * 60 + inM)) {
            sessionIsNight = true;
          }
        }
      }

      const boundsError = validateSessionTimes(checkIn, checkOut, sessionIsNight, cutoffHour);
      if (boundsError) {
        return res.status(400).json({ success: false, message: boundsError });
      }

      let workedHours = 0;
      const cutoffOpts = { isNightShift: sessionIsNight, cutoffHour, timezoneOffset };

      const checkInDate = checkIn ? combineDateAndTime(date, checkIn, cutoffOpts) : null;
      const checkOutDate = checkOut ? combineDateAndTime(date, checkOut, { referenceCheckIn: checkIn, ...cutoffOpts }) : null;

      if (checkInDate && checkOutDate) {
        workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
        if (workedHours < 0 || workedHours > 24) {
          return res.status(400).json({ success: false, message: 'Invalid shift duration' });
        }
      }

      builtSessions.push({
        siteId: sessionSiteId,
        jobId: jobId || null,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        workedHours: Number(workedHours.toFixed(2)),
        markedBy,
        isNightShift: sessionIsNight,
      });
    }

    // Sort sessions by checkIn
    builtSessions.sort((a, b) => {
      if (!a.checkIn && !b.checkIn) return 0;
      if (!a.checkIn) return 1;
      if (!b.checkIn) return -1;
      return new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
    });

    // Overlap check
    const validSessions = builtSessions.filter((s) => s.checkIn);
    for (let i = 0; i < validSessions.length - 1; i++) {
      const a = validSessions[i];
      const b = validSessions[i + 1];
      const aStart = new Date(a.checkIn);
      const aEnd = a.checkOut ? new Date(a.checkOut) : aStart;
      const bStart = new Date(b.checkIn);
      const bEnd = b.checkOut ? new Date(b.checkOut) : bStart;

      if (aStart < bEnd && aEnd > bStart) {
        const siteId = req.query.siteId || req.body.siteId;
        let conflicting = b;
        if (siteId && a.siteId && a.siteId.toString() !== siteId.toString()) {
          conflicting = a;
        }
        const site = await Site.findById(conflicting.siteId).select("siteName");

        return res.status(400).json({
          success: false,
          message: 'Attendance sessions overlap',
          overlap: {
            employeeId: employeeMongoId,
            firstIndex: i,
            secondIndex: i + 1,
            sessionA: { checkIn: a.checkIn, checkOut: a.checkOut },
            sessionB: { checkIn: b.checkIn, checkOut: b.checkOut },
            conflictingSession: {
              siteId: conflicting.siteId,
              siteName: site ? (site.siteName || "Unknown Site") : "Unknown Site",
              jobId: conflicting.jobId,
              checkIn: conflicting.checkIn,
              checkOut: conflicting.checkOut,
            }
          },
        });
      }
    }

    // Totals
    const rawHours = Number(builtSessions.reduce((sum, s) => sum + (s.workedHours || 0), 0).toFixed(2));

    const { netWorkHours, status, overtimeHours } = computeAttendanceTotals(
      rawHours,
      workConfig,
      breaksTaken
    );

    const hasCrossedMidnight = detectCrossedMidnight(builtSessions, timezoneOffset);

    // Default siteId = first session's site (if any), else employee's current site
    const primarySiteId = builtSessions.length > 0 ? builtSessions[0].siteId : (employee.currentSite || null);

    if (!primarySiteId) {
      return res.status(400).json({ success: false, message: 'Could not determine a site for this record. Add at least one session with a site.' });
    }

    const isHolidayResolved = await checkHolidayForDate(attendanceDate);

    const newAttendance = new Attendance({
      employee: employeeMongoId,
      date: attendanceDate,
      siteId: primarySiteId,
      jobId: builtSessions.length > 0 ? (builtSessions[0].jobId || null) : null,
      markedBy,
      isHoliday: isHolidayResolved,
      isSickLeave: !!isSickLeave,
      status,
      totalWorkHours: netWorkHours,
      overtimeHours,
      breaksTaken: breaksTaken !== undefined ? breaksTaken : null,
      shiftType: hasCrossedMidnight ? 'night' : 'day',
      crossedMidnight: hasCrossedMidnight,
      sessions: builtSessions,
    });


    await newAttendance.save();

    // Populate for response
    const populated = await Attendance.findById(newAttendance._id)
      .populate('employee', 'name employeeId jobTitle')
      .populate('siteId', 'siteName')
      .populate('jobId', 'name')
      .populate('sessions.siteId', 'siteName')
      .populate('sessions.jobId', 'name')
      .lean();

    const record = populated;
    const formatted = {
      attendanceId: record._id,
      employee: record.employee?._id,
      name: record.employee?.name || '',
      employeeId: record.employee?.employeeId || '',
      jobTitle: record.employee?.jobTitle || '',
      siteId: record.siteId?._id,
      siteName: record.siteId?.siteName || '',
      jobId: record.jobId?._id || null,
      jobName: record.jobId?.name || '',
      date: record.date,
      status: record.status,
      isHoliday: record.isHoliday,
      isSickLeave: record.isSickLeave || false,
      totalWorkHours: record.totalWorkHours,
      overtimeHours: record.overtimeHours,
      breaksTaken: record.breaksTaken,
      shiftType: record.shiftType,
      crossedMidnight: record.crossedMidnight,
      sessions: record.sessions.map((session) => ({
        _id: session._id,
        siteId: session.siteId?._id,
        siteName: session.siteId?.siteName || '',
        jobId: session.jobId?._id || null,
        jobName: session.jobId?.name || '',
        checkIn: session.checkIn,
        checkOut: session.checkOut,
        workedHours: session.workedHours,
        isNightShift: session.isNightShift || false,
        markedBy: session.markedBy,
      })),
    };

    return res.status(201).json({ success: true, message: 'Attendance record created successfully', attendance: formatted });
  } catch (error) {
    console.error('backfillAttendance error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create attendance record', error: error.message });
  }
};


const getActiveSitesOverview = async (req, res) => {
  try {
    const { tab = 'inprogress', skip = 0, limit = 5 } = req.query;
    const parsedSkip = parseInt(skip) || 0;
    const parsedLimit = parseInt(limit) || 5;

    // Always return both counts for the tab badges
    const inProgressCount = await Site.countDocuments({ isActive: true, isCompleted: false, isDeleted: false });
    const completedCount = await Site.countDocuments({ isCompleted: true, isDeleted: false });

    let sites;
    let hasMore = false;

    if (tab === 'completed') {
      // Completed sites, sorted by updatedAt desc, paginated
      sites = await Site.find({ isCompleted: true, isDeleted: false })
        .sort({ updatedAt: -1 })
        .skip(parsedSkip)
        .limit(parsedLimit + 1) // fetch one extra to check hasMore
        .lean();
      
      if (sites.length > parsedLimit) {
        hasMore = true;
        sites = sites.slice(0, parsedLimit);
      }
    } else {
      // In-progress: active + incomplete
      sites = await Site.find({ isActive: true, isCompleted: false, isDeleted: false })
        .lean();
    }

    // Staff (white-collar) are excluded from man-hours / man-days stats.
    const staffIds = await getStaffEmployeeIds();

    // For each site, aggregate attendance metrics and get jobs
    const enrichedSites = await Promise.all(sites.map(async (site) => {
      const siteIdStr = site._id.toString();

      // Get attendance records with sessions for this site
      const records = await Attendance.find({
        'sessions.siteId': site._id,
        employee: { $nin: staffIds },
      }).lean();

      let totalManHours = 0;
      let totalManDays = 0;
      const calendarDays = new Set();

      for (const record of records) {
        const day = new Date(record.date).toISOString().split('T')[0];
        let workedOnSite = false;

        for (const session of record.sessions) {
          if (session.siteId?.toString() !== siteIdStr) continue;
          totalManHours += session.workedHours || 0;
          workedOnSite = true;
        }

        if (workedOnSite) {
          totalManDays += 1;
          calendarDays.add(day);
        }
      }

      // Get jobs for this site (non-deleted only)
      const jobs = await Job.find({ site: site._id, isDeleted: false })
        .select('_id name isCompleted isActive')
        .lean();

      return {
        siteId: site._id,
        siteName: site.siteName,
        locationDetails: site.locationDetails || '',
        isPermanent: site.isPermanent || false,
        totalManHours: Number(totalManHours.toFixed(2)),
        totalManDays,
        totalCalendarDays: calendarDays.size,
        jobs,
      };
    }));

    return res.status(200).json({
      success: true,
      inProgressCount,
      completedCount,
      sites: enrichedSites,
      hasMore,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};


// --- NIGHT SHIFT BULK ASSIGNMENT ---

// GET /api/attendance/night-shift/candidates?siteId=&date=&showOnlyEmpty=true&name=&employeeId=&jobTitle=
export const getNightShiftCandidates = async (req, res) => {
  try {
    const {
      siteId,
      date,
      showOnlyEmpty = "true",
      name,
      employeeId,
      jobTitle,
    } = req.query;

    if (!siteId || !date) {
      return res.status(400).json({
        success: false,
        message: "siteId and date are required",
      });
    }

    const onlyEmpty = showOnlyEmpty === "true" || showOnlyEmpty === true;

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // 1. Active employees assigned to this site
    const empFilter = { isActive: true, currentSite: siteId };

    if (name) empFilter.name = { $regex: escapeRegExp(name), $options: "i" };
    if (employeeId) empFilter.employeeId = { $regex: escapeRegExp(employeeId), $options: "i" };
    if (jobTitle) empFilter.jobTitle = { $regex: escapeRegExp(jobTitle), $options: "i" };

    const employees = await Employee.find(
      empFilter,
      "_id name employeeId jobTitle currentSite currentJob"
    )
      .populate("currentJob", "name")
      .sort({ name: 1 })
      .lean();

    // 2. Existing attendance records for these employees on the date
    const empIds = employees.map((e) => e._id);

    const records = await Attendance.find({
      date: attendanceDate,
      employee: { $in: empIds },
    }).lean();

    const recordByEmp = new Map();
    for (const rec of records) {
      recordByEmp.set(rec.employee.toString(), rec);
    }

    const siteIdStr = siteId.toString();

    // 3. Filter
    const candidates = employees.filter((emp) => {
      const rec = recordByEmp.get(emp._id.toString());

      const siteSessions = rec
        ? (rec.sessions || []).filter(
            (s) => s.siteId && s.siteId.toString() === siteIdStr
          )
        : [];

      // Exclude employees who don't have at least one session at this site
      if (siteSessions.length === 0) {
        return false;
      }

      // Exclude employees who already have a night shift session for this site/date
      if (siteSessions.some((s) => s.isNightShift === true)) {
        return false;
      }

      if (onlyEmpty) {
        // Has at least one session at this site that is empty or check-in-only (eligible for conversion)
        return siteSessions.some(
          (s) => (!s.checkIn && !s.checkOut) || (s.checkIn && !s.checkOut)
        );
      }

      // showOnlyEmpty = false → every other active employee (minus night-shift ones)
      return true;
    });

    return res.status(200).json({
      success: true,
      total: candidates.length,
      data: candidates,
    });
  } catch (error) {
    console.error("getNightShiftCandidates error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch night shift candidates",
    });
  }
};

// POST /api/attendance/night-shift/assign
// Body: { siteId, date, employeeIds: [string] }
export const assignNightShift = async (req, res) => {
  const { siteId, date, employeeIds } = req.body;
  const markedBy = req.user?.id;
  const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
    ? process.env.APP_TIMEZONE_OFFSET
    : req.headers["x-timezone-offset"];

  if (
    !siteId ||
    !date ||
    !Array.isArray(employeeIds) ||
    employeeIds.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: "siteId, date and employeeIds are required",
    });
  }

  const attendanceDate = new Date(date);
  attendanceDate.setUTCHours(0, 0, 0, 0);

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const workConfig = await workModel.findOne().session(dbSession);

    const fullDayHours = workConfig?.fullDayHours ?? 8;
    const halfDayHours = workConfig?.halfDayHours ?? 4;
    const overtimeThreshold = workConfig?.overtimeThreshold ?? 8;
    const cutoffHour = workConfig?.nightShiftCutoffHour ?? 7;

    // The night check-in is pre-filled at assignment time from the site's night
    // default (staff use their own staff-night default), replacing the old
    // auto-check-in cron.
    const siteDoc = await Site.findById(siteId)
      .select("nightDefaultCheckIn staffNightDefaultCheckIn")
      .session(dbSession);

    let processedCount = 0;

    for (const empId of employeeIds) {
      const emp = await Employee.findById(empId)
        .select("currentSite currentJob collarType")
        .session(dbSession);

      const isStaff = emp?.collarType === "staff";
      const nightDefaultIn = isStaff
        ? (siteDoc?.staffNightDefaultCheckIn || siteDoc?.nightDefaultCheckIn || "")
        : (siteDoc?.nightDefaultCheckIn || "");

      // Date object for the pre-filled check-in, or null if no default configured.
      const prefillCheckIn = nightDefaultIn
        ? combineDateAndTimeLocal(date, nightDefaultIn, { isNightShift: true, cutoffHour })
        : null;

      let attendanceDoc = await Attendance.findOne({
        employee: empId,
        date: attendanceDate,
      }).session(dbSession);

      const nightSession = {
        siteId,
        jobId: null,
        checkIn: prefillCheckIn,
        checkOut: null,
        workedHours: 0,
        markedBy,
        isNightShift: true,
      };

      if (!attendanceDoc) {
        // Case A: no record for the date → create one with a single night session
        if (
          emp?.currentJob &&
          emp.currentSite?.toString() === siteId.toString()
        ) {
          nightSession.jobId = emp.currentJob;
        }

        attendanceDoc = new Attendance({
          employee: empId,
          date: attendanceDate,
          siteId,
          jobId: nightSession.jobId,
          markedBy,
          status: "absent",
          sessions: [nightSession],
        });
      } else {
        const siteSessions = attendanceDoc.sessions.filter(
          (s) => s.siteId.toString() === siteId.toString()
        );

        // Idempotent: skip if a night shift already exists for this site
        if (siteSessions.some((s) => s.isNightShift)) {
          processedCount++;
          continue;
        }

        // Try to find an empty session for this site first
        const emptySiteSession = siteSessions.find(
          (s) => !s.checkIn && !s.checkOut
        );

        if (emptySiteSession) {
          // Case B: reuse an existing empty/absent session for this site
          emptySiteSession.isNightShift = true;
          emptySiteSession.checkIn = prefillCheckIn;
          emptySiteSession.markedBy = emptySiteSession.markedBy || markedBy;
        } else {
          // Try to find an active session (check-in only, empty check-out) for this site
          const activeSiteSession = siteSessions.find(
            (s) => s.checkIn && !s.checkOut
          );

          if (activeSiteSession) {
            // Case C: Convert check-in only session into a night shift, replacing
            // the day check-in with the night default check-in.
            activeSiteSession.checkIn = prefillCheckIn;
            activeSiteSession.checkOut = null;
            activeSiteSession.workedHours = 0;
            activeSiteSession.isNightShift = true;
            activeSiteSession.markedBy = activeSiteSession.markedBy || markedBy;
          } else {
            // Case D: All sessions are completed → push a new night session
            if (siteSessions.length > 0 && siteSessions[0].jobId) {
              nightSession.jobId = siteSessions[0].jobId;
            }
            attendanceDoc.sessions.push(nightSession);
          }
        }
      }

      // Safety: if the pre-filled check-in would overlap another session on this
      // record, clear it back to empty rather than persist an overlap.
      if (prefillCheckIn && hasSessionOverlap(
        attendanceDoc.sessions.map((s) => ({ checkIn: s.checkIn, checkOut: s.checkOut }))
      )) {
        const ns = attendanceDoc.sessions.find(
          (s) =>
            s.siteId.toString() === siteId.toString() &&
            s.isNightShift &&
            s.checkIn &&
            new Date(s.checkIn).getTime() === prefillCheckIn.getTime()
        );
        if (ns) ns.checkIn = null;
      }

      // Recalculate totals
      const rawHours = attendanceDoc.sessions.reduce(
        (sum, s) => sum + (s.workedHours || 0),
        0
      );

      const { netWorkHours, status, overtimeHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        attendanceDoc.breaksTaken ?? null
      );

      attendanceDoc.totalWorkHours = netWorkHours;
      attendanceDoc.status = status;
      attendanceDoc.overtimeHours = overtimeHours;


      // Document-level night shift detection
      const crossed = detectCrossedMidnight(
        attendanceDoc.sessions,
        timezoneOffset
      );
      attendanceDoc.crossedMidnight = crossed;
      attendanceDoc.shiftType = crossed ? "night" : "day";
      attendanceDoc.markedBy = attendanceDoc.markedBy || markedBy;

      await attendanceDoc.save({ session: dbSession });
      processedCount++;
    }

    await dbSession.commitTransaction();
    dbSession.endSession();

    return res.status(200).json({
      success: true,
      message: `Assigned night shift to ${processedCount} employee(s)`,
      recordsProcessed: processedCount,
    });
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    console.error("assignNightShift error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to assign night shift",
    });
  }
};


// --- DEFAULT EXPORT ---

const attendanceController = {
  monthlyReport,
  getSummary,
  unlockAttendance,
  updateAttendance,
  toggleHolidayStatus,

  getSiteAttendance,
  bulkEditAttendance,
  getAttendanceRecords,
  getEmployeeAttendanceByMonth,
  siteFirstSubmitAttendance,
  getAttendanceById,
  addSessionToAttendance,
  transferEmployee,
  getMissingEmployees,
  backfillAttendance,
  getActiveSitesOverview,

  getNightShiftCandidates,
  assignNightShift,

};

export default attendanceController;
