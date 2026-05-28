import Attendance from '../models/attendanceModel.js';
import AttendanceLock from '../models/lockModel.js'
import Employee from '../models/empModel.js';
import mongoose from 'mongoose';
import workModel from '../models/workModel.js';
import Site from '../models/siteModel.js'

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
export const bulkSubmitAttendance = async (
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

      // CALCULATE SESSION WORK HOURS
      let workedHours = 0;

      if (checkIn && checkOut) {
        const diffMs =
          new Date(checkOut) -
          new Date(checkIn);

        workedHours =
          diffMs /
          (1000 * 60 * 60);

        // INVALID TIME RANGE
        if (workedHours < 0) {
          continue;
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
        });

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

      // CHECK IF SESSION FOR THIS SITE EXISTS
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

          ...sessionData,
        };
      }

      // ADD NEW SESSION
      else {
        attendanceDoc.sessions.push(
          sessionData
        );
      }

      // RECALCULATE TOTAL WORK HOURS
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

    // CREATE LOCK AFTER SUCCESSFUL SUBMISSION
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

//get saved attendance for a site 
export const getSiteAttendance = async (
  req,
  res
) => {
  try {
    const {
      date,
      siteId,

      name,
      employeeId,
      jobTitle,

      page,
      limit,
    } = req.query;

    // VALIDATION
    if (!date || !siteId) {
      return res.status(400).json({
        success: false,
        message:
          "date and siteId are required",
      });
    }

    // VALIDATE DATE
    const queryDate =
      new Date(date);

    if (
      Number.isNaN(queryDate.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid date format",
      });
    }

    // NORMALIZE DATE RANGE
    const start = new Date(queryDate);

    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(queryDate);

    end.setHours(
      23,
      59,
      59,
      999
    );

    const existingLock =
      await AttendanceLock.findOne({
        siteId,
        date: start,
      });

    const isLocked =
      existingLock?.isLocked || false;

    // MAIN MATCH
    const attendanceMatch = {
      date: {
        $gte: start,
        $lte: end,
      },
    };

    // FILTER EMPLOYEE SEARCHES
    const employeeMatch = {};

    if (name) {
      employeeMatch["employee.name"] =
        {
          $regex: name,
          $options: "i",
        };
    }

    if (employeeId) {
      employeeMatch[
        "employee.employeeId"
      ] = {
        $regex: employeeId,
        $options: "i",
      };
    }

    if (jobTitle) {
      employeeMatch[
        "employee.jobTitle"
      ] = {
        $regex: jobTitle,
        $options: "i",
      };
    }

    // PIPELINE
    const pipeline = [
      // DATE MATCH
      {
        $match: attendanceMatch,
      },

      // FILTER ONLY SESSIONS
      // BELONGING TO THIS SITE
      {
        $addFields: {
          filteredSessions: {
            $filter: {
              input: "$sessions",

              as: "session",

              cond: {
                $eq: [
                  "$$session.siteId",
                  new mongoose.Types.ObjectId(
                    siteId
                  ),
                ],
              },
            },
          },
        },
      },

      // REMOVE ATTENDANCE DOCS
      // WITH NO MATCHING SESSION
      {
        $match: {
          filteredSessions: {
            $ne: [],
          },
        },
      },

      // EMPLOYEE LOOKUP
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

      // SITE LOOKUP
      {
        $lookup: {
          from: "sites",

          localField:
            "filteredSessions.siteId",

          foreignField: "_id",

          as: "site",
        },
      },

      {
        $unwind: {
          path: "$site",

          preserveNullAndEmptyArrays: true,
        },
      },

      // APPLY EMPLOYEE FILTERS
      {
        $match: employeeMatch,
      },

      // SORT ALPHABETICALLY
      {
        $sort: {
          "employee.name": 1,
        },
      },
    ];

    const shouldPaginate =
      page && limit;

    // RESPONSE SHAPE
    const projectStage = {
      _id: 0,

      attendanceId: "$_id",

      employee:
        "$employee._id",

      name: "$employee.name",

      employeeId:
        "$employee.employeeId",

      jobTitle:
        "$employee.jobTitle",

      siteId: "$site._id",

      siteName:
        "$site.siteName",

      date: "$date",

      status: "$status",

      isHoliday:
        "$isHoliday",

      totalWorkHours:
        "$totalWorkHours",

      overtimeHours:
        "$overtimeHours",

      sessions:
        "$filteredSessions",
    };

    // PAGINATION
    if (shouldPaginate) {
      const pageNumber =
        Math.max(
          Number(page) || 1,
          1
        );

      const limitNumber =
        Math.max(
          Number(limit) || 10,
          1
        );

      const skip =
        (pageNumber - 1) *
        limitNumber;

      pipeline.push({
        $facet: {
          metadata: [
            {
              $count: "total",
            },
          ],

          data: [
            {
              $skip: skip,
            },

            {
              $limit: limitNumber,
            },

            {
              $project:
                projectStage,
            },
          ],
        },
      });

      const [result] =
        await attendanceModel.aggregate(
          pipeline
        );

      const total =
        result?.metadata?.[0]
          ?.total || 0;

      const data = (
        result?.data || []
      ).map((record, index) => ({
        serialNumber:
          skip + index + 1,

        ...record,
      }));

      return res.status(200).json({
        success: true,

        message:
          "Attendance fetched successfully",
        isLocked,

        page: pageNumber,

        limit: limitNumber,

        totalPages: Math.ceil(
          total / limitNumber
        ),

        totalRecords: total,

        filters: {
          date,

          siteId,

          name:
            name || null,

          employeeId:
            employeeId ||
            null,

          jobTitle:
            jobTitle || null,
        },

        data,
      });
    }

    // NON PAGINATED
    pipeline.push({
      $project: projectStage,
    });

    const result =
      await Attendance.aggregate(
        pipeline
      );

    const data = result.map(
      (record, index) => ({
        serialNumber:
          index + 1,

        ...record,
      })
    );

    return res.status(200).json({
      success: true,

      message:
        "Attendance fetched successfully",
      isLocked,

      totalRecords:
        data.length,

      filters: {
        date,

        siteId,

        name:
          name || null,

        employeeId:
          employeeId ||
          null,

        jobTitle:
          jobTitle || null,
      },

      data,
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
        message: "Attendance record not found",
      });
    }

    // Get singleton work schedule config
    const workConfig = await workModel.findOne({ type: "default" });

    if (!workConfig) {
      return res.status(404).json({
        message: "Work schedule configuration not found",
      });
    }

    // -----------------------------
    // Update sessions only
    // -----------------------------
    if (Array.isArray(sessions)) {
      const updatedSessions = sessions.map((session) => {
        let workedHours = 0;

        if (session.checkIn && session.checkOut) {
          const checkIn = new Date(session.checkIn);
          const checkOut = new Date(session.checkOut);

          workedHours =
            (checkOut.getTime() - checkIn.getTime()) /
            (1000 * 60 * 60);

          // Prevent negative values
          if (workedHours < 0) {
            workedHours = 0;
          }
        }

        return {
          _id: session._id,
          siteId: session.siteId,
          jobId: session.jobId || null,
          checkIn: session.checkIn || null,
          checkOut: session.checkOut || null,
          workedHours: Number(workedHours.toFixed(2)),
          markedBy: session.markedBy || attendance.markedBy,
        };
      });

      attendance.sessions = updatedSessions;

      // -----------------------------
      // Calculate total work hours
      // -----------------------------
      const totalHours = updatedSessions.reduce(
        (total, session) => total + session.workedHours,
        0
      );

      attendance.totalWorkHours = Number(
        totalHours.toFixed(2)
      );

      // -----------------------------
      // Calculate overtime
      // -----------------------------
      attendance.overtimeHours =
        totalHours > workConfig.overtimeThreshold
          ? Number(
              (
                totalHours -
                workConfig.overtimeThreshold
              ).toFixed(2)
            )
          : 0;

      // -----------------------------
      // Calculate attendance status
      // -----------------------------
      if (
        totalHours >= workConfig.fullDayHours
      ) {
        attendance.status = "fullday";
      } else if (
        totalHours >= workConfig.halfDayHours
      ) {
        attendance.status = "halfday";
      } else {
        attendance.status = "absent";
      }
    }

    await attendance.save();

    const updatedAttendance = await Attendance.findById(
      attendance._id
    )
      .populate("employee", "name employeeId")
      .populate("siteId", "siteName")
      .populate("jobId", "name")
      .populate("sessions.siteId", "siteName")
      .populate("sessions.jobId", "name");
    
    const formattedAttendance = {
      attendanceId: updatedAttendance._id,

      employee: updatedAttendance.employee?._id,

      name:updatedAttendance.employee ?.name || "",

      employeeId: updatedAttendance.employee?.employeeId || "",

      jobTitle: updatedAttendance.employee ?.jobTitle || "",

      siteId: updatedAttendance.siteId?._id,

      siteName: updatedAttendance.siteId ?.siteName || "",

      jobId: updatedAttendance.jobId?._id || null,

      jobName: updatedAttendance.jobId ?.name || "",

      date: updatedAttendance.date,

      status: updatedAttendance.status,

      isHoliday: updatedAttendance.isHoliday,

      totalWorkHours: updatedAttendance.totalWorkHours,

      overtimeHours: updatedAttendance.overtimeHours,

      sessions: updatedAttendance.sessions.map(
          (session) => ({
            _id: session._id,

            siteId: session.siteId?._id,

            siteName: session.siteId?.siteName || "",

            jobId: session.jobId?._id ||null,

            jobName: session.jobId?.name || "",

            checkIn: session.checkIn,

            checkOut: session.checkOut,

            workedHours: session.workedHours,

            markedBy: session.markedBy,
          })
        ),
    }

    return res.status(200).json({
      message: "Attendance updated successfully",
      attendance: formattedAttendance,
    });
  } catch (error) {
    console.error("Update attendance error:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};



// --- DEFAULT EXPORT ---

const attendanceController = {
    getMonthlyReport,
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
    getAttendanceRecords

};

export default attendanceController;
