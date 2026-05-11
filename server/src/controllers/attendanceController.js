import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import Employee from '../models/empModel.js';
import mongoose from 'mongoose';

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

    const markedBy = req.user?.id || '69f33152d121b1a10b175d46'

    const parsedDate = new Date(date)
    parsedDate.setUTCHours(0, 0, 0, 0)

    // 🔒 Check if already submitted (lock exists)
    const existingLock = await AttendanceLock.findOne({ siteId, date: parsedDate })

    if (existingLock) {
      return res.status(400).json({
        message: "Attendance already submitted for this date and site"
      })
    }

    const getWorkHours = (status) => {
      if (status === 'present') return 10
      if (status === 'halfday') return 5
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

    const getWorkHours = (status) => {
      if (status === 'present') return 10
      if (status === 'halfday') return 5
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
export const getMonthlyReport = async (req, res) => {
  try {
    const {
      month,
      year,
      siteId,
      name,
      employeeId,
      page = 1,
      limit = 10
    } = req.query

    if (!month || !year) {
      return res.status(400).json({
        message: "month and year are required"
      })
    }

    const skip = (page - 1) * limit

    const start = new Date(Date.UTC(year, month - 1, 1))
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

    const empMatch = {}

    if (name) {
      empMatch.name = { $regex: name, $options: "i" }
    }

    if (employeeId) {
      empMatch.employeeId = { $regex: employeeId, $options: "i" }
    }

    const pipeline = [
      { $match: empMatch },

      {
        $lookup: {
          from: "attendances",
          let: { empId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employee", "$$empId"] },
                    { $gte: ["$date", start] },
                    { $lte: ["$date", end] },
                    ...(siteId
                      ? [{ $eq: ["$siteId", new mongoose.Types.ObjectId(siteId)] }]
                      : [])
                  ]
                }
              }
            }
          ],
          as: "attendance"
        }
      },

      // 🔥 Apply business logic
      {
        $addFields: {
          presentDays: {
            $size: {
              $filter: {
                input: "$attendance",
                cond: {
                  $and: [
                    { $eq: ["$$this.status", "present"] },
                    { $eq: ["$$this.isHoliday", false] }
                  ]
                }
              }
            }
          },

          absentDays: {
            $size: {
              $filter: {
                input: "$attendance",
                cond: { $eq: ["$$this.status", "absent"] }
              }
            }
          },

          halfDays: {
            $size: {
              $filter: {
                input: "$attendance",
                cond: {
                  $and: [
                    { $eq: ["$$this.status", "halfday"] },
                    { $eq: ["$$this.isHoliday", false] }
                  ]
                }
              }
            }
          },

          totalWorkHours: {
            $sum: "$attendance.workHours"
          },

          totalOvertime: {
            $sum: {
              $map: {
                input: "$attendance",
                as: "att",
                in: {
                  $cond: [
                    { $eq: ["$$att.isHoliday", true] },
                    "$$att.workHours", // holiday → full OT
                    { $ifNull: ["$$att.overtimeHours", 0] }
                  ]
                }
              }
            }
          }
        }
      },

      {
        $addFields: {
          payableDays: {
            $add: [
              "$presentDays",
              { $multiply: ["$halfDays", 0.5] }
            ]
          }
        }
      },

      // 🔥 Salary calculation
      {
        $addFields: {
          perDayPay: {
            $divide: ["$monthlySalary", 26] // adjust if needed
          },
          hourlyRate: {
            $divide: [
              { $divide: ["$monthlySalary", 26] },
              10 // hours/day
            ]
          }
        }
      },
      {
        $addFields: {
          baseSalary: {
            $round: [
              { $multiply: ["$perDayPay", "$payableDays"] },
              2
            ]
          },
          otPay: {
            $round: [
              { $multiply: ["$totalOvertime", "$hourlyRate", 1.25] },
              2
            ]
          }
        }
      },
      {
        $addFields: {
          totalSalary: {
            $round: [
              { $add: ["$baseSalary", "$otPay"] },
              2
            ]
          }
        }
      },

      {
        $project: {
          _id: 0,
          employeeId: 1,
          name: 1,
          jobTitle: 1,

          presentDays: 1,
          absentDays: 1,
          halfDays: 1,

          totalWorkHours: 1,
          totalOvertime: 1,

          payableDays: 1,

          baseSalary: 1,
          otPay: 1,
          totalSalary: 1
        }
      },

      { $skip: Number(skip) },
      { $limit: Number(limit) }
    ]

    const data = await Employee.aggregate(pipeline)

    const total = await Employee.countDocuments(empMatch)

    res.json({
      message: "Monthly report fetched",
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      totalEmployees: total,
      data
    })

  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to generate report",
      error: error.message
    })
  }
}

