import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import Employee from '../models/empModel.js';
import empModel from '../models/empModel.js';
import mongoose from 'mongoose';
import workModel from '../models/workModel.js';
import Site from '../models/siteModel.js';
import siteModel from '../models/siteModel.js';

// --- ADMINS ---


// POST /api/attendance/submit

export const submitDaily = async (req, res) => {
  try {
    const { siteId, date, attendance, isHoliday = false } = req.body

    if (!siteId || !date || !attendance || !attendance.length) {
      return res.status(400).json({
        message: "siteId, date and attendance array are required"
      })
    }

    const markedBy = req.user?.id

    console.log(markedBy)

    const parsedDate = new Date(date)
    parsedDate.setUTCHours(0, 0, 0, 0)

    // 🔒 Check if already submitted (lock exists)
    const existingLock = await AttendanceLock.findOne({ siteId, date: parsedDate })

    if (existingLock) {
      return res.status(400).json({
        message: "Attendance already submitted for this date and site"
      })
    }

    const workSchedule = await workModel.findOne()

    const shiftHours = workSchedule?.shiftHours || 10

    const getWorkHours = (status) => {
      if (status === 'present') return shiftHours
      if (status === 'halfday') return shiftHours / 2
      return 0
    }

    const records = attendance.map((entry) => ({
      employee: entry.employee,
      siteId,
      markedBy,
      date: parsedDate,
      status: entry.status,
      isHoliday,
      workHours: getWorkHours(entry.status),
      overtimeHours: entry.overtimeHours || 0
    }))

    // 🚫 No need for ordered:false anymore — fail fast
    const insertedDocs = await Attendance.insertMany(records)

    // 🔒 Create lock AFTER successful insert
    await AttendanceLock.create({
      siteId,
      date: parsedDate,
      isLocked: true,
      lockedBy: markedBy,
      lockedAt: new Date()
    })

    return res.status(201).json({
      message: "Attendance submitted successfully",
      recordsCreated: insertedDocs.length
    })

  } catch (error) {
    console.error(error)

    // 🔥 Better duplicate error message
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Duplicate attendance detected (same employee + date)"
      })
    }

    return res.status(500).json({
      message: "Failed to submit attendance",
      error: error.message
    })
  }
}

//PATCH /api/attendance/bulk-update
export const bulkUpdateAttendance = async (req, res) => {
  try {
    const { siteId, date, updates, isHoliday = false } = req.body

    if (!siteId || !date) {
      return res.status(400).json({
        message: "siteId and date are required"
      })
    }

    if (!updates || !updates.length) {
      return res.status(400).json({
        message: "No updates provided"
      })
    }

    const parsedDate = new Date(date)
    parsedDate.setUTCHours(0, 0, 0, 0)

    const workSchedule = await workModel.findOne()

    const shiftHours = workSchedule?.shiftHours || 10

    const getWorkHours = (status) => {
      if (status === 'present') return shiftHours
      if (status === 'halfday') return shiftHours / 2
      return 0
    }

    // 🔒 Check lock from AttendanceLock model
    const lock = await AttendanceLock.findOne({ siteId, date: parsedDate })

    if (!lock) {
      return res.status(404).json({
        message: "Attendance not initialized for this date"
      })
    }

    if (lock.isLocked) {
      return res.status(400).json({
        message: "Attendance is locked. Unlock before editing."
      })
    }

    // ⚙️ Prepare bulk operations
    const bulkOps = updates.map((entry) => ({
      updateOne: {
        filter: { _id: entry.attendanceId },
        update: {
          status: entry.status,
          isHoliday: isHoliday,
          workHours: getWorkHours(entry.status),
          overtimeHours: entry.overtimeHours || 0,
          markedBy: req.user?.id || '69f33152d121b1a10b175d46'
        }
      }
    }))

    await Attendance.bulkWrite(bulkOps)

    // 🔒 Re-lock using AttendanceLock
    await AttendanceLock.findOneAndUpdate(
      { siteId, date: parsedDate },
      {
        isLocked: true,
        lockedBy: req.user?.id || '69f33152d121b1a10b175d46',
        lockedAt: new Date()
      }
    )

    res.json({
      message: "Attendance updated successfully"
    })

  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to update attendance",
      error: error.message
    })
  }
}

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
}

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

    const WORKING_DAYS_PER_MONTH = 26; // TODO: Make configurable from WorkSchedule

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
        }

        const absentDays =
          daysInMonth -
          fullDays -
          halfDays -
          holidayRecords;

        const dailySalary =
          employee.monthlySalary /
          WORKING_DAYS_PER_MONTH;

        const normalPay =
          payableDays * dailySalary;

        const overtimePay =
          overtimeHours *
          workConfig.overtimeRatePerHour;

        const salary =
          normalPay + overtimePay;

        const attendancePercentage =
          Math.min(
            (payableDays /
              WORKING_DAYS_PER_MONTH) *
              100,
            100
          );

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
};

