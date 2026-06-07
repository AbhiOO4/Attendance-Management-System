import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import Employee from '../models/empModel.js';
import empModel from '../models/empModel.js';
import mongoose from 'mongoose';
import workModel from '../models/workModel.js';
import Site from '../models/siteModel.js';
import siteModel from '../models/siteModel.js';

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
  if (timezoneOffset !== null && timezoneOffset !== undefined) {
    const offsetVal = parseInt(timezoneOffset, 10);
    if (!isNaN(offsetVal)) {
      const sign = offsetVal <= 0 ? "+" : "-";
      const absMinutes = Math.abs(offsetVal);
      const hours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
      const mins = String(absMinutes % 60).padStart(2, "0");
      offsetStr = `${sign}${hours}:${mins}`;
    }
  } else {
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

/**
 * Determines if any session in the array is a night shift.
 * Checks both the isNightShift flag and auto-detects cross-midnight.
 */
function detectCrossedMidnight(sessions, timezoneOffset = null) {
  // Parse timezone offset (default to -330 for IST (+05:30) if not specified or invalid)
  let offsetVal = -330;
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

    report.sort((a, b) =>
      a.employeeName.localeCompare(
        b.employeeName
      )
    );

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
      // Present count
      if (
        attendance.status === "fullday" ||
        attendance.status === "halfday"
      ) {
        presentToday++;
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
          });
        }

        const siteStats =
          siteMap.get(siteId);

        const workedHours =
          session.workedHours || 0;

        siteStats.manHoursToday +=
          workedHours;

        const employeeId =
          attendance.employee.toString();

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

      const employeesToday =
        Array.from(
          stats.employeeHours.values()
        ).filter(
          (hours) => hours > 0
        ).length;

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
  try {
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

    // Create day range
    const startOfDay = new Date(date)
    startOfDay.setHours(0, 0, 0, 0)

    const endOfDay = new Date(date)
    endOfDay.setHours(23, 59, 59, 999)

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
    )

    return res.status(200).json({
      message: isHoliday
        ? "Day marked as holiday successfully"
        : "Holiday removed successfully",

      modifiedCount: result.modifiedCount,
    })
  } catch (error) {
    console.log(error)

    return res.status(500).json({
      message: "Failed to update holiday status",
    })
  }
} 


