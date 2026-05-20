import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import Employee from '../models/empModel.js';
import mongoose from 'mongoose';
import workModel from '../models/workModel.js';

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
      if (status === 'halfday') return shiftHours/2
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
      if (status === 'halfday') return shiftHours/2
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
      jobTitle,
      page = 1,
      limit = 10
    } = req.query

    if (!month || !year) {
      return res.status(400).json({
        message: "month and year are required"
      })
    }

    const skip =
      (Number(page) - 1) * Number(limit)

    const start = new Date(
      Date.UTC(year, month - 1, 1)
    )

    const end = new Date(
      Date.UTC(
        year,
        month,
        0,
        23,
        59,
        59,
        999
      )
    )

    const empMatch = {}

    if (name) {
      empMatch.name = {
        $regex: name,
        $options: "i"
      }
    }

    if (employeeId) {
      empMatch.employeeId = {
        $regex: employeeId,
        $options: "i"
      }
    }

    if (jobTitle) {
      empMatch.jobTitle = {
        $regex: jobTitle,
        $options: "i"
      }
    }

    const pipeline = [
      {
        $match: empMatch
      },

      {
        $lookup: {
          from: "attendances",

          let: {
            empId: "$_id"
          },

          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $eq: [
                        "$employee",
                        "$$empId"
                      ]
                    },

                    {
                      $gte: [
                        "$date",
                        start
                      ]
                    },

                    {
                      $lte: [
                        "$date",
                        end
                      ]
                    },

                    ...(siteId
                      ? [
                          {
                            $eq: [
                              "$siteId",
                              new mongoose.Types.ObjectId(
                                siteId
                              )
                            ]
                          }
                        ]
                      : [])
                  ]
                }
              }
            }
          ],

          as: "attendance"
        }
      },

      // Attendance calculations

      {
        $addFields: {
          presentDays: {
            $size: {
              $filter: {
                input: "$attendance",

                cond: {
                  $and: [
                    {
                      $eq: [
                        "$$this.status",
                        "present"
                      ]
                    },

                    {
                      $eq: [
                        "$$this.isHoliday",
                        false
                      ]
                    }
                  ]
                }
              }
            }
          },

          absentDays: {
            $size: {
              $filter: {
                input: "$attendance",

                cond: {
                  $eq: [
                    "$$this.status",
                    "absent"
                  ]
                }
              }
            }
          },

          halfDays: {
            $size: {
              $filter: {
                input: "$attendance",

                cond: {
                  $and: [
                    {
                      $eq: [
                        "$$this.status",
                        "halfday"
                      ]
                    },

                    {
                      $eq: [
                        "$$this.isHoliday",
                        false
                      ]
                    }
                  ]
                }
              }
            }
          },

          totalWorkHours: {
            $sum: {
              $map: {
                input: "$attendance",

                as: "att",

                in: {
                  $ifNull: [
                    "$$att.workHours",
                    0
                  ]
                }
              }
            }
          },

          totalOvertime: {
            $sum: {
              $map: {
                input: "$attendance",

                as: "att",

                in: {
                  $cond: [
                    {
                      $eq: [
                        "$$att.isHoliday",
                        true
                      ]
                    },

                    {
                      $add: [
                        {
                          $ifNull: [
                            "$$att.workHours",
                            0
                          ]
                        },

                        {
                          $ifNull: [
                            "$$att.overtimeHours",
                            0
                          ]
                        }
                      ]
                    },

                    {
                      $ifNull: [
                        "$$att.overtimeHours",
                        0
                      ]
                    }
                  ]
                }
              }
            }
          }
        }
      },

      // Payable days

      {
        $addFields: {
          payableDays: {
            $add: [
              "$presentDays",

              {
                $multiply: [
                  "$halfDays",
                  0.5
                ]
              }
            ]
          }
        }
      },

      // Attendance percentage

      {
        $addFields: {
          attendancePercentage: {
            $cond: [
              {
                $eq: [
                  {
                    $add: [
                      "$presentDays",
                      "$absentDays",
                      "$halfDays"
                    ]
                  },

                  0
                ]
              },

              0,

              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [
                          "$payableDays",

                          {
                            $add: [
                              "$presentDays",
                              "$absentDays",
                              "$halfDays"
                            ]
                          }
                        ]
                      },

                      100
                    ]
                  },

                  0
                ]
              }
            ]
          }
        }
      },

      // Salary setup

      {
        $addFields: {
          perDayPay: {
            $divide: [
              "$monthlySalary",
              26
            ]
          },

          hourlyRate: {
            $divide: [
              {
                $divide: [
                  "$monthlySalary",
                  26
                ]
              },

              10
            ]
          }
        }
      },

      // Salary calculations

      {
        $addFields: {
          baseSalary: {
            $round: [
              {
                $multiply: [
                  "$perDayPay",
                  "$payableDays"
                ]
              },

              2
            ]
          },

          otPay: {
            $round: [
              {
                $multiply: [
                  "$totalOvertime",
                  "$hourlyRate",
                  1.25
                ]
              },

              2
            ]
          }
        }
      },

      {
        $addFields: {
          totalSalary: {
            $round: [
              {
                $add: [
                  "$baseSalary",
                  "$otPay"
                ]
              },

              2
            ]
          }
        }
      },

      // Final response

      {
        $project: {
          _id: 0,

          employeeId: 1,
          name: 1,
          jobTitle: 1,

          presentDays: 1,
          absentDays: 1,
          halfDays: 1,

          attendancePercentage: 1,

          totalWorkHours: 1,
          totalOvertime: 1,

          payableDays: 1,

          baseSalary: 1,
          otPay: 1,
          totalSalary: 1
        }
      },

      {
        $skip: Number(skip)
      },

      {
        $limit: Number(limit)
      }
    ]

    const data =
      await Employee.aggregate(pipeline)

    const total =
      await Employee.countDocuments(
        empMatch
      )

    res.json({
      message:
        "Monthly report fetched",

      page: Number(page),

      totalPages: Math.ceil(
        total / Number(limit)
      ),

      totalEmployees: total,

      data
    })
  } catch (error) {
    console.error(error)

    res.status(500).json({
      message:
        "Failed to generate report",

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

export const updateAttendanceRecord = async (req, res) => {
    try {
      const { attendanceId } = req.params

      const {status,overtimeHours = 0} = req.body

      const attendance = await Attendance.findById( attendanceId)

      if (!attendance) {
        return res.status(404).json({
          message:
            "Attendance record not found"
        })
      }

      const normalizedDate =
        new Date(attendance.date)

      normalizedDate.setUTCHours(0,0,0,0)

      const lock = await AttendanceLock.findOne({siteId: attendance.siteId, date: normalizedDate })

      if (!lock) {
        return res.status(404).json({
          message:
            "Attendance lock not found"
        })
      }

      if (lock.isLocked) { return res.status(400).json({message: "Attendance is locked" })}

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

      return res.json({message: "Attendance updated successfully"})
    } catch (error) {
      console.error(error)

      return res.status(500).json({message:"Failed to update attendance",error: error.message})
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




// --- DEFAULT EXPORT ---

const attendanceController = {
    getMonthlyReport,
    getDaily,
    getSummary,
    getWorkerAttendance,
    submitDaily,
    bulkUpdateAttendance,
    unlockAttendance,
    updateAttendanceRecord,
    toggleHolidayStatus
};

export default attendanceController;