//GET /api/attendance/reports/daily
export const getDaily = async (req, res) => {
  try {
    const {
      date,
      site,
      jobTitle,
      name,
      employeeId,
      page,
      limit
    } = req.query

    if (!date) {
      return res.status(400).json({
        message: 'date is required'
      })
    }

    const queryDate = new Date(date)

    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({
        message: 'Invalid date format'
      })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)

    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    const attendanceMatch = {
      date: { $gte: start, $lte: end }
    }

    if (site && mongoose.Types.ObjectId.isValid(site)) {
      attendanceMatch.siteId =
        new mongoose.Types.ObjectId(site)
    }

    const employeeMatch = {}

    if (name) {
      employeeMatch['employee.name'] = {
        $regex: name,
        $options: 'i'
      }
    }

    if (employeeId) {
      employeeMatch['employee.employeeId'] = {
        $regex: employeeId,
        $options: 'i'
      }
    }

    if (jobTitle) {
      employeeMatch['employee.jobTitle'] = {
        $regex: jobTitle,
        $options: 'i'
      }
    }

    if (
      site &&
      !mongoose.Types.ObjectId.isValid(site)
    ) {
      employeeMatch['site.siteName'] = {
        $regex: site,
        $options: 'i'
      }
    }

    const pipeline = [
      {
        $match: attendanceMatch
      },

      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employee'
        }
      },

      {
        $unwind: '$employee'
      },

      {
        $lookup: {
          from: 'sites',
          localField: 'siteId',
          foreignField: '_id',
          as: 'site'
        }
      },

      {
        $unwind: {
          path: '$site',
          preserveNullAndEmptyArrays: true
        }
      },

      {
        $match: employeeMatch
      },

      {
        $sort: {
          'employee.name': 1
        }
      }
    ]

    const shouldPaginate = page && limit

    let pageNumber = null
    let limitNumber = null
    let skip = 0

    const projectStage = {
      _id: 0,
      attendanceId: '$_id',

      employee: '$employee._id',

      siteId: '$siteId',

      date: '$date',

      siteName: '$site.siteName',

      name: '$employee.name',

      employeeId: '$employee.employeeId',

      jobTitle: '$employee.jobTitle',

      status: '$status',

      isHoliday: '$isHoliday',

      overtimeHours: {
        $ifNull: ['$overtimeHours', 0]
      }
    }

    if (shouldPaginate) {
      pageNumber =
        Math.max(Number(page) || 1, 1)

      limitNumber =
        Math.max(Number(limit) || 10, 1)

      skip =
        (pageNumber - 1) * limitNumber

      pipeline.push({
        $facet: {
          metadata: [
            {
              $count: 'total'
            }
          ],

          data: [
            {
              $skip: skip
            },

            {
              $limit: limitNumber
            },

            {
              $project: projectStage
            }
          ]
        }
      })

      const [result] =
        await Attendance.aggregate(pipeline)

      const total =
        result?.metadata?.[0]?.total || 0

      const data = (result?.data || []).map(
        (record, index) => ({
          serialNumber: skip + index + 1,
          ...record
        })
      )

      const isHoliday =
        result?.data?.[0]?.isHoliday || false

      return res.json({
        message: 'Daily report fetched',

        page: pageNumber,

        limit: limitNumber,

        totalPages: Math.ceil(
          total / limitNumber
        ),

        totalRecords: total,

        isHoliday,

        filters: {
          date,

          site: site || null,

          name: name || null,

          employeeId: employeeId || null,

          jobTitle: jobTitle || null
        },

        data
      })
    }

    pipeline.push({
      $project: projectStage
    })

    const result =
      await Attendance.aggregate(pipeline)

    const data = result.map(
      (record, index) => ({
        serialNumber: index + 1,
        ...record
      })
    )

    const isHoliday =
      result?.[0]?.isHoliday || false

    return res.json({
      message: 'Daily report fetched',

      totalRecords: data.length,

      isHoliday,

      filters: {
        date,

        site: site || null,

        name: name || null,

        employeeId: employeeId || null,

        jobTitle: jobTitle || null
      },

      data
    })

  } catch (error) {
    console.error(error)

    return res.status(500).json({
      message: 'Failed to fetch daily report',
      error: error.message
    })
  }
}

