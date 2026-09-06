import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import attendanceAuditModel from '../models/attendanceAuditModel.js'
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
import { combineFromOffset, deriveOffsets, resolveDayOffsets, validateSessionTimesV2, MAX_SHIFT_HOURS, getDateLocal, getTodayLocal } from '../utils/timeLocal.js';
import { hasSessionOverlap, buildCrossDayOverlapChecker, crossDayOverlapMessage } from '../utils/sessionOverlap.js';
import { computeAttendanceTotals } from '../utils/attendanceMath.js';
import { isAssignableSite } from '../utils/siteAssignable.js';
import { supervisorMayCloseCarryover } from '../utils/carryoverAccess.js';
import { notifySiteSupervisors, findSiteSupervisors, notifyAdmins, notifyUser } from '../utils/notify.js';
import { placeMiddayArrival } from '../utils/handover.js';
import TransferRequest from '../models/transferRequestModel.js';
import { recordAttendanceAudit, recordAttendanceAuditBatch, resolveActor, buildAuditRow, breaksChangeSummary, summarizeAttendanceEdit, joinChangeParts } from '../utils/attendanceAudit.js';
import { recordSiteActivity } from '../utils/siteActivity.js';


// --- CURRENT-JOB SYNC ---
// Keep Employee.currentJob (the roster/"assigned job", scoped to currentSite) in step
// with the LATEST session's job. Job flows one way otherwise: currentJob seeds a new
// session's jobId, but a supervisor changing a session's job never flowed back. This
// syncs the reverse — but ONLY for the employee's most-recent record at their current
// site, so editing history (a past record) never rewrites the present roster. Setting
// the latest session's job to none mirrors currentJob to null. Maintains each job's
// employees[] like updateEmployeeJob (siteController). Pass the caller's mongoose
// session when it runs in a transaction; otherwise it runs un-sessioned.
async function syncCurrentJobFromLatestSession({ empId, siteId, recordDate, doc, session = null }) {
  if (!empId || !siteId || !recordDate || !doc) return;

  // Past edit? A newer record exists for this employee → leave currentJob alone.
  const laterExists = await Attendance.exists({
    employee: empId,
    date: { $gt: recordDate },
  }).session(session || null);
  if (laterExists) return;

  const employee = await Employee.findById(empId).session(session || null);
  // currentJob belongs to currentSite — only a session at that site may move it.
  if (!employee || !employee.currentSite || employee.currentSite.toString() !== siteId.toString()) {
    return;
  }

  // The latest session at this site (by check-in); its job is the target (null allowed).
  const siteSessions = (doc.sessions || []).filter(
    (s) => s.siteId && s.siteId.toString() === siteId.toString()
  );
  if (siteSessions.length === 0) return;

  const latest = [...siteSessions].sort(
    (a, b) => new Date(a.checkIn || 0).getTime() - new Date(b.checkIn || 0).getTime()
  ).at(-1);

  const targetJob = latest?.jobId || null;
  const currentJob = employee.currentJob || null;

  if ((currentJob ? currentJob.toString() : null) === (targetJob ? targetJob.toString() : null)) {
    return; // no change → skip (avoids needless job employees[] churn)
  }

  if (currentJob) {
    await Job.findByIdAndUpdate(
      currentJob,
      { $pull: { employees: employee._id } },
      { session: session || undefined }
    );
  }

  employee.currentJob = targetJob;
  await employee.save({ session: session || undefined });

  if (targetJob) {
    await Job.findByIdAndUpdate(
      targetJob,
      { $addToSet: { employees: employee._id } },
      { session: session || undefined }
    );
  }
}


// --- SHIFT HELPERS ---
// Combining a time onto a business day lives in utils/timeLocal.js (combineFromOffset /
// deriveOffsets) — cross-midnight is an explicit per-session day offset, not a cutoff.