// pst req to /api/attendance/submit
export const siteFirstSubmitAttendance = async (req, res) => {
  try {
    // console.log(req.body)
    const {
      siteId,
      date,
      isHoliday = false,
      attendance,
    } = req.body

    const markedBy = req.user?.id
    const timezoneOffset = req.headers['x-timezone-offset']

    // -----------------------------
    // VALIDATION
    // -----------------------------
    if (!siteId || !date || !Array.isArray(attendance) || attendance.length === 0) {
      return res.status(400).json({
        success: false,
        message: "siteId, date and attendance are required",
      })
    }

    const attendanceDate = new Date(date)
    attendanceDate.setUTCHours(0, 0, 0, 0)

    // LOCK CHECK (site-first guarantee)
    const existingLock = await AttendanceLock.findOne({
      siteId,
      date: attendanceDate,
      isLocked: true,
    })

    if (existingLock) {
      return res.status(400).json({
        success: false,
        message: "Attendance already submitted and locked for this site/date",
      })
    }

    const workConfig = await workModel.findOne()
    if (!workConfig) {
      return res.status(404).json({
        success: false,
        message: "Work configuration not found",
      })
    }

    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
    } = workConfig

    const processedRecords = []

    // -----------------------------
    // MAIN LOOP (EMPLOYEES)
    // -----------------------------
    for (const entry of attendance) {
      const {
        employee,
        employeeId,
        jobId,
        sessions,
      } = entry

      const empId = employee?._id 

      if (!empId) {
        return res.status(400).json({
          success: false,
          message: "employee is required",
        })
      }

      if (!Array.isArray(sessions)) {
        return res.status(400).json({
          success: false,
          message: "sessions must be an array",
        })
      }

      let attendanceDoc = await Attendance.findOne({
        employee: empId,
        date: attendanceDate,
      })

      if (!attendanceDoc) {
        attendanceDoc = new Attendance({
          employee: empId,
          date: attendanceDate,
          siteId,
          jobId: jobId || null,
          markedBy,
          isHoliday,
          status: "absent",
          sessions: [],
        })
      }

      // -----------------------------
      // BUILD SESSIONS
      // -----------------------------
      const updatedSessions = []

      for (const session of sessions) {
        const {
          siteId: sessionSiteId,
          job,
          checkIn,
          checkOut,
          isNightShift: sessionIsNight = false,
        } = session

        const finalSiteId = sessionSiteId || siteId
        const cutoffHour = workConfig.nightShiftCutoffHour || 7

        // Night shift time checks: AM times must be before cutoff
        if (sessionIsNight) {
          if (checkOut) {
            const [outH] = checkOut.split(":").map(Number);
            if (outH >= cutoffHour && outH < 12) {
              return res.status(400).json({
                success: false,
                message: `Check-out time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`,
              });
            }
          }
          if (checkIn) {
            const [inH] = checkIn.split(":").map(Number);
            if (inH >= cutoffHour && inH < 12) {
              return res.status(400).json({
                success: false,
                message: `Check-in time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`,
              });
            }
          }
        }

        // RULE: checkOut without checkIn NOT allowed
        if (!checkIn && checkOut) {
          return res.status(400).json({
            success: false,
            message: "checkOut cannot exist without checkIn",
          })
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
            return res.status(400).json({
              success: false,
              message: "Invalid checkIn/checkOut",
            })
          }

          workedHours =
            (outTime.getTime() - inTime.getTime()) /
            (1000 * 60 * 60)

          if (workedHours < 0 || workedHours > 24) {
            return res.status(400).json({
              success: false,
              message: "Invalid shift duration",
            })
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
        .map((s) => ({
          ...s,
          _start: new Date(s.checkIn),
          _end: s.checkOut
            ? new Date(s.checkOut)
            : new Date(s.checkIn),
        }))

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
          const site = await Site.findById(b.siteId)
            .select("siteName")

          if (!site) {
            return res.status(404).json({
              success: false,
              message: "Site not found",
            })
          }

          return res.status(400).json({
            success: false,
            message: "Attendance sessions overlap",

            overlap: {
              employeeId: empId,

              conflictingSession: {
                siteId: b.siteId,
                siteName: site.siteName || "Unknown Site",
                jobId: b.jobId,
                checkIn: b.checkIn,
                checkOut: b.checkOut,
              },
            },
          })
        }
      }

      // -----------------------------
      // ASSIGN MERGED SESSIONS
      // -----------------------------

      attendanceDoc.sessions = mergedSessions

      // -----------------------------
      // TOTAL HOURS
      // -----------------------------
      const totalWorkHours =
        mergedSessions.reduce(
          (sum, s) =>
            sum + (s.workedHours || 0),
          0
        )

      let status = "absent"

      if (totalWorkHours >= fullDayHours) {
        status = "fullday"
      } else if (totalWorkHours >= halfDayHours) {
        status = "halfday"
      }

      let overtimeHours = 0

      if (totalWorkHours > overtimeThreshold) {
        overtimeHours = totalWorkHours - overtimeThreshold
      }

      attendanceDoc.totalWorkHours = totalWorkHours
      attendanceDoc.status = status
      attendanceDoc.overtimeHours = overtimeHours
      attendanceDoc.isHoliday = isHoliday
      // Night shift detection
      const hasCrossedMidnight = detectCrossedMidnight(mergedSessions, timezoneOffset)
      attendanceDoc.crossedMidnight = hasCrossedMidnight
      attendanceDoc.shiftType = hasCrossedMidnight ? "night" : "day"
      attendanceDoc.siteId = siteId
      attendanceDoc.jobId = jobId || null
      attendanceDoc.markedBy = markedBy

      await attendanceDoc.save()

      processedRecords.push(attendanceDoc)
    }

    // -----------------------------
    // CREATE LOCK
    // -----------------------------
    await AttendanceLock.create({
      siteId,
      date: attendanceDate,
      isLocked: true,
      lockedBy: markedBy,
      lockedAt: new Date(),
    })

    return res.status(201).json({
      success: true,
      message: "Attendance submitted successfully",
      recordsProcessed: processedRecords.length,
      data: processedRecords,
    })

  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      message: "Failed to submit attendance",
      error: error.message,
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
        },
      },

      // filter sessions by site
      {
        $addFields: {
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

          employee: "$employee._id",

          name: "$employee.name",

          employeeId: "$employee.employeeId",

          jobTitle: "$employee.jobTitle",

          status: "$status",

          totalWorkHours: "$totalWorkHours",

          overtimeHours: "$overtimeHours",

          shiftType: "$shiftType",

          crossedMidnight: "$crossedMidnight",

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
        $regex: name,
        $options: "i",
      };
    }

    if (employeeId) {
      employeeFilter.employeeId = {
        $regex: employeeId,
        $options: "i",
      };
    }

    if (jobTitle) {
      employeeFilter.jobTitle = {
        $regex: jobTitle,
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
    if (site) {
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

        totalWorkHours:
          record.totalWorkHours,

        overtimeHours:
          record.overtimeHours,

        shiftType: record.shiftType,

        crossedMidnight: record.crossedMidnight,

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
  try {
    const {
      siteId,
      date,
      isHoliday = false,
      attendance,
    } = req.body;

    // VALIDATION
    if (
      !siteId ||
      !date ||
      !attendance ||
      !Array.isArray(attendance) ||
      attendance.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "siteId, date and attendance array are required",
      });
    }

    const markedBy = req.user?.id;

    // NORMALIZE DATE
    const attendanceDate =
      new Date(date);

    attendanceDate.setUTCHours(
      0,
      0,
      0,
      0
    );

    // CHECK LOCK
    // EDIT ONLY ALLOWED IF UNLOCKED
    const existingLock =
      await AttendanceLock.findOne({
        siteId,
        date: attendanceDate,
        isLocked: true,
      });

    if (existingLock) {
      return res.status(400).json({
        success: false,
        message:
          "Attendance is locked. Unlock before editing.",
      });
    }

    // GET WORK CONFIG
    const workConfig =
      await workModel.findOne();

    if (!workConfig) {
      return res.status(404).json({
        success: false,
        message:
          "Work schedule configuration not found",
      });
    }

    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
    } = workConfig;

    const processedRecords = [];

    // PROCESS EACH EMPLOYEE
    for (const entry of attendance) {
      const {
        employeeId,
        jobId,
        checkIn,
        checkOut,
      } = entry;

      // FIND ATTENDANCE DOC
      const attendanceDoc =
        await Attendance.findOne({
          employee: employeeId,
          date: attendanceDate,
        });

      // MUST EXIST DURING EDIT
      if (!attendanceDoc) {
        continue;
      }

      // CALCULATE WORKED HOURS
      let workedHours = 0;

      if (checkIn && checkOut) {
        const diffMs =
          new Date(checkOut) -
          new Date(checkIn);

        workedHours =
          diffMs /
          (1000 * 60 * 60);

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
      const existingSessionIndex =
        attendanceDoc.sessions.findIndex(
          (session) =>
            session.siteId.toString() ===
            siteId.toString()
        );

      // UPDATE EXISTING SESSION
      if (
        existingSessionIndex !== -1
      ) {
        attendanceDoc.sessions[
          existingSessionIndex
        ] = {
          ...attendanceDoc.sessions[
            existingSessionIndex
          ].toObject(),

          ...updatedSession,
        };
      }

      // IF SESSION DOESN'T EXIST,
      // ADD IT
      else {
        attendanceDoc.sessions.push(
          updatedSession
        );
      }

      // RECALCULATE TOTAL HOURS
      const totalWorkHours =
        attendanceDoc.sessions.reduce(
          (acc, session) => {
            return (
              acc +
              (session.workedHours ||
                0)
            );
          },
          0
        );

      // RECALCULATE STATUS
      let status = "absent";

      if (
        totalWorkHours >=
        fullDayHours
      ) {
        status = "fullday";
      } else if (
        totalWorkHours >=
        halfDayHours
      ) {
        status = "halfday";
      }

      // RECALCULATE OT
      let overtimeHours = 0;

      if (
        totalWorkHours >
        overtimeThreshold
      ) {
        overtimeHours =
          totalWorkHours -
          overtimeThreshold;
      }

      // UPDATE DOC
      attendanceDoc.totalWorkHours =
        totalWorkHours;

      attendanceDoc.status =
        status;

      attendanceDoc.overtimeHours =
        overtimeHours;

      attendanceDoc.isHoliday =
        isHoliday;

      await attendanceDoc.save();

      processedRecords.push(
        attendanceDoc
      );
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
      }
    );
    return res.status(200).json({
      success: true,

      message:
        "Attendance edited successfully",

      recordsProcessed:
        processedRecords.length,

      data: processedRecords,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,

      message:
        "Failed to edit attendance",

      error: error.message,
    });
  }
};//