//GET /api/attendance/daily-summary
export const getSummary = async (req, res) => {
  try {
    let targetDate;

    if (req.query.date) {
      targetDate = new Date(
        req.query.date
      );

      if (isNaN(targetDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date",
        });
      }
    } else {
      targetDate = new Date();
    }

    const startOfDay = new Date(
      targetDate
    );

    startOfDay.setHours(
      0,
      0,
      0,
      0
    );

    const endOfDay = new Date(
      targetDate
    );

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
        attendance.status ===
        "fullday" ||
        attendance.status ===
        "halfday"
      ) {
        presentToday++;
      }

      // Total man hours
      manHoursToday +=
        attendance.totalWorkHours || 0;

      // Site statistics
      for (const session of attendance.sessions) {
        const siteId =
          session.siteId?.toString();

        if (!siteId) continue;

        if (!siteMap.has(siteId)) {
          siteMap.set(siteId, {
            siteId,
            employees: new Set(),
            manHoursToday: 0,
          });
        }

        const siteStats =
          siteMap.get(siteId);

        siteStats.manHoursToday +=
          session.workedHours || 0;

        siteStats.employees.add(
          attendance.employee.toString()
        );
      }
    }

    // Active sites only
    const activeSites =
      await siteModel.find({
        isActive: true,
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

      sites.push({
        siteId,

        siteName: site.siteName,

        employeesToday:
          stats.employees.size,

        manHoursToday: Number(
          stats.manHoursToday.toFixed(
            2
          )
        ),

        averageHoursPerWorker:
          stats.employees.size > 0
            ? Number(
              (
                stats.manHoursToday /
                stats.employees.size
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
};

export const getWorkerAttendance = async (req, res) => {
  // Logic to get history for a specific employee
};

export const updateAttendanceRecord = async (req, res) => {
  try {
    const { attendanceId } = req.params

    const { status, overtimeHours = 0 } = req.body

    const attendance = await Attendance.findById(attendanceId)

    if (!attendance) {
      return res.status(404).json({
        message:
          "Attendance record not found"
      })
    }

    const normalizedDate =
      new Date(attendance.date)

    normalizedDate.setUTCHours(0, 0, 0, 0)

    const lock = await AttendanceLock.findOne({ siteId: attendance.siteId, date: normalizedDate })

    if (!lock) {
      return res.status(404).json({
        message:
          "Attendance lock not found"
      })
    }

    if (lock.isLocked) { return res.status(400).json({ message: "Attendance is locked" }) }

    const getWorkHours = (status) => {
      if (status === "present")
        return 10

      if (status === "halfday")
        return 5

      return 0
    }

    attendance.status = status

    attendance.overtimeHours = overtimeHours

    attendance.workHours = getWorkHours(status)

    attendance.markedBy = req.user?.id

    await attendance.save()

    await AttendanceLock.findOneAndUpdate(
      {
        siteId: attendance.siteId,
        date: normalizedDate
      },
      {
        isLocked: true,
        lockedBy: req.user?.id,
        lockedAt: new Date()
      }
    )

    return res.json({ message: "Attendance updated successfully" })
  } catch (error) {
    console.error(error)

    return res.status(500).json({ message: "Failed to update attendance", error: error.message })
  }
}

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


//new submit attendance record one at a time 
export const saveAttendanceRecord = async (req, res) => {
  try {
    const {
      employeeId,
      siteId,
      jobId,
      date,

      checkIn,
      checkOut,

      isHoliday = false,
    } = req.body;

    const markedBy = req.user.id;

    // Normalize date
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    // Get work schedule config
    const workConfig = await workModel.findOne();

    if (!workConfig) {
      return res.status(404).json({
        success: false,
        message: "Work schedule configuration not found",
      });
    }

    const {
      fullDayHours,
      halfDayHours,
      overtimeThreshold,
    } = workConfig;

    // Find existing attendance record
    let attendance = await attendanceModel.findOne({
      employee: employeeId,
      date: attendanceDate,
    });

    // Calculate worked hours for this session
    let workedHours = 0;

    if (checkIn && checkOut) {
      const diffMs =
        new Date(checkOut) - new Date(checkIn);

      workedHours =
        diffMs / (1000 * 60 * 60);

      // Prevent negative values
      if (workedHours < 0) {
        return res.status(400).json({
          success: false,
          message:
            "Check-out time cannot be before check-in time",
        });
      }
    }

    const sessionData = {
      siteId,
      jobId,
      checkIn,
      checkOut,
      workedHours,
      markedBy,
    };

    // CREATE NEW ATTENDANCE
    if (!attendance) {
      // Calculate status
      let status = "absent";

      if (workedHours >= fullDayHours) {
        status = "fullday";
      } else if (
        workedHours >= halfDayHours
      ) {
        status = "halfday";
      }

      // Calculate overtime
      let overtimeHours = 0;

      if (
        workedHours > overtimeThreshold
      ) {
        overtimeHours =
          workedHours - overtimeThreshold;
      }

      attendance =
        await attendanceModel.create({
          employee: employeeId,

          siteId,
          jobId,

          markedBy,

          date: attendanceDate,

          status,

          isHoliday,

          totalWorkHours: workedHours,

          overtimeHours,

          sessions: [sessionData],
        });

      return res.status(201).json({
        success: true,
        message:
          "Attendance created successfully",
        attendance,
      });
    }

    // CHECK IF SESSION FOR THIS SITE EXISTS
    const existingSessionIndex =
      attendance.sessions.findIndex(
        (session) =>
          session.siteId.toString() ===
          siteId.toString()
      );

    // UPDATE EXISTING SESSION
    if (existingSessionIndex !== -1) {
      attendance.sessions[
        existingSessionIndex
      ] = {
        ...attendance.sessions[
          existingSessionIndex
        ].toObject(),

        ...sessionData,
      };
    }

    // ADD NEW SESSION
    else {
      attendance.sessions.push(
        sessionData
      );
    }

    // RECALCULATE TOTAL WORK HOURS
    const totalWorkHours =
      attendance.sessions.reduce(
        (acc, session) =>
          acc +
          (session.workedHours || 0),
        0
      );

    // CALCULATE STATUS
    let status = "absent";

    if (totalWorkHours >= fullDayHours) {
      status = "fullday";
    } else if (
      totalWorkHours >= halfDayHours
    ) {
      status = "halfday";
    }

    // CALCULATE OVERTIME
    let overtimeHours = 0;

    if (
      totalWorkHours >
      overtimeThreshold
    ) {
      overtimeHours =
        totalWorkHours -
        overtimeThreshold;
    }

    // UPDATE ATTENDANCE
    attendance.totalWorkHours =
      totalWorkHours;

    attendance.status = status;

    attendance.overtimeHours =
      overtimeHours;

    attendance.isHoliday =
      isHoliday;

    await attendance.save();

    return res.status(200).json({
      success: true,
      message:
        "Attendance updated successfully",
      attendance,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


//check in check out

//submit
export const bulkSubmitAttendance = async (req, res) => {
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
          "Attendance already submitted and locked for this site/date",
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

    const {fullDayHours, halfDayHours, overtimeThreshold} = workConfig;

    const processedRecords = [];

    // PROCESS EACH EMPLOYEE
    for (const entry of attendance) {
      const {
        employeeId,
        jobId,
        checkIn,
        checkOut,
      } = entry;

      // VALIDATE REQUIRED FIELDS
      if (!employeeId) {
        return res.status(400).json({
          success: false,
          message:
            "employeeId is required",
        });
      }



      const hasCheckIn = !!checkIn;
      const hasCheckOut = !!checkOut;

      // CHECKOUT WITHOUT CHECKIN
      if (!hasCheckIn && hasCheckOut) {
        return res.status(400).json({
          success: false,
          message:
            "Check-out cannot exist without check-in",
        });
      }

      let workedHours = 0;

      // ONLY VALIDATE IF BOTH EXIST
      if (hasCheckIn && hasCheckOut) {
        const newCheckIn =
          new Date(checkIn);

        const newCheckOut =
          new Date(checkOut);

        if (
          isNaN(newCheckIn.getTime()) ||
          isNaN(newCheckOut.getTime())
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid checkIn/checkOut date",
          });
        }

        workedHours =
          (newCheckOut.getTime() -
            newCheckIn.getTime()) /
          (1000 * 60 * 60);

        if (workedHours < 0) {
          return res.status(400).json({
            success: false,
            message:
              "checkOut must be after checkIn",
          });
        }

        if (workedHours > 24) {
          return res.status(400).json({
            success: false,
            message:
              "Shift duration cannot exceed 24 hours",
          });
        }
      }
      // SESSION OBJECT
      const sessionData = {
        siteId,
        jobId,
        checkIn,
        checkOut,
        workedHours,
        markedBy,
      };

      // FIND EXISTING ATTENDANCE
      let attendanceDoc =
        await Attendance.findOne({
          employee: employeeId,
          date: attendanceDate,
        }).populate("sessions.siteId", "siteName");

      // CREATE NEW ATTENDANCE
      if (!attendanceDoc) {
        // CALCULATE STATUS
        let status = "absent";

        if (
          workedHours >=
          fullDayHours
        ) {
          status = "fullday";
        } else if (
          workedHours >=
          halfDayHours
        ) {
          status = "halfday";
        }

        // CALCULATE OT
        let overtimeHours = 0;

        if (
          workedHours >
          overtimeThreshold
        ) {
          overtimeHours =
            workedHours -
            overtimeThreshold;
        }

        attendanceDoc =
          await Attendance.create({
            employee: employeeId,

            siteId,
            jobId,

            markedBy,

            date: attendanceDate,

            status,

            isHoliday,

            totalWorkHours:
              workedHours,

            overtimeHours,

            sessions: [sessionData],
          });

        processedRecords.push(
          attendanceDoc
        );

        continue;
      }

      // FIND EXISTING SESSION FOR SAME SITE
      const existingSessionIndex =
        attendanceDoc.sessions.findIndex(
          (session) =>
            session.siteId._id.toString() ===
            siteId.toString()
        );

      // CHECK OVERLAPS
      const overlappingSession =
        attendanceDoc.sessions.find(
          (session, index) => {

            // SKIP CURRENT SESSION WHEN UPDATING
            if (
              index ===
              existingSessionIndex
            ) {
              return false;
            }

            // IGNORE INVALID SESSIONS
            if (
              !session.checkIn ||
              !session.checkOut
            ) {
              return false;
            }

            const existingCheckIn =
              new Date(
                session.checkIn
              );

            const existingCheckOut =
              new Date(
                session.checkOut
              );

            if (!hasCheckIn || !hasCheckOut) {
              return false;
            }

            return (
              newCheckIn < existingCheckOut && newCheckOut > existingCheckIn
            );
          }
        );

      // OVERLAP FOUND
      if (overlappingSession) {
        return res.status(400).json({
          success: false,

          message:
            "Attendance session overlaps with existing session",

          overlap: {
            employeeId,

            siteName:
              overlappingSession.siteId.siteName,

            checkIn:
              overlappingSession.checkIn,

            checkOut:
              overlappingSession.checkOut,
          },
        });
      }

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

          ...sessionData,
        };
      }

      // ADD NEW SESSION
      else {
        attendanceDoc.sessions.push(
          sessionData
        );
      }

      // SORT SESSIONS BY CHECK-IN
      attendanceDoc.sessions.sort(
        (a, b) =>
          new Date(a.checkIn) -
          new Date(b.checkIn)
      );

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

      attendanceDoc.siteId =
        siteId;

      attendanceDoc.jobId =
        jobId;

      attendanceDoc.markedBy =
        markedBy;

      await attendanceDoc.save();

      processedRecords.push(
        attendanceDoc
      );
    }

    // CREATE LOCK
    await AttendanceLock.create({
      siteId,
      date: attendanceDate,

      isLocked: true,

      lockedBy: markedBy,

      lockedAt: new Date(),
    });

    return res.status(201).json({
      success: true,

      message:
        "Attendance submitted successfully",

      recordsProcessed:
        processedRecords.length,

      data: processedRecords,
    });

  } catch (error) {
    console.error(error);

    // DUPLICATE KEY ERROR
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "Duplicate attendance detected",
      });
    }

    return res.status(500).json({
      success: false,

      message:
        "Failed to submit attendance",

      error: error.message,
    });
  }
};


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
        } = session

        const finalSiteId = sessionSiteId || siteId

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
          const inTime = new Date(
            `${date}T${checkIn}:00`
          )

          const outTime = new Date(
            `${date}T${checkOut}:00`
          )

          if (
            isNaN(inTime.getTime()) ||
            isNaN(outTime.getTime())
          ) {
            return res.status(400).json({
              success: false,
              message: "Invalid checkIn/checkOut",
            })
          }

          if (outTime < inTime) {
            return res.status(400).json({
              success: false,
              message: "checkOut cannot be earlier than checkIn",
            })
          }

          workedHours =
            (outTime.getTime() - inTime.getTime()) /
            (1000 * 60 * 60)
        }

        const checkInDate = checkIn
          ? new Date(`${date}T${checkIn}:00`)
          : null

        const checkOutDate = checkOut
          ? new Date(`${date}T${checkOut}:00`)
          : null

        // RULE: checkIn only OR null/null → 0 hours
        updatedSessions.push({
          siteId: finalSiteId,
          jobId: job?._id || null,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          workedHours: Number(workedHours.toFixed(2)),
          markedBy,
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
}


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
};

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
};