function toLocalTimeString(dateVal, offsetVal) {
  if (!dateVal) return null;
  const dateObj = new Date(dateVal);
  if (isNaN(dateObj.getTime())) return null;
  const localTime = new Date(dateObj.getTime() - offsetVal * 60 * 1000);
  const h = String(localTime.getUTCHours()).padStart(2, '0');
  const m = String(localTime.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
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
 * Resolves whether a given date is a holiday and why.
 * @returns {Promise<{isHoliday: boolean, reason: "weekly"|"public"|null}>}
 *          "public" = CustomHoliday doc (incl. manually declared); "weekly" = WorkSchedule.weeklyHolidays.
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
function holidayInfoForEmployee(baseHolidayInfo, employmentType) {
  if (employmentType === "temporary") return { isHoliday: false, reason: null };
  return baseHolidayInfo;
}

/**
 * Automatically sets the check-out time of a previous session at a different site
 * to the check-in time of the current session, if the previous session is check-in only.
 */
function autoClosePreviousSiteSessions(sessions, timezoneOffset = null) {
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

        // Recalculate the cross-midnight flag cutoff-free: the closed session spans
        // midnight when its check-out wall time reads earlier than its check-in. The
        // pre-save hook re-derives the authoritative raw+offset from the Dates.
        let sessionIsNight = prev.isNightShift || false;
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

    // Temporary workers have no days off — holidays are ordinary working days for
    // them — so every calendar day counts as an expected working day.
    const expectedWorkingDaysAllDays = lastDayToCount;

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
        let holidayHours = 0;
        let payableDays = 0;
        let absentDays = 0;

        for (const record of records) {
          // Holiday work:
          // - Ignore status
          // - No payable day
          // - holidayHours (public → net hours; weekly → flat 15/10) tracked
          //   separately; on holidays overtime is already forced to 0 upstream.
          if (record.isHoliday) {
            holidayHours +=
              record.holidayHours || 0;

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

        // OT and holiday hours are paid at the same rate, so they combine into a
        // single "total OT" figure for reporting.
        const totalOvertimeHours = overtimeHours + holidayHours;

        const expected = employee.employmentType === "temporary"
          ? expectedWorkingDaysAllDays
          : expectedWorkingDays;

        const attendancePercentage = expected > 0
          ? Math.min((payableDays / expected) * 100, 100)
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

          holidayHours: round(
            holidayHours
          ),

          totalOvertimeHours: round(
            totalOvertimeHours
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


export const jobReport = async (req, res) => {
  try {
    const [jobs, results] = await Promise.all([
      Job.find({ isDeleted: { $ne: true } })
        .populate("site", "siteName isActive isPermanent isDeleted isCompleted")
        .lean(),

      Attendance.aggregate([
        { $addFields: { _rawTotal: { $sum: "$sessions.workedHours" } } },
        { $match: { _rawTotal: { $gt: 0 } } },
        { $unwind: "$sessions" },
        { $match: { "sessions.jobId": { $ne: null } } },
        {
          $group: {
            _id: "$sessions.jobId",
            // Normal (regular) hours = net worked minus overtime, i.e. the
            // base-rate portion — breaks and the OT hours excluded. Apportioned
            // to each job by its session's share of the day's raw worked hours,
            // matching how OT/holiday are split below. (_rawTotal > 0 is
            // guaranteed by the $match above, so the divide is safe.)
            normalHours: {
              $sum: {
                $multiply: [
                  {
                    $subtract: [
                      { $ifNull: ["$totalWorkHours", 0] },
                      { $ifNull: ["$overtimeHours", 0] },
                    ],
                  },
                  { $divide: [{ $ifNull: ["$sessions.workedHours", 0] }, "$_rawTotal"] },
                ],
              },
            },
            overtimeHours: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$overtimeHours", 0] },
                  { $divide: [{ $ifNull: ["$sessions.workedHours", 0] }, "$_rawTotal"] },
                ],
              },
            },
            holidayHours: {
              $sum: {
                $multiply: [
                  { $ifNull: ["$holidayHours", 0] },
                  { $divide: [{ $ifNull: ["$sessions.workedHours", 0] }, "$_rawTotal"] },
                ],
              },
            },
          },
        },
      ]),
    ]);

    const hoursMap = new Map();
    for (const r of results) {
      hoursMap.set(r._id.toString(), r);
    }

    const round = (n) => Number(n.toFixed(2));
    const siteMap = new Map();

    for (const job of jobs) {
      if (!job.site) continue;
      const siteId = job.site._id.toString();

      if (!siteMap.has(siteId)) {
        siteMap.set(siteId, {
          siteId,
          siteName: job.site.siteName,
          isActive: job.site.isActive !== false,
          isPermanent: job.site.isPermanent === true,
          isCompleted: job.site.isCompleted === true,
          jobs: [],
        });
      }

      const h = hoursMap.get(job._id.toString());
      const normal = h ? h.normalHours : 0;
      const ot = h ? h.overtimeHours : 0;
      const holiday = h ? h.holidayHours : 0;

      siteMap.get(siteId).jobs.push({
        jobId: job._id,
        jobCode: job.jobCode,
        jobName: job.name,
        isActive: job.isActive !== false,
        isCompleted: job.isCompleted === true,
        normalHours: round(normal),
        overtimeHours: round(ot),
        holidayHours: round(holiday),
        totalOTHours: round(ot + holiday),
      });
    }

    const report = Array.from(siteMap.values()).sort((a, b) =>
      a.siteName.localeCompare(b.siteName)
    );

    return res.status(200).json({ success: true, report });
  } catch (error) {
    console.error("jobReport error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate job report",
    });
  }
};


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

    // Update all attendance records for that day. Manual declaration is always a
    // PUBLIC holiday (weekly holidays can't be toggled — guarded above), so
    // holidayHours = net worked hours and overtime is zeroed. Removing the holiday
    // restores overtime from the stored net hours. Aggregation-pipeline update so
    // per-record totals can be derived in one bulk write.
    const overtimeThreshold = (await workModel.findOne({ type: "default" })
      .select("overtimeThreshold")
      .session(session))?.overtimeThreshold ?? 0

    // When DECLARING a holiday, skip temporary workers — a holiday is a normal
    // working day for them (no holiday hours, overtime not zeroed). Un-marking a
    // holiday can safely apply to everyone (it just clears holiday state).
    const dateMatch = { date: { $gte: startOfDay, $lte: endOfDay } }
    const updateMatch = isHoliday
      ? {
          ...dateMatch,
          employee: {
            $nin: await empModel
              .find({ employmentType: "temporary" })
              .distinct("_id")
              .session(session),
          },
        }
      : dateMatch

    const result = await Attendance.updateMany(
      updateMatch,
      isHoliday
        ? [
            {
              $set: {
                isHoliday: true,
                holidayReason: "public",
                holidayHours: { $ifNull: ["$totalWorkHours", 0] },
                overtimeHours: 0,
              },
            },
          ]
        : [
            {
              $set: {
                isHoliday: false,
                holidayReason: null,
                holidayHours: 0,
                overtimeHours: {
                  $round: [
                    {
                      $max: [
                        { $subtract: [{ $ifNull: ["$totalWorkHours", 0] }, overtimeThreshold] },
                        0,
                      ],
                    },
                    2,
                  ],
                },
              },
            },
          ],
      // Mongoose requires this opt-in to accept an aggregation pipeline update
      { updatePipeline: true }
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
    const holidayInfo = await checkHolidayForDate(attendanceDate);

    // Cross-day guard: a session can extend past midnight, so it may collide with a session
    // stored on an ADJACENT day's record (e.g. yesterday's night shift ending 08:00 vs a
    // 06:00 start today). Prefetched once for the whole batch.
    const crossDayConflict = await buildCrossDayOverlapChecker({
      employeeIds: attendance.map((e) => e?.employee?._id).filter(Boolean),
      date: attendanceDate,
      dbSession: session,
    });

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

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
          isHoliday: holidayInfo.isHoliday,
          holidayReason: holidayInfo.reason,
          status: "absent",
          sessions: [],
        })
      }

      // Snapshot state before mutation for the audit log: whether this is the first save
      // of the day (submitted) vs a merge/edit into an existing record, and the prior
      // break override so a change can be logged distinctly.
      const wasNew = attendanceDoc.isNew;
      const prevBreaks = attendanceDoc.breaksTaken ?? null;

      // Look up a pending transfer targeting THIS site/date so the resulting
      // session carries its source site (powers the "Transferred from <Site>"
      // indicator once attendance is saved). The stash itself is cleared after
      // save, below.
      const empPending = await empModel.findById(empId)
        .select("pendingTransferSiteId pendingTransferDate pendingTransferFromSiteId employmentType")
        .session(session)

      // Temporary workers are exempt from holiday treatment — for them a holiday
      // is a normal working day (normal hours + OT, no holiday-hours credit).
      const effHolidayInfo = holidayInfoForEmployee(holidayInfo, empPending?.employmentType)

      const transferredFromForSite =
        empPending?.pendingTransferSiteId &&
          empPending.pendingTransferSiteId.toString() === siteId.toString() &&
          empPending.pendingTransferDate &&
          new Date(empPending.pendingTransferDate).getTime() === attendanceDate.getTime()
          ? empPending.pendingTransferFromSiteId
          : null

      // -----------------------------
      // BUILD SESSIONS
      // -----------------------------
      const updatedSessions = []

      // Sessions this record already holds at OTHER sites — part of the same physical
      // timeline, so a site-switch continuation inherits their midnight crossing.
      const otherSiteSessions =
        attendanceDoc.sessions.filter(
          (s) =>
            s.siteId.toString() !==
            siteId.toString()
        )

      // Cutoff-free (cutoff redesign): cross-midnight is an explicit per-session fact.
      // Resolved as a MONOTONIC timeline over the record — the check-out rolls to the next
      // day when it reads earlier than the check-in, and a session that would land before a
      // crossing already made inherits it (19:00→01:00 then 01:00→08:00). An explicit
      // client flag (checkInNextDay / checkOutNextDay) always wins, which is what expresses
      // the two cases the clock cannot disambiguate: a standalone early-morning tail and
      // shifts of 24h+.
      const resolvedOffsets = resolveDayOffsets(
        date,
        sessions.map((s) => ({
          rawCheckIn: s.checkIn,
          rawCheckOut: s.checkOut,
          checkInNextDay: s.checkInNextDay,
          checkOutNextDay: s.checkOutNextDay,
          startsAfterMidnight: s.startsAfterMidnight,
        })),
        otherSiteSessions
      )

      for (const [sessionIndex, sessionObj] of sessions.entries()) {
        const {
          siteId: sessionSiteId,
          job,
          checkIn,
          checkOut,
          manuallyCleared = false,
        } = sessionObj

        const finalSiteId = sessionSiteId || siteId

        const { checkInNextDay, checkOutNextDay } = resolvedOffsets[sessionIndex]

        const boundsError = validateSessionTimesV2(checkIn, checkOut, checkInNextDay, checkOutNextDay);
        if (boundsError) {
          throwValidationError(400, boundsError);
        }

        const checkInDate = checkIn ? combineFromOffset(date, checkIn, checkInNextDay) : null
        const checkOutDate = checkOut ? combineFromOffset(date, checkOut, checkOutNextDay) : null

        let workedHours = 0
        // VALID SESSION ONLY IF BOTH EXIST
        if (checkInDate && checkOutDate) {
          if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
            throwValidationError(400, "Invalid checkIn/checkOut");
          }
          workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60)
          if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
            throwValidationError(400, "Invalid shift duration");
          }
        }

        // RULE: checkIn only OR null/null → 0 hours
        updatedSessions.push({
          siteId: finalSiteId,
          jobId: job?._id || null,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          rawCheckIn: checkIn || null,
          rawCheckOut: checkOut || null,
          checkInNextDay,
          checkOutNextDay,
          workedHours: Number(workedHours.toFixed(2)),
          markedBy,
          // Retained for back-compat reads: a session "crosses midnight" when either
          // endpoint lands on the next day. The pre-save hook re-derives raw+offset.
          isNightShift: checkInNextDay || checkOutNextDay,
          // A filled check-in always clears the deliberate-absence flag.
          manuallyCleared: checkInDate ? false : !!manuallyCleared,
          // Carry the transfer source onto the session created for this site.
          transferredFromSiteId:
            finalSiteId.toString() === siteId.toString() ? transferredFromForSite : null,
        })
      }

      // -----------------------------
      // MERGE WITH OTHER SITE SESSIONS
      // -----------------------------

      const mergedSessions = [
        ...otherSiteSessions,
        ...updatedSessions,
      ]

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      autoClosePreviousSiteSessions(mergedSessions, timezoneOffset);

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

      // Cross-day: the same real hours must not also be recorded on an adjacent day.
      const neighbourConflict = crossDayConflict(empId, mergedSessions);
      if (neighbourConflict) {
        throwValidationError(400, crossDayOverlapMessage(neighbourConflict));
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

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken,
        effHolidayInfo
      )

      attendanceDoc.totalWorkHours = netWorkHours
      attendanceDoc.status = status
      attendanceDoc.overtimeHours = overtimeHours
      if (breaksTaken !== undefined) {
        attendanceDoc.breaksTaken = breaksTaken
      }
      attendanceDoc.isHoliday = effHolidayInfo.isHoliday
      attendanceDoc.holidayReason = effHolidayInfo.reason
      attendanceDoc.holidayHours = holidayHours
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
            pendingTransferFromSiteId: null,
            pendingTransferJobId: null,
          },
        },
        { session }
      )

      // Keep the roster job in step with the latest session's job (this record's
      // site, and only when it is the employee's most-recent record).
      await syncCurrentJobFromLatestSession({
        empId,
        siteId,
        recordDate: attendanceDate,
        doc: attendanceDoc,
        session,
      })

      processedRecords.push(attendanceDoc)

      // --- Audit rows for this record (flushed in one insertMany below) ---
      const newBreaks = attendanceDoc.breaksTaken ?? null;
      if (!wasNew && newBreaks !== prevBreaks) {
        auditRows.push(buildAuditRow(attendanceDoc, auditActor, "breaks_changed", breaksChangeSummary(prevBreaks, newBreaks)));
      }
      // First submit gets a richer line: the day's opening check-in, and whether that
      // check-in was the category default the roster auto-filled (checkInAutoInit — sent by
      // the client and still untouched by the supervisor) vs. a time they actually entered.
      // Edits keep the generic line.
      let submitSummary = "Attendance submitted";
      if (wasNew) {
        const firstIn = sessions.find((s) => s && s.checkIn);
        if (isSickLeave) {
          submitSummary = "Attendance submitted (sick leave)";
        } else if (!firstIn) {
          submitSummary = "Attendance submitted (absent)";
        } else if (firstIn.checkInAutoInit) {
          submitSummary = `Attendance submitted with an auto-initialized check-in of ${firstIn.checkIn}`;
        } else {
          submitSummary = `Attendance submitted with a check-in of ${firstIn.checkIn}`;
        }
      }
      auditRows.push(buildAuditRow(
        attendanceDoc,
        auditActor,
        wasNew ? "submitted" : "edited",
        wasNew ? submitSummary : "Attendance edited"
      ));
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

    // Audit log joins the same transaction (best-effort inside the helper).
    await recordAttendanceAuditBatch(auditRows, session);

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

      // Resolve the transfer source for this site (if any session at this site
      // was transferred in). Takes the first session carrying a source site.
      {
        $addFields: {
          transferredFromSiteId: {
            $let: {
              vars: {
                transferredSessions: {
                  $filter: {
                    input: "$filteredSessions",
                    as: "s",
                    cond: { $ne: ["$$s.transferredFromSiteId", null] },
                  },
                },
              },
              in: { $arrayElemAt: ["$$transferredSessions.transferredFromSiteId", 0] },
            },
          },
        },
      },

      {
        $lookup: {
          from: "sites",
          localField: "transferredFromSiteId",
          foreignField: "_id",
          as: "transferredFromSite",
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

          holidayReason: "$holidayReason",

          holidayHours: "$holidayHours",

          isSickLeave: "$isSickLeave",

          employee: "$employee._id",

          name: "$employee.name",

          employeeId: "$employee.employeeId",

          jobTitle: "$employee.jobTitle",

          user: "$employee.user",

          employmentType: "$employee.employmentType",

          collarType: "$employee.collarType",

          nationality: "$employee.nationality",

          status: "$status",

          totalWorkHours: "$totalWorkHours",

          overtimeHours: "$overtimeHours",

          shiftType: "$shiftType",

          crossedMidnight: "$crossedMidnight",

          breaksTaken: "$breaksTaken",

          totalRawHours: "$totalRawHours",

          // { siteId, name } when this employee was transferred into this site
          // (day-scoped), else null. Drives the "Transferred from <Site>" badge.
          transferredFrom: {
            $cond: [
              { $gt: [{ $size: "$transferredFromSite" }, 0] },
              {
                siteId: { $toString: "$transferredFromSiteId" },
                name: { $arrayElemAt: ["$transferredFromSite.siteName", 0] },
              },
              null,
            ],
          },


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

    // Day-level holiday flag comes from the date itself, not from an employee's
    // record — temporary workers now store isHoliday:false even on a holiday, so a
    // temp row sorting first must not hide the banner.
    const { isHoliday, reason: holidayReason } = await checkHolidayForDate(queryDate)

    return res.status(200).json({
      totalRecords: result.length,
      isHoliday,
      holidayReason,
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

// Employee-scoped carryover fetch (the "follow the employee" flow). Unlike
// getSiteAttendance (which surfaces only sessions AT this site), this returns the
// PRIOR-DAY open sessions of the employees rostered here TODAY, regardless of which
// site those open shifts physically live at. That lets an employee's forgotten
// check-out surface — and be closed — on whatever site they have since moved to.
// Roster anchor is `currentSite` (permanent/scheduled moves update it; a today-only
// visit leaves it at the home site, so a visitor's carryover follows to their home
// instead of appearing on a site they're only visiting).
export const getSiteCarryovers = async (req, res) => {
  try {
    const { siteId, date } = req.query

    if (!siteId || !mongoose.Types.ObjectId.isValid(siteId)) {
      return res.status(400).json({
        success: false,
        message: "A valid siteId is required",
      })
    }

    const siteObjectId = new mongoose.Types.ObjectId(siteId)

    // The open sessions we surface live on the day BEFORE the target day (default:
    // yesterday). Match the stored UTC-midnight `date` the same way getSiteAttendance does.
    const prevDayStr = date || getDateLocal(-1)
    const queryDate = new Date(prevDayStr)
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

    // Employees rostered at this site today (home roster). A row exists on the board
    // for these; the carryover badge hangs on that row all day.
    const rosterEmployees = await Employee.find({
      currentSite: siteObjectId,
    }).select("_id")

    const rosterIds = rosterEmployees.map((e) => e._id)
    if (rosterIds.length === 0) {
      return res.status(200).json({ success: true, data: [] })
    }

    // Their prior-day records that still carry an open session (any site).
    const records = await Attendance.find({
      employee: { $in: rosterIds },
      date: { $gte: start, $lte: end },
      sessions: { $elemMatch: { checkIn: { $ne: null }, checkOut: null } },
    })
      .populate({ path: "employee", select: "name employeeId" })
      .populate({ path: "sessions.siteId", select: "siteName" })

    // Shape to mirror getSiteAttendance's rows (attendanceId, employee = id, name,
    // employeeId, sessions[]) but WITHOUT pre-filtering to one site, and carry each
    // session's siteName so the client knows the open shift's HOME site.
    const data = records.map((rec) => ({
      attendanceId: rec._id,
      date: rec.date,
      employee: (rec.employee?._id || rec.employee)?.toString() || null,
      name: rec.employee?.name || "",
      employeeId: rec.employee?.employeeId || "",
      sessions: (rec.sessions || []).map((s) => ({
        _id: s._id,
        siteId: (s.siteId?._id || s.siteId)?.toString() || null,
        siteName: s.siteId?.siteName || null,
        jobId: s.jobId || null,
        checkIn: s.checkIn || null,
        checkOut: s.checkOut || null,
        rawCheckIn: s.rawCheckIn || null,
        rawCheckOut: s.rawCheckOut || null,
        workedHours: s.workedHours,
        isNightShift: s.isNightShift,
      })),
    }))

    data.sort((a, b) => a.name.localeCompare(b.name))

    return res.status(200).json({ success: true, data })
  } catch (error) {
    console.error("getSiteCarryovers error:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch carryovers",
    })
  }
}

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

    limit = Math.min(Number(limit) || 20, 100);

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
      // Match either the record's anchor site OR any session's site, so an
      // employee who worked a session at this site shows up under it even when
      // the record is rooted elsewhere (multi-site day). The root-siteId branch
      // keeps absent records (no sessions) visible under their own site. Both
      // `siteId` and `sessions.siteId` are indexed with `date`, so each $or arm
      // rides a compound index.
      attendanceFilter.$or = [
        { siteId: site },
        { "sessions.siteId": site },
      ]
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

        holidayReason: record.holidayReason || null,

        holidayHours: record.holidayHours || 0,

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

    // Common holiday flag — derived from the date itself (temporary workers store
    // isHoliday:false even on a holiday, so a temp row must not hide it). Only
    // meaningful when a single date is queried.
    const dayHoliday = date
      ? await checkHolidayForDate(new Date(date))
      : { isHoliday: false, reason: null };
    const isHoliday = dayHoliday.isHoliday;
    const holidayReason = dayHoliday.reason;

    return res.status(200).json({
      success: true,

      isHoliday,

      holidayReason,

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
    const holidayInfo = await checkHolidayForDate(attendanceDate);

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

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

      // Snapshot the break override before mutation, so a change can be logged distinctly.
      const prevBreaks = attendanceDoc.breaksTaken ?? null;

      // Temporary workers are exempt from holiday treatment — for them a holiday
      // is a normal working day (normal hours + OT, no holiday-hours credit).
      const editEmp = await empModel.findById(employeeId)
        .select("employmentType")
        .session(session);
      const effHolidayInfo = holidayInfoForEmployee(holidayInfo, editEmp?.employmentType);

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
        const existingObj = attendanceDoc.sessions[existingSessionIndex].toObject();
        // Deliberate-absence flag: filled check-in clears it; emptying a
        // previously filled session sets it; otherwise keep as-is.
        let manuallyCleared = existingObj.manuallyCleared || false;
        if (checkIn) {
          manuallyCleared = false;
        } else if (existingObj.checkIn || existingObj.checkOut) {
          manuallyCleared = true;
        }
        attendanceDoc.sessions[existingSessionIndex] = {
          ...existingObj,
          ...updatedSession,
          manuallyCleared,
        };
      } else {
        // IF SESSION DOESN'T EXIST, ADD IT
        attendanceDoc.sessions.push(updatedSession);
      }

      // -----------------------------
      // AUTO CLOSE PREVIOUS SESSIONS
      // -----------------------------
      const closedSessions = autoClosePreviousSiteSessions(attendanceDoc.sessions, timezoneOffset);
      attendanceDoc.sessions = closedSessions;

      // RECALCULATE TOTAL HOURS, STATUS & OT
      const rawHours = attendanceDoc.sessions.reduce(
        (acc, sessionObj) => acc + (sessionObj.workedHours || 0),
        0
      );

      const effectiveBreaksTaken = (breaksTaken !== null && breaksTaken !== undefined)
        ? breaksTaken
        : (attendanceDoc.breaksTaken ?? null);

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken,
        effHolidayInfo
      );

      // UPDATE DOC
      attendanceDoc.totalWorkHours = netWorkHours;
      attendanceDoc.status = status;
      attendanceDoc.overtimeHours = overtimeHours;
      if (breaksTaken !== undefined) {
        attendanceDoc.breaksTaken = breaksTaken;
      }
      attendanceDoc.isHoliday = effHolidayInfo.isHoliday;
      attendanceDoc.holidayReason = effHolidayInfo.reason;
      attendanceDoc.holidayHours = holidayHours;
      if (isSickLeave !== undefined) {
        // Soft: the pre-save hook clears it if the resulting session is filled.
        attendanceDoc.isSickLeave = !!isSickLeave;
      }



      await attendanceDoc.save({ session });

      processedRecords.push(attendanceDoc);

      // --- Audit rows for this record (flushed in one insertMany below) ---
      const newBreaks = attendanceDoc.breaksTaken ?? null;
      if (newBreaks !== prevBreaks) {
        auditRows.push(buildAuditRow(attendanceDoc, auditActor, "breaks_changed", breaksChangeSummary(prevBreaks, newBreaks)));
      }
      auditRows.push(buildAuditRow(attendanceDoc, auditActor, "edited", "Attendance edited"));
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

    // Audit log joins the same transaction (best-effort inside the helper).
    await recordAttendanceAuditBatch(auditRows, session);

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

    // Snapshot state before any edit, so the audit log can describe exactly what changed:
    // the break override, the status/sick flags, and each session's identity + raw times.
    const prevBreaks = attendance.breaksTaken ?? null;
    const prevStatus = attendance.status;
    const prevSick = attendance.isSickLeave;
    const prevSessionsSnap = attendance.sessions.map((s) => ({
      _id: s._id,
      siteId: s.siteId,
      jobId: s.jobId,
      rawCheckIn: s.rawCheckIn,
      rawCheckOut: s.rawCheckOut,
    }));

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      // Check against the specific site being edited (siteId), not the doc's
      // primary/original site — a multi-site record can have sessions across
      // several sites, and a supervisor should be able to edit their own
      // site's session even if they weren't the one who created the doc.
      const sameSite = !!(user && user.assignedSite && siteId && user.assignedSite.toString() === siteId.toString());
      // Employee-scoped carryover exception: also allow closing another site's
      // dangling open shift for an employee who has since moved onto this
      // supervisor's roster (see utils/carryoverAccess.js).
      const carryoverOk = !sameSite && user && user.assignedSite
        ? await supervisorMayCloseCarryover(attendance, user.assignedSite, siteId)
        : false;
      if (!sameSite && !carryoverOk) {
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
      // The record's business day as YYYY-MM-DD — the anchor for offset-based combine.
      const recordDateStr = new Date(attendance.date).toISOString().split("T")[0];

      // Validate sessions first (cutoff-free): pull each endpoint's raw HH:mm from the
      // client-combined ISO Date, derive the day offsets from those times, and validate
      // ordering + duration only. No site cutoff.
      for (const session of sessions) {
        const inStr = toLocalTimeString(session.checkIn, offsetVal);
        const outStr = toLocalTimeString(session.checkOut, offsetVal);
        const derivedOffsets = deriveOffsets(inStr, outStr, !!session.startsAfterMidnight);
        const checkInNextDay = typeof session.checkInNextDay === 'boolean' ? session.checkInNextDay : derivedOffsets.checkInNextDay;
        const checkOutNextDay = typeof session.checkOutNextDay === 'boolean' ? session.checkOutNextDay : derivedOffsets.checkOutNextDay;
        const boundsError = validateSessionTimesV2(inStr, outStr, checkInNextDay, checkOutNextDay);
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

          // Cutoff-free: extract raw HH:mm from the client-combined ISO Dates, derive the
          // day offsets, and recombine canonical Dates from the record's business day so
          // the stored timestamp and the offset flags can never drift.
          const inStr = toLocalTimeString(session.checkIn, offsetVal);
          const outStr = toLocalTimeString(session.checkOut, offsetVal);
          const derivedOffsets = deriveOffsets(inStr, outStr, !!session.startsAfterMidnight);
          const checkInNextDay = typeof session.checkInNextDay === 'boolean' ? session.checkInNextDay : derivedOffsets.checkInNextDay;
          const checkOutNextDay = typeof session.checkOutNextDay === 'boolean' ? session.checkOutNextDay : derivedOffsets.checkOutNextDay;

          const checkInDate = session.checkIn ? combineFromOffset(recordDateStr, inStr, checkInNextDay) : null;
          const checkOutDate = session.checkOut ? combineFromOffset(recordDateStr, outStr, checkOutNextDay) : null;

          let workedHours = 0;
          if (checkInDate && checkOutDate) {
            workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
          }

          // Match the existing stored session (by _id) so edit-only fields
          // like the transfer source are preserved rather than dropped when
          // the session is rebuilt from the request body.
          const existingSession = session._id
            ? attendance.sessions.find(
                (s) => s._id.toString() === session._id.toString()
              )
            : null;

          // Deliberate-absence flag: a filled check-in always clears it; an
          // emptied session that previously had times was explicitly cleared
          // by the editor; an untouched empty session keeps its flag.
          let manuallyCleared = false;
          if (!session.checkIn) {
            if (existingSession && (existingSession.checkIn || existingSession.checkOut)) {
              manuallyCleared = true;
            } else if (existingSession) {
              manuallyCleared = existingSession.manuallyCleared || false;
            } else {
              manuallyCleared = !!session.manuallyCleared;
            }
          }

          return {
            _id: session._id,
            siteId: session.siteId,
            jobId: session.jobId || null,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            rawCheckIn: inStr,
            rawCheckOut: outStr,
            checkInNextDay,
            checkOutNextDay,
            workedHours: Number(
              workedHours.toFixed(2)
            ),
            isNightShift: checkInNextDay || checkOutNextDay,
            manuallyCleared,
            // Preserve the transfer source across edits (badge must survive
            // the destination supervisor filling in a check-out, etc.).
            transferredFromSiteId: existingSession?.transferredFromSiteId || null,
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
      combinedSessions = autoClosePreviousSiteSessions(combinedSessions, timezoneOffset);

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

      // Cross-day: an edited session can extend past midnight into a day whose record
      // already covers those hours (e.g. closing a night shift at 08:00 when the next
      // morning already has a 06:00 start). Guarded here as well as on submit.
      const crossDayConflict = await buildCrossDayOverlapChecker({
        employeeIds: [attendance.employee],
        date: attendance.date,
      });
      const neighbourConflict = crossDayConflict(attendance.employee, combinedSessions);
      if (neighbourConflict) {
        return res.status(400).json({
          success: false,
          message: crossDayOverlapMessage(neighbourConflict),
        });
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

      // Holiday state is fixed by the record's date — reuse the stored values so
      // editing hours on a holiday recomputes holidayHours correctly.
      const { netWorkHours, status: computedStatus, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        effectiveBreaksTaken,
        { isHoliday: attendance.isHoliday, reason: attendance.holidayReason }
      );

      attendance.totalWorkHours = netWorkHours;
      attendance.overtimeHours = overtimeHours;
      attendance.holidayHours = holidayHours;
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

    // --- Audit: log what changed (best-effort; no transaction on this path) ---
    const auditActor = await resolveActor(req);
    const newBreaks = (breaksTaken !== undefined) ? (breaksTaken ?? null) : prevBreaks;
    if (breaksTaken !== undefined && newBreaks !== prevBreaks) {
      await recordAttendanceAudit({
        attendance,
        actor: auditActor,
        type: "breaks_changed",
        summary: breaksChangeSummary(prevBreaks, newBreaks),
      });
    }
    if (Array.isArray(sessions)) {
      // Resolve job/site names once (small indexed lookups) so the diff can read
      // "New session created for Welder" instead of an ObjectId.
      const jobIds = [...new Set(attendance.sessions.map((s) => s.jobId).filter(Boolean).map(String))];
      const siteIds = [...new Set(attendance.sessions.map((s) => s.siteId).filter(Boolean).map(String))];
      const [jobDocs, siteDocs] = await Promise.all([
        jobIds.length ? Job.find({ _id: { $in: jobIds } }).select("name").lean() : [],
        siteIds.length ? Site.find({ _id: { $in: siteIds } }).select("siteName").lean() : [],
      ]);
      const jobNames = Object.fromEntries(jobDocs.map((j) => [String(j._id), j.name]));
      const siteNames = Object.fromEntries(siteDocs.map((s) => [String(s._id), s.siteName]));

      const parts = summarizeAttendanceEdit({
        prevSessions: prevSessionsSnap,
        newSessions: attendance.sessions,
        prevStatus,
        newStatus: attendance.status,
        prevSick,
        newSick: attendance.isSickLeave,
        jobNames,
        siteNames,
      });

      const breaksChanged = breaksTaken !== undefined && newBreaks !== prevBreaks;
      // Log a detailed entry when something changed; skip a redundant generic entry when the
      // only change was breaks (already logged above).
      if (parts.length > 0) {
        await recordAttendanceAudit({ attendance, actor: auditActor, type: "edited", summary: joinChangeParts(parts) });
      } else if (!breaksChanged) {
        await recordAttendanceAudit({ attendance, actor: auditActor, type: "edited", summary: "Attendance edited" });
      }
    } else if (isSickLeave !== undefined) {
      await recordAttendanceAudit({
        attendance,
        actor: auditActor,
        type: "edited",
        summary: isSickLeave ? "Marked sick leave" : "Cleared sick leave",
      });
    }

    // Keep the roster job in step with the latest session's job — only when sessions
    // were edited for a specific site, and only if this is the employee's latest record
    // (the helper's guard makes a past-record edit a no-op).
    if (Array.isArray(sessions) && siteId) {
      await syncCurrentJobFromLatestSession({
        empId: attendance.employee,
        siteId,
        recordDate: attendance.date,
        doc: attendance,
      });
    }

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
        .populate("jobId", "name jobCode")
        .populate(
          "sessions.siteId",
          "siteName"
        )
        .populate(
          "sessions.jobId",
          "name jobCode"
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

      jobCode:
        updatedAttendance.jobId
          ?.jobCode || null,

      date: updatedAttendance.date,

      status:
        updatedAttendance.status,

      isHoliday:
        updatedAttendance.isHoliday,

      holidayReason:
        updatedAttendance.holidayReason || null,

      holidayHours:
        updatedAttendance.holidayHours || 0,

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

            jobCode:
              session.jobId?.jobCode ||
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

    // Timesheets are read-only and viewable by ANY supervisor, not just the one
    // whose assigned site the employee currently belongs to. This mirrors the
    // unscoped employee list (GET /api/employees) and single-employee read
    // (GET /api/employees/:id), which are not site-scoped for supervisors either.
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
          "name jobCode"
        )

        .populate(
          "sessions.siteId",
          "siteName"
        )

        .populate(
          "sessions.jobId",
          "name jobCode"
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

        jobCode:
          record.jobId?.jobCode ||
          null,

        date: record.date,

        status:
          record.status,

        isHoliday:
          record.isHoliday,

        holidayReason:
          record.holidayReason || null,

        holidayHours:
          record.holidayHours || 0,

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

              jobCode:
                session.jobId
                  ?.jobCode ||
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
      const sameSite = !!(
        record &&
        user &&
        user.assignedSite &&
        siteId &&
        user.assignedSite.toString() === siteId.toString() &&
        record.sessions.some((s) => s.siteId.toString() === siteId.toString())
      );
      // Employee-scoped carryover: also allow LOADING another site's record to
      // close a dangling open shift for an employee now on this supervisor's
      // roster (see utils/carryoverAccess.js). Mirrors the updateAttendance gate.
      const carryoverOk = !sameSite && record && user && user.assignedSite
        ? await supervisorMayCloseCarryover(record, user.assignedSite, siteId)
        : false;
      if (!sameSite && !carryoverOk) {
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

          holidayReason: "$holidayReason",

          holidayHours: "$holidayHours",

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

    // Recompute totals so holidayHours/overtime stay consistent with the
    // record's stored holiday state.
    const workConfig = await workModel.findOne({ type: "default" })
    if (workConfig) {
      const rawHours = attendance.sessions.reduce(
        (sum, s) => sum + (s.workedHours || 0),
        0
      )

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        attendance.breaksTaken ?? null,
        { isHoliday: attendance.isHoliday, reason: attendance.holidayReason }
      )

      attendance.totalWorkHours = netWorkHours
      attendance.status = status
      attendance.overtimeHours = overtimeHours
      attendance.holidayHours = holidayHours
    }

    await attendance.save()

    // --- Audit: a session was added (best-effort; no transaction on this path) ---
    let addedLabel = ""
    try {
      if (session.jobId) {
        const j = await Job.findById(session.jobId).select("name").lean()
        if (j?.name) addedLabel = ` for ${j.name}`
      }
    } catch { /* label is best-effort */ }
    await recordAttendanceAudit({
      attendance,
      actor: await resolveActor(req),
      type: "session_added",
      summary: `New session created${addedLabel}`,
    })

    // Keep the roster job in step with the latest session's job (this site, latest
    // record only). `session` here is the request-body session, not a mongoose session.
    await syncCurrentJobFromLatestSession({
      empId: attendance.employee,
      siteId: session.siteId,
      recordDate: attendance.date,
      doc: attendance,
    })

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
  const { employeeId, fromSiteId, toSiteId, jobId = null, date, onlyForToday = false } = req.body

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
    if (!isAssignableSite(toSite)) {
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

    // Supervisor-initiated midday transfer → a request the DESTINATION site's
    // supervisors must accept before the employee lands there (verification that the
    // move goes to the right site). Admins/superadmins bypass and transfer immediately.
    if (req.user.role === "supervisor") {
      const mode = onlyForToday ? "today" : "permanent"
      const destSupervisors = await findSiteSupervisors(toSiteId)

      let created
      try {
        created = await TransferRequest.create(
          [
            {
              employee: employee._id,
              fromSite: fromSiteId,
              fromJob: employee.currentJob || null,
              toSite: toSiteId,
              toJob: jobId || null,
              mode,
              direction: "push",
              carriedCheckIn,
              requestedBy: req.user.id,
              approver: destSupervisors[0]?._id ?? null,
              status: "pending",
              dateLocal: getTodayLocal(),
            },
          ],
          { session: dbSession }
        )
      } catch (err) {
        if (err.code === 11000) {
          throwValidationError(409, "A transfer for this employee is already pending")
        }
        throw err
      }
      const request = created[0]

      await dbSession.commitTransaction()
      dbSession.endSession()

      // Notify the destination site's decider(s) (best-effort, after commit).
      try {
        const requester = await userModel.findById(req.user.id).select("name")
        const payload = {
          type: "request_received",
          title: "New transfer request",
          body: `${requester?.name || "A supervisor"} wants to transfer ${employee.name} to your site${mode === "permanent" ? " (permanent)" : " for today"}.`,
          url: "/requests",
          relatedRequest: request._id,
        }
        if (destSupervisors.length) await Promise.all(destSupervisors.map((s) => notifyUser(s._id, payload)))
        else await notifyAdmins(payload)
      } catch (e) {
        console.error("[transfer] request notify failed:", e.message)
      }

      // --- Site activity: a midday transfer request was sent (best-effort; both feeds) ---
      try {
        const reqActor = await resolveActor(req)
        const fromSiteDoc = await Site.findById(fromSiteId).select("siteName")
        await recordSiteActivity({
          type: "request_sent",
          actor: reqActor,
          employee: employee._id,
          employeeName: employee.name,
          fromSiteId,
          toSiteId,
          summary: `${reqActor.actorName} requested a midday transfer of ${employee.name} from ${fromSiteDoc?.siteName || "their site"} to ${toSite?.siteName || "the site"} (${mode === "permanent" ? "permanent" : "for today"})`,
        })
      } catch (e) {
        console.error("[transfer] request activity log failed:", e.message)
      }

      return res.status(201).json({
        success: true,
        requested: true,
        pending: true,
        message: `Transfer request sent to ${toSite?.siteName || "the site"} — awaiting their approval`,
        data: request,
      })
    }

    // Admin/superadmin: apply the transfer immediately (shared placement helper).
    const { pending: isPending } = await placeMiddayArrival({
      employee,
      fromSiteId,
      toSiteId,
      jobId: jobId || null,
      carriedCheckIn,
      attendanceDate,
      onlyForToday,
      markedById: req.user.id,
      actor: await resolveActor(req),
      session: dbSession,
      attendanceDoc,
    })

    await dbSession.commitTransaction()
    dbSession.endSession()

    // Notify the destination site's supervisor(s) that an employee arrived via a
    // midday transfer they did not request (the "unknowingly" case). Best-effort,
    // after commit; skip the acting user if they supervise the site (already know).
    try {
      await notifySiteSupervisors(
        toSiteId,
        {
          type: "transfer_arrived",
          title: "Employee transferred in",
          body: `${employee.name} was transferred to your site today.`,
          url: `/attendance/${toSiteId}`,
        },
        { exceptUserId: req.user.id }
      )
    } catch (e) {
      console.error("[transfer] arrival notify failed:", e.message)
    }

    // --- Site activity: direct midday/permanent transfer (best-effort; both sites' feeds) ---
    try {
      const transferActor = await resolveActor(req)
      const fromSiteDoc = await Site.findById(fromSiteId).select("siteName")
      await recordSiteActivity({
        type: onlyForToday ? "transfer_today" : "transfer_permanent",
        actor: transferActor,
        employee: employee._id,
        employeeName: employee.name,
        fromSiteId,
        toSiteId,
        summary: `${transferActor.actorName} transferred ${employee.name} from ${fromSiteDoc?.siteName || "their site"} to ${toSite?.siteName || "the site"} (${onlyForToday ? "for today" : "permanent"})`,
      })
    } catch (e) {
      console.error("[transfer] activity log failed:", e.message)
    }

    await employee.populate("currentJob", "name")
    await employee.populate("currentSite", "siteName")

    const relocated = !onlyForToday
    return res.status(200).json({
      success: true,
      message: onlyForToday
        ? (!isPending
            ? "Session added at target site for today; home site unchanged"
            : "Session for today will apply when the target site's attendance is next opened or submitted; home site unchanged")
        : (!isPending
            ? "Employee transferred; new session added at target site"
            : "Employee transferred; check-in will apply when the target site's attendance is next opened or submitted"),
      pending: isPending,
      relocated,
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
    let { date, name, employeeId, jobTitle, site, page = 1, limit = 10 } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required' });
    }

    page = Math.max(Number(page) || 1, 1);
    limit = Math.min(Number(limit) || 10, 100);
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

    // Narrow by currentSite (list convenience). Supervisors are already scoped to their
    // assignedSite above, so only apply the client-supplied filter for admins/superadmins.
    if (site && site !== 'all' && req.user.role !== 'supervisor') {
      employeeFilter.currentSite = new mongoose.Types.ObjectId(site);
    }

    const totalEmployees = await Employee.countDocuments(employeeFilter);
    const totalPages = Math.ceil(totalEmployees / limit);

    const employees = await Employee.find(
      employeeFilter,
      '_id name employeeId jobTitle currentSite currentJob employmentType'
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

    const { fullDayHours, halfDayHours, overtimeThreshold } = workConfig;

    // Validate and build sessions
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ success: false, message: 'sessions must be an array' });
    }

    // Backfill records what actually happened on an explicit past day: times are combined
    // literally with that day, and a check-out earlier than its check-in bumps to the next
    // calendar day (the standard offset rule). Correctness is enforced by the direct
    // timestamp-overlap check against the neighbouring days' records below.
    const builtSessions = [];

    for (const session of sessions) {
      const { siteId: sessionSiteId, jobId, checkIn, checkOut } = session;

      if (!sessionSiteId) {
        return res.status(400).json({ success: false, message: 'Every session must have a site selected' });
      }

      if (!checkIn && checkOut) {
        return res.status(400).json({ success: false, message: 'Check-out cannot exist without check-in' });
      }

      const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkIn, checkOut, !!session.startsAfterMidnight);
      const sessionIsNight = checkInNextDay || checkOutNextDay;

      let workedHours = 0;
      const checkInDate = checkIn ? combineFromOffset(date, checkIn, checkInNextDay) : null;
      const checkOutDate = checkOut ? combineFromOffset(date, checkOut, checkOutNextDay) : null;

      if (checkInDate && checkOutDate) {
        workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
        if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
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

    // Keeps a backfilled day from claiming real hours the SAME employee's neighbouring
    // days' records already cover — that would silently pay the same hours twice.
    {
      const crossDayConflict = await buildCrossDayOverlapChecker({
        employeeIds: [employeeMongoId],
        date: attendanceDate,
      });
      const neighbourConflict = crossDayConflict(employeeMongoId, validSessions);
      if (neighbourConflict) {
        return res.status(400).json({
          success: false,
          message: crossDayOverlapMessage(neighbourConflict),
        });
      }
    }

    // Totals
    const rawHours = Number(builtSessions.reduce((sum, s) => sum + (s.workedHours || 0), 0).toFixed(2));

    const holidayInfo = await checkHolidayForDate(attendanceDate);
    // Temporary workers are exempt from holiday treatment — for them a holiday is a
    // normal working day (normal hours + OT, no holiday-hours credit).
    const effHolidayInfo = holidayInfoForEmployee(holidayInfo, employee.employmentType);

    const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
      rawHours,
      workConfig,
      breaksTaken,
      effHolidayInfo
    );

    const hasCrossedMidnight = detectCrossedMidnight(builtSessions, timezoneOffset);

    // Default siteId = first session's site (if any), else employee's current site
    const primarySiteId = builtSessions.length > 0 ? builtSessions[0].siteId : (employee.currentSite || null);

    if (!primarySiteId) {
      return res.status(400).json({ success: false, message: 'Could not determine a site for this record. Add at least one session with a site.' });
    }

    const newAttendance = new Attendance({
      employee: employeeMongoId,
      date: attendanceDate,
      siteId: primarySiteId,
      jobId: builtSessions.length > 0 ? (builtSessions[0].jobId || null) : null,
      markedBy,
      isHoliday: effHolidayInfo.isHoliday,
      holidayReason: effHolidayInfo.reason,
      holidayHours,
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

    // --- Audit: a past-day record was created after the fact (best-effort) ---
    await recordAttendanceAudit({
      attendance: newAttendance,
      actor: await resolveActor(req),
      type: "backfilled",
      summary: "Record backfilled",
    });

    // Backfilling a PAST day is a no-op here (a later record exists → the guard skips
    // it); only if this is the employee's latest record at their current site does the
    // roster job sync to the latest session.
    await syncCurrentJobFromLatestSession({
      empId: employeeMongoId,
      siteId: primarySiteId,
      recordDate: attendanceDate,
      doc: newAttendance,
    });

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
      holidayReason: record.holidayReason || null,
      holidayHours: record.holidayHours || 0,
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

// POST /api/attendance/backfill/bulk
// Backfill ONE common session for MANY employees at once. Body:
//   { date, employeeIds: [], siteId, jobId?, checkIn, checkOut,
//     checkInNextDay?, checkOutNextDay?, breaksTaken? }
// The site, job and times are shared; the day offsets are EXPLICIT (so a true 24h shift
// like 08:00→08:00 works — the auto-derive in the single endpoint can't infer that). Each
// employee gets an independent, non-transactional save so partial success is preserved:
// employees who already have a record, or whose times collide with a neighbouring day's
// record, are reported back rather than aborting the whole batch.
export const bulkBackfillAttendance = async (req, res) => {
  try {
    const {
      date,
      employeeIds = [],
      siteId,
      jobId = null,
      checkIn,
      checkOut,
      checkInNextDay = false,
      checkOutNextDay = false,
      breaksTaken = null,
    } = req.body;

    const markedBy = req.user?.id;
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];

    if (!date || !siteId) {
      return res.status(400).json({ success: false, message: 'date and siteId are required' });
    }
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: 'employeeIds must be a non-empty array' });
    }
    if (!checkIn || !checkOut) {
      return res.status(400).json({ success: false, message: 'Both checkIn and checkOut are required' });
    }

    const site = await Site.findById(siteId).select('siteName').lean();
    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    const workConfig = await workModel.findOne({ type: 'default' });
    if (!workConfig) {
      return res.status(404).json({ success: false, message: 'Work schedule configuration not found' });
    }

    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Build the common session once — explicit day offsets win.
    const checkInDate = combineFromOffset(date, checkIn, !!checkInNextDay);
    const checkOutDate = combineFromOffset(date, checkOut, !!checkOutNextDay);
    if (!checkInDate || !checkOutDate) {
      return res.status(400).json({ success: false, message: 'Invalid check-in/check-out time' });
    }
    const workedHours = (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60);
    if (workedHours <= 0 || workedHours > MAX_SHIFT_HOURS) {
      return res.status(400).json({
        success: false,
        message: `Invalid shift duration — check the times or the next-day markers (max ${MAX_SHIFT_HOURS}h).`,
      });
    }
    const isNightShift = !!checkInNextDay || !!checkOutNextDay;
    const rawHours = Number(workedHours.toFixed(2));

    // Holiday is date-based → resolve once; only the per-employee employmentType varies.
    const holidayInfo = await checkHolidayForDate(attendanceDate);
    const hasCrossedMidnight = detectCrossedMidnight(
      [{ checkIn: checkInDate, checkOut: checkOutDate, isNightShift }],
      timezoneOffset
    );

    const uniqueIds = [...new Set(employeeIds.filter(Boolean).map(String))];

    const created = [];
    const skipped = [];
    const failed = [];

    // Load the employees and the records they already have for this date, both in one query.
    const employees = await Employee.find({ _id: { $in: uniqueIds }, isActive: true })
      .select('_id name employeeId employmentType currentSite')
      .lean();
    const employeeById = new Map(employees.map((e) => [String(e._id), e]));

    const existing = await Attendance.find({
      employee: { $in: uniqueIds },
      date: attendanceDate,
    }).select('employee').lean();
    const alreadyRecorded = new Set(existing.map((r) => String(r.employee)));

    // Candidates that survive the cheap skips → run the cross-day overlap check on these.
    const candidates = [];
    for (const id of uniqueIds) {
      const emp = employeeById.get(id);
      if (!emp) {
        skipped.push({ employeeId: id, name: null, reason: 'Employee not found or inactive' });
        continue;
      }
      if (alreadyRecorded.has(id)) {
        skipped.push({ employeeId: id, name: emp.name, reason: 'Already has a record for this date' });
        continue;
      }
      candidates.push(emp);
    }

    const candidateSession = [{ checkIn: checkInDate, checkOut: checkOutDate }];
    const crossDayConflict = await buildCrossDayOverlapChecker({
      employeeIds: candidates.map((e) => String(e._id)),
      date: attendanceDate,
    });

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

    for (const emp of candidates) {
      const empId = String(emp._id);
      try {
        const conflict = crossDayConflict(empId, candidateSession);
        if (conflict) {
          failed.push({ employeeId: empId, name: emp.name, message: crossDayOverlapMessage(conflict) });
          continue;
        }

        // Temporary workers get no holiday treatment (normal day + OT, no holiday credit).
        const effHolidayInfo = holidayInfoForEmployee(holidayInfo, emp.employmentType);
        const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
          rawHours,
          workConfig,
          breaksTaken,
          effHolidayInfo
        );

        const newAttendance = new Attendance({
          employee: empId,
          date: attendanceDate,
          siteId,
          jobId: jobId || null,
          markedBy,
          isHoliday: effHolidayInfo.isHoliday,
          holidayReason: effHolidayInfo.reason,
          holidayHours,
          isSickLeave: false,
          status,
          totalWorkHours: netWorkHours,
          overtimeHours,
          breaksTaken: breaksTaken !== undefined ? breaksTaken : null,
          shiftType: hasCrossedMidnight ? 'night' : 'day',
          crossedMidnight: hasCrossedMidnight,
          sessions: [{
            siteId,
            jobId: jobId || null,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            workedHours: rawHours,
            markedBy,
            isNightShift,
          }],
        });

        await newAttendance.save();

        // Same roster sync as single backfill — a no-op unless this is the employee's
        // latest record AND the common site happens to be their current site.
        await syncCurrentJobFromLatestSession({
          empId,
          siteId,
          recordDate: attendanceDate,
          doc: newAttendance,
        });

        created.push({ employeeId: empId, name: emp.name, attendanceId: newAttendance._id });
        auditRows.push(buildAuditRow(newAttendance, auditActor, "backfilled", "Record backfilled (bulk)"));
      } catch (err) {
        console.error('bulkBackfillAttendance per-employee error:', empId, err);
        failed.push({
          employeeId: empId,
          name: emp.name,
          message: err?.message || 'Failed to create record',
        });
      }
    }

    await recordAttendanceAuditBatch(auditRows);

    return res.status(200).json({
      success: true,
      message: `Backfilled ${created.length} of ${uniqueIds.length} employee(s)`,
      summary: {
        createdCount: created.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
      },
      created,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('bulkBackfillAttendance error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk backfill attendance', error: error.message });
  }
};


/**
 * Bulk close open (checked-in, never-checked-out) sessions with ONE check-out time.
 *
 * Recovery tool for the Edit-Past-Attendance page: when the auto-checkout cron did not run
 * (server down) or a site has no default check-out for a category, sessions are left open.
 * This applies a single "HH:mm" check-out to EACH selected record's LATEST open session only,
 * on that record's own business day. Non-transactional and per-record — one bad record never
 * aborts the batch (mirrors bulkBackfillAttendance) — and the per-record close mirrors the
 * auto-checkout cron (deriveOffsets → combineFromOffset → 26h bound → overlap → recompute).
 *
 * Body: { attendanceIds: string[], checkOut: "HH:mm", checkOutNextDay?: boolean }
 *  - checkOutNextDay omitted → auto-roll to the next day when the time reads before the
 *    check-in (same rule the cron uses); passed explicitly → it wins (standalone AM tail).
 */
export const bulkCheckout = async (req, res) => {
  try {
    const { attendanceIds = [], checkOut, checkOutNextDay } = req.body;

    if (!Array.isArray(attendanceIds) || attendanceIds.length === 0) {
      return res.status(400).json({ success: false, message: 'attendanceIds must be a non-empty array' });
    }
    if (!checkOut || !/^\d{2}:\d{2}$/.test(checkOut)) {
      return res.status(400).json({ success: false, message: 'A valid check-out time (HH:mm) is required' });
    }

    // Offset resolution — mirrors updateAttendance so toLocalTimeString reads the same
    // wall-clock as the rest of the controller.
    const timezoneOffset = (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "")
      ? process.env.APP_TIMEZONE_OFFSET
      : req.headers['x-timezone-offset'];
    let offsetVal = -330;
    if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
      const parsed = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
      if (!isNaN(parsed)) offsetVal = parsed;
    } else if (timezoneOffset !== null && timezoneOffset !== undefined) {
      const parsed = parseInt(timezoneOffset, 10);
      if (!isNaN(parsed)) offsetVal = parsed;
    }

    const explicitNextDay = typeof checkOutNextDay === 'boolean' ? checkOutNextDay : null;

    const workConfig = await workModel.findOne({ type: 'default' });
    if (!workConfig) {
      return res.status(404).json({ success: false, message: 'Work schedule configuration not found' });
    }

    const uniqueIds = [...new Set(attendanceIds.filter(Boolean).map(String))];

    const records = await Attendance.find({ _id: { $in: uniqueIds } })
      .populate('employee', 'name employeeId');
    const recordById = new Map(records.map((r) => [String(r._id), r]));

    const closed = [];
    const skipped = [];
    const failed = [];

    // Cross-day overlap: one checker per distinct business day, built up front over every
    // employee on that day (a closed session may roll into the next day's record).
    const byDate = new Map(); // dateStr -> { empIds:Set, checker }
    for (const rec of records) {
      const dateStr = new Date(rec.date).toISOString().split('T')[0];
      if (!byDate.has(dateStr)) byDate.set(dateStr, { empIds: new Set(), checker: null });
      byDate.get(dateStr).empIds.add(String(rec.employee?._id || rec.employee));
    }
    await Promise.all(
      [...byDate.entries()].map(async ([dateStr, group]) => {
        const anchor = new Date(dateStr);
        anchor.setUTCHours(0, 0, 0, 0);
        group.checker = await buildCrossDayOverlapChecker({
          employeeIds: [...group.empIds],
          date: anchor,
        });
      })
    );

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

    for (const id of uniqueIds) {
      const record = recordById.get(id);
      if (!record) {
        skipped.push({ attendanceId: id, employeeId: null, name: null, reason: 'Record not found' });
        continue;
      }

      const empId = String(record.employee?._id || record.employee);
      const name = record.employee?.name || null;

      try {
        // Latest open session = checked in, no check-out, max check-in.
        const openSessions = record.sessions.filter((s) => s.checkIn && !s.checkOut);
        if (openSessions.length === 0) {
          skipped.push({ attendanceId: id, employeeId: empId, name, reason: 'No open session to close' });
          continue;
        }
        const session = openSessions.reduce((latest, s) =>
          new Date(s.checkIn).getTime() > new Date(latest.checkIn).getTime() ? s : latest
        );

        const recordDateStr = new Date(record.date).toISOString().split('T')[0];
        const inStr = toLocalTimeString(session.checkIn, offsetVal);

        const outNextDay = explicitNextDay !== null
          ? explicitNextDay
          : deriveOffsets(inStr, checkOut, !!session.checkInNextDay).checkOutNextDay;

        const checkOutDate = combineFromOffset(recordDateStr, checkOut, outNextDay);
        if (!checkOutDate) {
          failed.push({ attendanceId: id, employeeId: empId, name, message: 'Invalid check-out time' });
          continue;
        }

        const workedHours =
          (checkOutDate.getTime() - new Date(session.checkIn).getTime()) / (1000 * 60 * 60);
        if (!(workedHours > 0 && workedHours <= MAX_SHIFT_HOURS)) {
          skipped.push({
            attendanceId: id,
            employeeId: empId,
            name,
            reason:
              workedHours <= 0
                ? 'Check-out is before the check-in — close this one manually'
                : `Check-out would make a ${workedHours.toFixed(1)}h shift (max ${MAX_SHIFT_HOURS}h) — close this one manually`,
          });
          continue;
        }

        // In-record overlap (the closed session vs the record's other sessions).
        const candidate = record.sessions.map((s) =>
          s._id.toString() === session._id.toString()
            ? { checkIn: s.checkIn, checkOut: checkOutDate }
            : { checkIn: s.checkIn, checkOut: s.checkOut }
        );
        if (hasSessionOverlap(candidate)) {
          failed.push({ attendanceId: id, employeeId: empId, name, message: 'Check-out overlaps another session on this day' });
          continue;
        }

        // Cross-day overlap (the closed session vs the neighbouring days' records).
        const checker = byDate.get(recordDateStr)?.checker;
        const conflict = checker
          ? checker(empId, [{ checkIn: session.checkIn, checkOut: checkOutDate }])
          : null;
        if (conflict) {
          failed.push({ attendanceId: id, employeeId: empId, name, message: crossDayOverlapMessage(conflict) });
          continue;
        }

        // Close it — mirror the auto-checkout cron's mutation + totals recompute. The model
        // pre-save hook re-derives rawCheckOut/offsets from the new checkOut Date.
        session.checkOut = checkOutDate;
        session.workedHours = Number(workedHours.toFixed(2));
        if (outNextDay) session.isNightShift = true;

        const rawHours = record.sessions.reduce((sum, s) => sum + (s.workedHours || 0), 0);
        const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
          rawHours,
          workConfig,
          record.breaksTaken ?? null,
          { isHoliday: record.isHoliday, reason: record.holidayReason }
        );
        record.totalWorkHours = netWorkHours;
        record.status = status;
        record.overtimeHours = overtimeHours;
        record.holidayHours = holidayHours;

        await record.save();

        closed.push({ attendanceId: id, employeeId: empId, name });
        auditRows.push(buildAuditRow(record, auditActor, "bulk_checkout", `Checked out (bulk) at ${checkOut}`));
      } catch (err) {
        console.error('bulkCheckout per-record error:', id, err);
        failed.push({ attendanceId: id, employeeId: empId, name, message: err?.message || 'Failed to close session' });
      }
    }

    await recordAttendanceAuditBatch(auditRows);

    return res.status(200).json({
      success: true,
      message: `Checked out ${closed.length} of ${uniqueIds.length} record(s)`,
      summary: {
        closedCount: closed.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
      },
      closed,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('bulkCheckout error:', error);
    return res.status(500).json({ success: false, message: 'Failed to bulk check out', error: error.message });
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
      "_id name employeeId jobTitle currentSite currentJob collarType nationality"
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

    // The night check-in is pre-filled at assignment time from the site's night
    // default (staff use their own staff-night default), replacing the old
    // auto-check-in cron.
    const siteDoc = await Site.findById(siteId)
      .select("nightDefaultCheckIn staffNightDefaultCheckIn")
      .session(dbSession);

    let processedCount = 0;

    // Resolve the actor once for the whole batch; collect audit rows for one insertMany.
    const auditActor = await resolveActor(req);
    const auditRows = [];

    for (const empId of employeeIds) {
      const emp = await Employee.findById(empId)
        .select("currentSite currentJob collarType")
        .session(dbSession);

      // Collar-aware, NO fallback: staff use only the staff night default.
      const isStaff = emp?.collarType === "staff";
      const nightDefaultIn = isStaff
        ? (siteDoc?.staffNightDefaultCheckIn || "")
        : (siteDoc?.nightDefaultCheckIn || "");

      // Date object for the pre-filled check-in, or null if no default configured.
      // Cutoff-free: a night check-in default is an evening time, so it belongs to the
      // record's own business day (offset 0). No cutoff resolution.
      const prefillCheckIn = nightDefaultIn
        ? combineFromOffset(date, nightDefaultIn, false)
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

      const { netWorkHours, status, overtimeHours, holidayHours } = computeAttendanceTotals(
        rawHours,
        workConfig,
        attendanceDoc.breaksTaken ?? null,
        { isHoliday: attendanceDoc.isHoliday, reason: attendanceDoc.holidayReason }
      );

      attendanceDoc.totalWorkHours = netWorkHours;
      attendanceDoc.status = status;
      attendanceDoc.overtimeHours = overtimeHours;
      attendanceDoc.holidayHours = holidayHours;


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

      // The night default check-in is auto-filled by the server on assignment (prefillCheckIn),
      // so — unlike the day submit — we know for certain it was auto-initialized. rawCheckIn is
      // populated by the pre-save hook above; it's null only when the overlap safety cleared it.
      const assignedNight = attendanceDoc.sessions.find(
        (s) => s.siteId.toString() === siteId.toString() && s.isNightShift
      );
      const nightSummary = assignedNight?.rawCheckIn
        ? `Night shift assigned with an auto-initialized check-in of ${assignedNight.rawCheckIn}`
        : "Night shift assigned";
      auditRows.push(buildAuditRow(attendanceDoc, auditActor, "night_shift_assigned", nightSummary));
    }

    // Audit log joins the same transaction (best-effort inside the helper).
    await recordAttendanceAuditBatch(auditRows, dbSession);

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


// --- CROSS-SITE VISIBILITY (read-only) ---
// Return an employee's attendance sessions for a single business day across ALL sites.
// Used by the instant Add-Employee modal so a supervisor can SEE that the employee is
// already recorded at another site today — a legitimate multi-site day, or a mistake to
// fix out-of-band. Read-only: no writes, no locks, no overlap enforcement (the submit
// path keeps its own guards). Intentionally NOT behind requireSiteAccess — the whole
// point is to reveal OTHER sites' sessions; it exposes only site name + times.
const getEmployeeDaySessions = async (req, res) => {
  try {
    const { employeeId, excludeSiteId, date } = req.query

    if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        message: "A valid employeeId is required",
      })
    }

    // Default to today's local business day; match the stored UTC-midnight date the
    // same way getSiteAttendance does.
    const dayStr = date || getDateLocal(0)
    const queryDate = new Date(dayStr)
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

    const record = await Attendance.findOne({
      employee: employeeId,
      date: { $gte: start, $lte: end },
    })
      .select("sessions.siteId sessions.checkIn sessions.checkOut sessions.rawCheckIn sessions.rawCheckOut")
      .populate({ path: "sessions.siteId", select: "siteName" })

    const excludeId =
      excludeSiteId && mongoose.Types.ObjectId.isValid(excludeSiteId)
        ? excludeSiteId.toString()
        : null

    const sessions = (record?.sessions || [])
      // Only real presences (must have a check-in) and, when asked, other sites only.
      .filter((s) => {
        if (!s.siteId || !s.checkIn) return false
        const sid = (s.siteId._id || s.siteId).toString()
        return excludeId ? sid !== excludeId : true
      })
      .map((s) => ({
        siteId: (s.siteId._id || s.siteId).toString(),
        siteName: s.siteId?.siteName || "Unknown site",
        checkIn: s.checkIn || null,
        checkOut: s.checkOut || null,
        rawCheckIn: s.rawCheckIn || null,
        rawCheckOut: s.rawCheckOut || null,
        isOpen: !s.checkOut,
      }))
      .sort(
        (a, b) => new Date(a.checkIn || 0).getTime() - new Date(b.checkIn || 0).getTime()
      )

    return res.status(200).json({
      success: true,
      message: "Employee day sessions fetched",
      data: { sessions },
    })
  } catch (error) {
    console.error("getEmployeeDaySessions error:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch employee day sessions",
    })
  }
}


// --- ATTENDANCE RECORD EDIT-LOG (read) + SUPERVISOR REMARK (write) ---

// Shared authorization for the per-record history/remark endpoints: admins/superadmins
// reach any record; a supervisor reaches only records at their assignedSite (the record's
// primary site OR any session's site — a multi-site record can carry their site's session).
// Mirrors the supervisor same-site check in updateAttendance. requireSiteAccess can't gate
// these routes because the param is an attendance id, not a site id.
const authorizeRecordAccess = async (attendanceId, reqUser) => {
  const record = await Attendance.findById(attendanceId);
  if (!record) return { ok: false, status: 404, message: "Attendance record not found" };
  if (reqUser.role === "supervisor") {
    const user = await userModel.findById(reqUser.id).select("assignedSite");
    const assigned = user?.assignedSite?.toString();
    const sitesOnRecord = new Set(
      [record.siteId?.toString(), ...record.sessions.map((s) => s.siteId?.toString())].filter(Boolean)
    );
    if (!assigned || !sitesOnRecord.has(assigned)) {
      return { ok: false, status: 403, message: "Forbidden: Access denied to this attendance record" };
    }
  }
  return { ok: true, record };
};

// GET /api/attendance/:attendanceId/history — the on-demand popover fetch. Returns the
// current remark + the reverse-chronological edit log in one payload.
export const getAttendanceHistory = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const auth = await authorizeRecordAccess(attendanceId, req.user);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

    const entries = await attendanceAuditModel
      .find({ attendance: attendanceId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("actorName type summary createdAt")
      .lean();

    return res.status(200).json({
      success: true,
      data: { remark: auth.record.remark || "", entries },
    });
  } catch (error) {
    console.error("getAttendanceHistory error:", error);
    return res.status(500).json({ success: false, message: "Failed to load attendance history" });
  }
};

// PATCH /api/attendance/:attendanceId/remark — set/overwrite the single supervisor remark.
// Uses updateOne so the model pre-save hook (session offset re-derivation) is not re-run
// for a note-only change; the change is captured in the audit log so remark history survives.
export const updateAttendanceRemark = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { remark = "" } = req.body;

    if (typeof remark !== "string" || remark.length > 500) {
      return res.status(400).json({ success: false, message: "Remark must be text up to 500 characters" });
    }

    const auth = await authorizeRecordAccess(attendanceId, req.user);
    if (!auth.ok) return res.status(auth.status).json({ success: false, message: auth.message });

    const trimmed = remark.trim();
    await Attendance.updateOne({ _id: attendanceId }, { $set: { remark: trimmed } });
    auth.record.remark = trimmed;

    await recordAttendanceAudit({
      attendance: auth.record,
      actor: await resolveActor(req),
      type: "remark_updated",
      summary: trimmed ? `Remark updated: "${trimmed}"` : "Remark cleared",
    });

    return res.status(200).json({ success: true, data: { remark: trimmed } });
  } catch (error) {
    console.error("updateAttendanceRemark error:", error);
    return res.status(500).json({ success: false, message: "Failed to update remark" });
  }
};


// --- DEFAULT EXPORT ---

const attendanceController = {
  monthlyReport,
  jobReport,
  getSummary,
  unlockAttendance,
  updateAttendance,
  toggleHolidayStatus,

  getSiteAttendance,
  getSiteCarryovers,
  bulkEditAttendance,
  getAttendanceRecords,
  getEmployeeAttendanceByMonth,
  siteFirstSubmitAttendance,
  getAttendanceById,
  addSessionToAttendance,
  transferEmployee,
  getMissingEmployees,
  backfillAttendance,
  bulkBackfillAttendance,
  bulkCheckout,
  getActiveSitesOverview,

  getNightShiftCandidates,
  assignNightShift,

  getEmployeeDaySessions,

  getAttendanceHistory,
  updateAttendanceRemark,

};

export default attendanceController;