//GET /api/attendance/reports/daily
export const getDaily = async (req, res) => {
  try {
    const {
      date,
      site,
      name,
      employeeId,
      page = 1,
      limit = 10
    } = req.query

    if (!date) {
      return res.status(400).json({ message: 'date is required' })
    }

    const pageNumber = Math.max(Number(page) || 1, 1)
    const limitNumber = Math.max(Number(limit) || 10, 1)
    const skip = (pageNumber - 1) * limitNumber

    const queryDate = new Date(date)
    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)

    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    const attendanceMatch = {
      date: { $gte: start, $lte: end }
    }

    if (site && mongoose.Types.ObjectId.isValid(site)) {
      attendanceMatch.siteId = new mongoose.Types.ObjectId(site)
    }

    const employeeMatch = {}
    if (name) {
      employeeMatch['employee.name'] = { $regex: name, $options: 'i' }
    }
    if (employeeId) {
      employeeMatch['employee.employeeId'] = { $regex: employeeId, $options: 'i' }
    }
    if (site && !mongoose.Types.ObjectId.isValid(site)) {
      employeeMatch['site.name'] = { $regex: site, $options: 'i' }
    }

    const pipeline = [
      { $match: attendanceMatch },
      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employee'
        }
      },
      { $unwind: '$employee' },
      {
        $lookup: {
          from: 'sites',
          localField: 'siteId',
          foreignField: '_id',
          as: 'site'
        }
      },
      { $unwind: { path: '$site', preserveNullAndEmptyArrays: true } },
      { $match: employeeMatch },
      { $sort: { 'employee.name': 1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limitNumber },
            {
              $project: {
                _id: 0,
                attendanceId: '$_id',
                name: '$employee.name',
                employeeId: '$employee.employeeId',
                jobTitle: '$employee.jobTitle',
                status: '$status',
                overtimeHours: { $ifNull: ['$overtimeHours', 0] }
              }
            }
          ]
        }
      }
    ]

    const [result] = await Attendance.aggregate(pipeline)
    const total = result?.metadata?.[0]?.total || 0
    const data = (result?.data || []).map((record, index) => ({
      serialNumber: skip + index + 1,
      ...record
    }))

    return res.json({
      message: 'Daily report fetched',
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
      totalRecords: total,
      filters: { date, site: site || null, name: name || null, employeeId: employeeId || null },
      data
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      message: 'Failed to fetch daily report',
      error: error.message
    })
  }
};

//GET /api/attendance/daily-summary
export const getSummary = async (req, res) => {
  try {
    const { date } = req.query

    if (!date) {
      return res.status(400).json({ message: 'date is required' })
    }

    const queryDate = new Date(date)
    if (Number.isNaN(queryDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' })
    }

    const start = new Date(queryDate)
    start.setUTCHours(0, 0, 0, 0)

    const end = new Date(queryDate)
    end.setUTCHours(23, 59, 59, 999)

    const [overallSummary, siteSummary] = await Promise.all([
      Attendance.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: null,
            totalWorkers: { $sum: 1 },
            presentWorkers: {
              $sum: {
                $cond: [{ $eq: ['$status', 'present'] }, 1, 0]
              }
            }
          }
        }
      ]),
      Attendance.aggregate([
        { $match: { date: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: '$siteId',
            totalWorkers: { $sum: 1 },
            presentWorkers: {
              $sum: {
                $cond: [{ $eq: ['$status', 'present'] }, 1, 0]
              }
            }
          }
        },
        {
          $lookup: {
            from: 'sites',
            localField: '_id',
            foreignField: '_id',
            as: 'site'
          }
        },
        { $unwind: { path: '$site', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            siteId: '$_id',
            siteName: {
              $cond: [
                { $eq: ['$_id', null] },
                'in office',
                '$site.siteName'
              ]
            },
            presentWorkers: 1,
            totalWorkers: 1
          }
        },
        { $sort: { siteName: 1 } }
      ])
    ])

    const totals = overallSummary?.[0] || { presentWorkers: 0, totalWorkers: 0 }

    return res.json({
      message: 'Daily attendance summary fetched',
      date,
      overall: {
        presentWorkers: totals.presentWorkers,
        totalWorkers: totals.totalWorkers,
        attendance: `${totals.presentWorkers}/${totals.totalWorkers}`
      },
      siteAttendance: siteSummary.map((site) => ({
        ...site,
        attendance: `${site.presentWorkers}/${site.totalWorkers}`
      }))
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      message: 'Failed to fetch daily summary',
      error: error.message
    })
  }
};

export const getWorkerAttendance = async (req, res) => {
    // Logic to get history for a specific employee
};




// --- DEFAULT EXPORT ---

const attendanceController = {
    getMonthlyReport,
    getDaily,
    getSummary,
    getWorkerAttendance,
    submitDaily,
    bulkUpdateAttendance,
    unlockAttendance
};

export default attendanceController;