export const updateAttendance = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { sessions } = req.body;

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
      const updatedSessions = sessions.map(
        (session) => {
          // -----------------------------
          // Validation
          // -----------------------------

          // checkOut without checkIn
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

            if (checkOut < checkIn) {
              throw new Error(
                "Check-out cannot be earlier than check-in"
              );
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
            markedBy:
              session.markedBy ||
              attendance.markedBy,
          };
        }
      );

      // -----------------------------
      // Sort by checkIn
      // Empty sessions go last
      // -----------------------------
      updatedSessions.sort((a, b) => {
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
        updatedSessions.filter(
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
        updatedSessions;

      // -----------------------------
      // Total worked hours
      // -----------------------------
      const totalHours =
        updatedSessions.reduce(
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
};


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
};

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
}

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
}



// --- DEFAULT EXPORT ---

const attendanceController = {
  monthlyReport,
  getDaily,
  getSummary,
  getWorkerAttendance,
  submitDaily,
  bulkUpdateAttendance,
  unlockAttendance,
  updateAttendance,
  toggleHolidayStatus,

  bulkSubmitAttendance,
  getSiteAttendance,
  bulkEditAttendance,
  getAttendanceRecords,
  getEmployeeAttendanceByMonth,
  siteFirstSubmitAttendance,
  getAttendanceById,
  addSessionToAttendance

};

export default attendanceController;