export const updateAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { sessions, siteId: bodySiteId } = req.body;
    const { siteId: querySiteId } = req.query;
    const siteId = querySiteId || bodySiteId;
    const timezoneOffset = req.headers['x-timezone-offset'];

    let offsetVal = -330;
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
      // Validate sessions first
      for (const session of sessions) {
        if (!session.checkIn && session.checkOut) {
          return res.status(400).json({
            success: false,
            message: "Check-out cannot exist without check-in",
          });
        }
        if (session.isNightShift) {
          const cutoffHour = workConfig.nightShiftCutoffHour || 7;
          if (session.checkIn) {
            const inDate = new Date(session.checkIn);
            const localInTime = new Date(inDate.getTime() - offsetVal * 60 * 1000);
            const inH = localInTime.getUTCHours();
            if (inH >= cutoffHour && inH < 12) {
              return res.status(400).json({
                success: false,
                message: `Check-in time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`,
              });
            }
          }
          if (session.checkOut) {
            const outDate = new Date(session.checkOut);
            const localOutTime = new Date(outDate.getTime() - offsetVal * 60 * 1000);
            const outH = localOutTime.getUTCHours();
            if (outH >= cutoffHour && outH < 12) {
              return res.status(400).json({
                success: false,
                message: `Check-out time must be before the cutoff hour (${cutoffHour}:00 AM) for night shifts.`,
              });
            }
          }
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

          if (
            session.checkIn &&
            session.checkOut
          ) {
            const checkIn = new Date(
              session.checkIn
            );

            const checkOut = new Date(
              session.checkOut
            );

            // Handle cross-midnight: if checkOut is on the next day
            if (checkOut < checkIn) {
              checkOut.setDate(checkOut.getDate() + 1);
            }

            workedHours =
              (checkOut.getTime() -
                checkIn.getTime()) /
              (1000 * 60 * 60);
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
            isNightShift:
              session.isNightShift || false,
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
        // Preserve all sessions that belong to other sites
        const preservedSessions = attendance.sessions.filter(
          (session) => session.siteId.toString() !== siteId.toString()
        );
        combinedSessions = [...preservedSessions, ...siteSessions];
      } else {
        combinedSessions = processedSessions;
      }

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
          return res.status(400).json({
            success: false,
            message:
              "Attendance sessions overlap",

            overlap: {
              firstIndex: i,
              secondIndex: i + 1,

              sessionA: {
                _id: current._id,
                siteId: current.siteId,
                jobId: current.jobId,
                checkIn:
                  current.checkIn,
                checkOut:
                  current.checkOut,
              },

              sessionB: {
                _id: next._id,
                siteId: next.siteId,
                jobId: next.jobId,
                checkIn:
                  next.checkIn,
                checkOut:
                  next.checkOut,
              },
            },
          });
        }
      }

      attendance.sessions =
        combinedSessions;

      // Night shift detection
      const hasCrossedMidnight = detectCrossedMidnight(combinedSessions, timezoneOffset);
      attendance.crossedMidnight = hasCrossedMidnight;
      attendance.shiftType = hasCrossedMidnight ? "night" : "day";

      // -----------------------------
      // Total worked hours
      // -----------------------------
      const totalHours =
        combinedSessions.reduce(
          (total, session) =>
            total + session.workedHours,
          0
        );

      attendance.totalWorkHours =
        Number(totalHours.toFixed(2));

      // -----------------------------
      // Overtime
      // -----------------------------
      attendance.overtimeHours =
        totalHours >
          workConfig.overtimeThreshold
          ? Number(
            (
              totalHours -
              workConfig.overtimeThreshold
            ).toFixed(2)
          )
          : 0;

      // -----------------------------
      // Attendance status
      // -----------------------------
      if (
        totalHours >=
        workConfig.fullDayHours
      ) {
        attendance.status =
          "fullday";
      } else if (
        totalHours >=
        workConfig.halfDayHours
      ) {
        attendance.status =
          "halfday";
      } else {
        attendance.status =
          "absent";
      }
    }

    await attendance.save();

    const updatedAttendance =
      await Attendance.findById(
        attendance._id
      )
        .populate(
          "employee",
          "name employeeId jobTitle"
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

      totalWorkHours:
        updatedAttendance.totalWorkHours,

      overtimeHours:
        updatedAttendance.overtimeHours,

      shiftType: updatedAttendance.shiftType,

      crossedMidnight: updatedAttendance.crossedMidnight,

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

        totalWorkHours:
          record.totalWorkHours,

        overtimeHours:
          record.overtimeHours,

        shiftType: record.shiftType,

        crossedMidnight: record.crossedMidnight,

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
  addSessionToAttendance

};

export default attendanceController;
