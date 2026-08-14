import empModel from '../models/empModel.js'
import siteModel from '../models/siteModel.js'
import userModel from '../models/userModel.js'
import AttendanceLock from '../models/lockModel.js'
import jobModel from '../models/jobModel.js'
import attendanceModel from '../models/attendanceModel.js'
import mongoose from 'mongoose'
import { json } from 'express'
import { escapeRegExp } from '../utils/escapeRegExp.js'
import workModel from '../models/workModel.js'
import { propagateDefaultChanges } from '../utils/propagateDefaults.js'
import { getStaffEmployeeIds } from '../utils/collar.js'
import { combineFromOffset, getDateLocal } from '../utils/timeLocal.js'
import { hasSessionOverlap } from '../utils/sessionOverlap.js'


//Admin

export const getSites = async (req, res) => {
    try{
        const { siteName, isActive, date } = req.query
        let filter  = { isDeleted: { $ne: true } }
        if (siteName) {
            filter.siteName = { $regex: `^${escapeRegExp(siteName)}`, $options: "i" };
        }

        if (isActive === "true"){
           filter.isActive = true
        }

        const sites = await siteModel.find(filter,"_id siteName locationDetails jobs isActive isPermanent isCompleted defaultCheckIn defaultCheckOut nightDefaultCheckIn nightDefaultCheckOut").sort({isCompleted: 1, isActive: -1}).populate("jobs", "name")
        
        if (date) {
            const parsedDate = new Date(date)
            parsedDate.setUTCHours(0, 0, 0, 0)

            // Fetch all attendance records for this date
            const records = await attendanceModel.find({ date: parsedDate }).lean()

            // Fetch all locks for this date to determine initialization
            const locks = await AttendanceLock.find({ date: parsedDate }).lean()
            const lockedSiteIds = new Set(locks.map(l => l.siteId.toString()))

            const sitesWithStatus = sites.map(site => {
                const siteIdStr = site._id.toString()
                const isInitialized = lockedSiteIds.has(siteIdStr)

                let hasAtLeastOneComplete = false
                let hasIncomplete = false

                for (const record of records) {
                    if (record.sessions && record.sessions.length > 0) {
                        for (const session of record.sessions) {
                            if (session.siteId && session.siteId.toString() === siteIdStr) {
                                if (session.checkIn) {
                                    if (session.checkOut) {
                                        hasAtLeastOneComplete = true
                                    } else {
                                        hasIncomplete = true
                                    }
                                }
                            }
                        }
                    }
                }

                const taken = hasAtLeastOneComplete && !hasIncomplete
                
                let status = "pending"
                if (isInitialized) {
                    status = hasIncomplete ? "taken" : "completed"
                }

                const siteObj = site.toObject ? site.toObject() : site
                return {
                    ...siteObj,
                    taken,
                    status
                }
            })

            sitesWithStatus.sort((a, b) => {
                const aComp = a.isCompleted ? 1 : 0
                const bComp = b.isCompleted ? 1 : 0
                if (aComp !== bComp) return aComp - bComp
                const aAct = a.isActive ? 1 : 0
                const bAct = b.isActive ? 1 : 0
                return bAct - aAct
            })

            return res.status(200).json(sitesWithStatus)
        }

        res.status(200).json(sites)
    }catch(error){  
        res.status(500).json({message: "Internal server error"})
        console.log(error)
    }
}

export const getSite = async (req, res) => {
    try{
        const { id } = req.params
        const site = await siteModel.findOne({ _id: id, isDeleted: { $ne: true } }).populate("jobs", "name isActive isDeleted isCompleted")
        if (!site) {
            return res.status(404).json({message: "Site not found"})
        }
        res.status(200).json(site)
    }catch(error){
        res.status(500).json({message: "Internal server error"})
        console.log(error)
    }
}

//Req: siteName, locationDetails
//Res: status 201 created
export const createSite = async (req , res) => {
    try{
        const {siteName, locationDetails} = req.body
        const newSite = new siteModel({siteName, locationDetails})
        await newSite.save()
        res.status(201).json(newSite)
    }
    catch(error){
        console.log(error)
        if (error.code === 11000){
            return res.status(404).json({message: "Site name is supposed to be unique"})
        }
        res.status(500).json({message: "Internal server error"})
    }
}

//Req: Supervisors id, employee id, siteId
//Res: status 200 supervisor details
export const  assignSupervisor = async (req , res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { _id } = req.body
        const { siteId } = req.params
        const employee = await empModel.findById(_id).session(session)

        if (!employee){
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({message: "Employee Doesnt exist"})
        }

        const supervisor = await userModel.findOne({ _id: employee.user }).session(session)
        if (!supervisor) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({message: "Supervisor User Doesn't exist"})
        }

        supervisor.assignedSite = siteId
        
        employee.currentSite = siteId
        await supervisor.save({ session })
        await employee.save({ session })

        await session.commitTransaction();
        session.endSession();
        res.status(200).json(supervisor)
    }
    catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({message: "Internal server error"})
        console.log(error)
    }
}


//Req: takes in the object id of the employee who is a supervisor
//Res: status code 200
export const removeSupervisor = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try{
        const {_id} = req.body
        const employee = await empModel.findById(_id).session(session)
        if (!employee){
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({message: "Employee doent exist"})
        }
        if (employee.currentJob) {
            await jobModel.findByIdAndUpdate(employee.currentJob, {
                $pull: {
                    employees: employee._id,
                },
            }, { session });
        }
        employee.currentSite = null
        employee.currentJob = null
        const supervisor = await userModel.findOne({_id: employee.user}).session(session)
        if (!supervisor){
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({message: "Employee is not a supervisor"})
        }
        supervisor.assignedSite = null
        await supervisor.save({ session })
        await employee.save({ session })

        await session.commitTransaction();
        session.endSession();
        res.status(200).json(supervisor)
    }
    catch(error){
        await session.abortTransaction();
        session.endSession();
        console.log(error)
        res.status(500).json({message: "Internal server error"})
    }
}

//Req: Taking in the object id of the employee
export const assignEmployee = async (req , res) => {
    try{
        const {_id} = req.body
        const {siteId}  = req.params
        const employee = await empModel.findOne({_id})
        if (!employee){
            return res.status(400).json({message: "Employee doent exist"})
        }
        employee.currentSite = siteId
        const saved = await employee.save()
        res.status(200).json(saved)
    }
    catch(error){
        res.status(500).json({message: "Internal Server error"})
    }
}

export const removeEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { _id, deleteAttendance } = req.body;
    const { siteId } = req.params;

    const employee = await empModel.findById(_id).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee doesn't exist",
      });
    }

    if (employee.currentSite && employee.currentSite.toString() !== siteId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Employee is not currently assigned to this site",
      });
    }

    // Remove employee from current job employees array
    if (employee.currentJob) {
      await jobModel.findByIdAndUpdate(employee.currentJob, {
        $pull: {
          employees: employee._id,
        },
      }, { session });
    }

    const removedSiteId = employee.currentSite;

    // Clear employee assignments
    employee.currentSite = null;
    employee.currentJob = null;

    const saved = await employee.save({ session });

    // Handle today's attendance record & session cleanup (conditional)
    if (deleteAttendance && removedSiteId) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const attendanceRecord = await attendanceModel.findOne({
        employee: employee._id,
        date: today
      }).session(session);

      if (attendanceRecord) {
        attendanceRecord.sessions = attendanceRecord.sessions.filter(
          (s) => s.siteId.toString() !== removedSiteId.toString()
        );

        if (attendanceRecord.sessions.length === 0) {
          await attendanceModel.findByIdAndDelete(attendanceRecord._id, { session });
        } else {
          await attendanceRecord.save({ session });
        }
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json(saved);

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const checkPending = async (req, res) => {
    try {
        const { siteId } = req.params
        const { date } = req.body

        const parsedDate = new Date(date)
        parsedDate.setUTCHours(0, 0, 0, 0)

        const lock = await AttendanceLock.findOne({ siteId, date: parsedDate })
        let status = true
        if (!lock) {
            status = false
        }
        res.status(200).json({status, lock})
    } catch (error) {
        res.status(500).json({message: "Internal Server Error"})
    }
}

export const addJob = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { siteId } = req.params;
    const { name, jobCode } = req.body;

    // Create job
    const newJobs = await jobModel.create([{
      name,
      jobCode,
      site: siteId,
    }], { session });
    const newJob = newJobs[0];

    // Push job id into site's jobs array
    await siteModel.findByIdAndUpdate(siteId, {
      $push: {
        jobs: newJob._id,
      },
    }, { session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: "New Job Created",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Conflict: Job Code already exists in the system.",
      });
    }

    console.log(error);

    res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getSiteJobs = async (req,res) => {
  try {
    const { siteId } = req.params;

    const site =
      await siteModel.findOne({
        _id: siteId,
        isDeleted: { $ne: true }
      });

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    const jobs =
      await jobModel
        .find({
          site: siteId,
          isDeleted: { $ne: true }
        })
        .lean();

    // Staff (white-collar) are excluded from per-job man-hours / man-days stats.
    const staffIds = await getStaffEmployeeIds();

    const attendanceRecords =
      await attendanceModel.find({
        "sessions.siteId": siteId,
        employee: { $nin: staffIds },
      });

    const jobStatsMap = {};

    for (const record of attendanceRecords) {
      const day = new Date(
        record.date
      )
        .toISOString()
        .split("T")[0];

      // Tracks which jobs this employee
      // contributed to on this day
      const jobsWorkedToday =
        new Set();

      for (const session of record.sessions) {
        if (
          session.siteId?.toString() !==
          siteId
        ) {
          continue;
        }

        if (!session.jobId) {
          continue;
        }

        const jobKey =
          session.jobId.toString();

        if (!jobStatsMap[jobKey]) {
          jobStatsMap[jobKey] = {
            totalManHours: 0,
            totalManDays: 0,
            calendarDays:
              new Set(),
          };
        }

        jobStatsMap[
          jobKey
        ].totalManHours +=
          session.workedHours || 0;

        jobStatsMap[
          jobKey
        ].calendarDays.add(day);

        jobsWorkedToday.add(jobKey);
      }

      // +1 man-day for each job
      // the employee contributed to
      // on this attendance record
      for (const jobKey of jobsWorkedToday) {
        jobStatsMap[
          jobKey
        ].totalManDays += 1;
      }
    }

    const employeeCounts =
      await empModel.aggregate([
        {
          $match: {
            currentSite:
              new mongoose.Types.ObjectId(
                siteId
              ),

            currentJob: {
              $ne: null,
            },

            isActive: true,
          },
        },

        {
          $group: {
            _id: "$currentJob",

            employeeCount: {
              $sum: 1,
            },
          },
        },
      ]);

    const employeeCountMap =
      {};

    employeeCounts.forEach(
      (item) => {
        employeeCountMap[
          item._id.toString()
        ] = item.employeeCount;
      }
    );

    const enrichedJobs = jobs.map(
      (job) => {
        const stats =
          jobStatsMap[
            job._id.toString()
          ];

        return {
          ...job,

          employeeCount:
            employeeCountMap[
              job._id.toString()
            ] || 0,

          totalManHours: Number(
            (
              stats
                ?.totalManHours || 0
            ).toFixed(2)
          ),

          totalManDays:
            stats
              ?.totalManDays || 0,

          totalCalendarDays:
            stats?.calendarDays
              ?.size || 0,
        };
      }
    );

    return res
      .status(200)
      .json(enrichedJobs);

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message:
        "Internal Server Error",
    });
  }
};


export const addEmployeeToJob = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { jobId } = req.params;
    const { empId } = req.body;

    // Check employee exists
    const employee = await empModel.findById(empId).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee was not found",
      });
    }

    // Check job exists
    const job = await jobModel.findById(jobId).session(session);

    if (!job) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Job was not found",
      });
    }

    // Ensure employee belongs to same site as the job
    if (
      !employee.currentSite ||
      employee.currentSite.toString() !== job.site.toString()
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Employee is not associated with this site's job",
      });
    }

    // Assign employee to job
    employee.currentJob = jobId;

    // Prevent duplicates
    if (!job.employees.includes(empId)) {
      job.employees.push(empId);
    }

    await employee.save({ session });
    await job.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: "Employee added to job successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const removeEmployeeFromJob = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { jobId } = req.params;
    const { empId } = req.body;

    // Check employee exists
    const employee = await empModel.findById(empId).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    // Check job exists
    const job = await jobModel.findById(jobId).session(session);

    if (!job) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Job not found",
      });
    }

    // Ensure employee actually belongs to this job
    if (
      !employee.currentJob ||
      employee.currentJob.toString() !== jobId
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Employee is not assigned to this job",
      });
    }

    // Remove employee from job employees array
    job.employees.pull(empId);

    // Clear employee currentJob
    employee.currentJob = null;

    await employee.save({ session });
    await job.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Employee removed from job successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const jobManHoursAndDays = async (req,res) => {
  try {
    const { jobId } = req.params;

    // Staff (white-collar) are excluded from man-hours / man-days stats.
    const staffIds = await getStaffEmployeeIds();

    const records =
      await attendanceModel.find({
        "sessions.jobId": jobId,
        employee: { $nin: staffIds },
      });

    if (!records.length) {
      return res.status(404).json({
        success: false,
        message:
          "No attendance records found for this job",
      });
    }

    let totalManHours = 0;

    let totalManDays = 0;

    const calendarDays =
      new Set();

    for (const record of records) {
      let contributedToJob =
        false;

      for (const session of record.sessions) {
        if (
          session.jobId?.toString() ===
          jobId
        ) {
          totalManHours +=
            session.workedHours || 0;

          contributedToJob =
            true;
        }
      }

      if (contributedToJob) {
        const day = new Date(
          record.date
        )
          .toISOString()
          .split("T")[0];

        calendarDays.add(day);

        totalManDays += 1;
      }
    }

    return res.status(200).json({
      success: true,

      jobId,

      totalManHours:
        Number(
          totalManHours.toFixed(2)
        ),

      totalManDays,

      totalCalendarDays:
        calendarDays.size,
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

export const siteManHoursAndDays = async (req,res) => {
  try {
    const { siteId } = req.params;

    // Staff (white-collar) are excluded from man-hours / man-days stats.
    const staffIds = await getStaffEmployeeIds();

    const records =
      await attendanceModel.find({
        "sessions.siteId": siteId,
        employee: { $nin: staffIds },
      });

    if (!records.length) {
      return res.status(404).json({
        success: false,
        message:
          "No attendance records found for this site",
      });
    }

    let totalManHours = 0;

    let totalManDays = 0;

    const calendarDays =
      new Set();

    for (const record of records) {
      const day = new Date(
        record.date
      )
        .toISOString()
        .split("T")[0];

      let workedOnSite =
        false;

      for (const session of record.sessions) {
        if (
          session.siteId?.toString() !==
          siteId
        ) {
          continue;
        }

        totalManHours +=
          session.workedHours || 0;

        workedOnSite = true;
      }

      if (workedOnSite) {
        totalManDays += 1;

        calendarDays.add(day);
      }
    }

    return res.status(200).json({
      success: true,

      siteId,

      totalManHours: Number(
        totalManHours.toFixed(2)
      ),

      totalManDays,

      totalCalendarDays:
        calendarDays.size,
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

export const deactivateSite = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { siteId } = req.params;

    // Find site
    const site = await siteModel.findById(siteId).session(session);

    if (!site) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Site not found",
      });
    }

    if (site.isPermanent) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Cannot deactivate a permanent site",
      });
    }

    // Get all jobs associated with this site
    const jobs = await jobModel.find({ site: siteId }).session(session);

    const jobIds = jobs.map((job) => job._id);

    
    // REMOVE EMPLOYEES FROM SITE
   

    await empModel.updateMany(
      { currentSite: siteId },
      {
        $set: {
          currentSite: null,
          currentJob: null,
        },
      },
      { session }
    );

    
    // CLEAR JOB EMPLOYEE ARRAYS
   

    await jobModel.updateMany(
      { site: siteId },
      {
        $set: {
          employees: [],
          isActive: false,
        },
      },
      { session }
    );

    
    // DEACTIVATE SITE
   

    site.isActive = false;

    await site.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Site deactivated successfully",
      deactivatedJobs: jobIds.length,
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const reactivateSite = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { siteId } = req.params;

    // Find site
    const site = await siteModel.findById(siteId).session(session);

    if (!site) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Site not found",
      });
    }

    if (site.isPermanent) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Cannot reactivate a permanent site",
      });
    }

    // Reactivate all jobs under this site
    const result = await jobModel.updateMany(
      { site: siteId },
      {
        $set: {
          isActive: true,
        },
      },
      { session }
    );

    // Reactivate site
    site.isActive = true;

    await site.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Site reactivated successfully",
      reactivatedJobs: result.modifiedCount,
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getUnassignedSiteEmployees = async (req, res) => {
  try {
    const { siteId } = req.params;

    const {
      page = 1,
      limit = 10,
      name,
      employeeId,
      jobTitle,
    } = req.query;

    const pageNumber = Math.max(Number(page) || 1, 1);

    const limitNumber = Math.min(
      Math.max(Number(limit) || 10, 1),
      50
    );

    // Base filter
    const filter = {
      currentSite: siteId,
      currentJob: null,
      isActive: true,
    };

    // Optional filters
    if (name) {
      filter.name = {
        $regex: escapeRegExp(name),
        $options: "i",
      };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: escapeRegExp(employeeId),
        $options: "i",
      };
    }

    if (jobTitle) {
      filter.jobTitle = {
        $regex: escapeRegExp(jobTitle),
        $options: "i",
      };
    }

    // Total count
    const totalEmployees =
      await empModel.countDocuments(filter);

    // Paginated employees
    const employees = await empModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber);

    return res.status(200).json({
      employees,
      currentPage: pageNumber,
      totalPages: Math.ceil(
        totalEmployees / limitNumber
      ),
      totalEmployees,
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getJobEmployees = async (req, res) => {
  try {
    const { jobId } = req.params;

    const employees = await empModel
      .find({
        currentJob: jobId,
        isActive: true,
      })
      .sort({ name: 1 });

    return res.status(200).json(employees);

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getJob = async (req, res) => {
  try{
    const {jobId} = req.params
    const job = await jobModel.findOne({ _id: jobId, isDeleted: { $ne: true } })

    if (!job){
      return res.status(404).json({message: "The Job was not found"})
    }

    res.status(200).json(job)

  }catch(error){
    console.log(error)
    return res.status(500).json({message: "Internal Server Error"});
  }
}

export const changeJobStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { jobId } = req.params;

    const job = await jobModel.findById(jobId).session(session);

    if (!job) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Job not found",
      });
    }

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id).session(session);
      if (!user || !user.assignedSite || user.assignedSite.toString() !== job.site.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "Forbidden: Job is not on your assigned site" });
      }
    }

    // If currently active -> deactivate
    if (job.isActive) {

      // Remove employees from job
      await empModel.updateMany(
        {
          currentJob: jobId,
        },
        {
          $set: {
            currentJob: null,
          },
        },
        { session }
      );

      // Optional cleanup
      job.employees = [];

      job.isActive = false;

      await job.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message:
          "Job deactivated successfully",
      });
    }

    // If currently inactive -> reactivate
    job.isActive = true;

    await job.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message:
        "Job re-activated successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const instaAddEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { siteId } = req.params
    const { empId, currentJob, checkInTime, deferred = false } = req.body

    const markedBy = req.user?.id

    if (!siteId || !empId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "siteId and empId are required",
      })
    }

    const employee = await empModel.findById(empId).session(session)

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      })
    }

    const site = await siteModel.findById(siteId).session(session)

    if (!site) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Site not found",
      })
    }

    // Prevent adding employee to same site
    if (
      employee.currentSite &&
      employee.currentSite.toString() === siteId.toString()
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Employee is already assigned to this site",
      })
    }

    // ----------------------------------
    // DEFERRED (from-tomorrow) ADD via SiteDetail
    // ----------------------------------
    // Admin-context add: don't touch currentSite/currentJob or today's attendance
    // (no check-in needed). Stash the target site/job with tomorrow's local
    // midnight; the applyScheduledAssignments cron promotes it at day rollover.
    if (deferred) {
      if (site.isDeleted || !site.isActive || site.isCompleted) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({
          success: false,
          message: "Site is not a valid destination for a scheduled add",
        })
      }

      employee.scheduledSiteId = siteId
      employee.scheduledJobId = currentJob || null
      employee.scheduledEffectiveDate = combineFromOffset(getDateLocal(1), "00:00", false)

      await employee.save({ session })

      await session.commitTransaction()
      session.endSession()

      return res.status(200).json({
        success: true,
        message: "Employee scheduled — starts tomorrow",
      })
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    // ----------------------------------
    // VALIDATE & CONVERT CHECK-IN TIME
    // ----------------------------------

    if (!checkInTime) {
      await session.abortTransaction()
      session.endSession()
      return res.status(400).json({
        success: false,
        message: "Check-in time is required",
      })
    }

    if (!/^\d{2}:\d{2}$/.test(checkInTime)) {
      await session.abortTransaction()
      session.endSession()
      return res.status(400).json({
        success: false,
        message: "Invalid check-in time format. Expected HH:mm",
      })
    }

    const todayStr = today.toISOString().split("T")[0]
    // Cutoff-free: a check-in time belongs to the record's own business day (offset 0).
    const checkInDate = combineFromOffset(todayStr, checkInTime, false)

    // ----------------------------------
    // OVERLAP CHECK & AUTO-CLOSE
    // ----------------------------------

    const attendance = await attendanceModel.findOne({
      employee: empId,
      date: today,
    }).session(session)

    if (attendance) {
      const alreadyHasSession = attendance.sessions.some(
        (s) => s.siteId.toString() === siteId.toString()
      )

      if (!alreadyHasSession) {
        const candidateSessions = [
          ...attendance.sessions.map(s => ({
            checkIn: s.checkIn,
            checkOut: s.checkOut,
            siteId: s.siteId,
          })),
          { checkIn: checkInDate, checkOut: null },
        ]

        if (hasSessionOverlap(candidateSessions)) {
          const newStart = checkInDate.getTime()
          let conflicting = null
          for (const s of attendance.sessions) {
            if (!s.checkIn) continue
            const sStart = new Date(s.checkIn).getTime()
            const sEnd = s.checkOut ? new Date(s.checkOut).getTime() : sStart
            if (newStart >= sStart && newStart < sEnd) {
              conflicting = s
              break
            }
            if (!s.checkOut && sStart === newStart) {
              conflicting = s
              break
            }
          }

          let conflictingSiteName = "Unknown Site"
          if (conflicting) {
            const cSite = await siteModel.findById(conflicting.siteId).select("siteName").session(session)
            if (cSite) conflictingSiteName = cSite.siteName
          }

          await session.abortTransaction()
          session.endSession()
          return res.status(400).json({
            success: false,
            message: "Check-in time overlaps with an existing session",
            overlap: {
              employeeId: empId,
              conflictingSession: {
                siteId: conflicting?.siteId,
                siteName: conflictingSiteName,
                checkIn: conflicting?.checkIn,
                checkOut: conflicting?.checkOut,
              },
            },
          })
        }

        // Auto-close most recent open session from a different site
        const openSession = [...attendance.sessions]
          .filter(s => s.checkIn && !s.checkOut && s.siteId.toString() !== siteId.toString())
          .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())[0]

        if (openSession) {
          openSession.checkOut = checkInDate
          openSession.workedHours = (checkInDate.getTime() - new Date(openSession.checkIn).getTime()) / 3600000
        }

        await attendance.save({ session })
      }
    }

    // ----------------------------------
    // CHECK LOCK STATUS
    // ----------------------------------

    const attendanceLock = await AttendanceLock.findOne({
      siteId,
      date: today,
      isLocked: true,
    }).session(session)

    const oldJobId = employee.currentJob

    if (attendanceLock) {
      // ----------------------------------
      // SITE ATTENDANCE ALREADY SUBMITTED
      // ----------------------------------

      if (attendance) {
        const alreadyHasSession = attendance.sessions.some(
          (s) => s.siteId.toString() === siteId.toString()
        )

        if (!alreadyHasSession) {
          attendance.sessions.push({
            siteId,
            jobId: currentJob,
            checkIn: checkInDate,
            checkOut: null,
            workedHours: 0,
            markedBy,
          })

          await attendance.save({ session })
        }
      } else {
        await attendanceModel.create([{
          employee: empId,
          siteId,
          jobId: currentJob,
          markedBy,
          date: today,
          status: "absent",
          isHoliday: false,
          totalWorkHours: 0,
          overtimeHours: 0,
          sessions: [
            {
              siteId,
              jobId: currentJob,
              checkIn: checkInDate,
              checkOut: null,
              workedHours: 0,
              markedBy,
            },
          ],
        }], { session })
      }
    }

    // ----------------------------------
    // SET PENDING TRANSFER FIELDS
    // ----------------------------------

    employee.pendingTransferCheckIn = checkInDate
    employee.pendingTransferSiteId = siteId
    employee.pendingTransferDate = today

    // ----------------------------------
    // UPDATE EMPLOYEE ASSIGNMENT
    // ----------------------------------

    employee.currentSite = siteId
    employee.currentJob = currentJob

    await employee.save({ session })

    if (oldJobId) {
      await jobModel.findByIdAndUpdate(
        oldJobId,
        {
          $pull: {
            employees: employee._id,
          },
        },
        { session }
      )
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Employee added successfully",
    })
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error)

    return res.status(500).json({
      success: false,
      message: "Failed to add employee",
      error: error.message,
    })
  }
}

export const getAvailableEmployeesForSite = async (
  req,
  res
) => {
  try {
    const { siteId } = req.params

    const {
      page = 1,
      name = "",
      employeeId = "",
      jobTitle = "",
      currentSite = "",
    } = req.query

    const limit = 20

    const skip =
      (Number(page) - 1) * limit

    if (!siteId) {
      return res.status(400).json({
        success: false,
        message: "siteId is required",
      })
    }

    const query = {
      isActive: true,

      $and: [
        {
          $or: [
            {
              currentSite: {
                $ne: siteId,
              },
            },
            {
              currentSite: null,
            },
          ],
        },
        {
          $or: [
            { user: null },
            { user: { $exists: false } },
            { currentSite: null },
          ],
        },
      ],
    }

    // -----------------------
    // SEARCH FILTERS
    // -----------------------

    if (name.trim()) {
      query.$and.push({
        name: {
          $regex: escapeRegExp(name.trim()),
          $options: "i",
        },
      })
    }

    if (employeeId.trim()) {
      query.$and.push({
        employeeId: {
          $regex: escapeRegExp(employeeId.trim()),
          $options: "i",
        },
      })
    }

    if (jobTitle.trim()) {
      query.$and.push({
        jobTitle: {
          $regex: escapeRegExp(jobTitle.trim()),
          $options: "i",
        },
      })
    }

    // -----------------------
    // CURRENT SITE FILTER
    // -----------------------

    if (currentSite) {
      if (currentSite === "unassigned") {
        query.$and.push({
          currentSite: null,
        })
      } else {
        query.$and.push({
          currentSite,
        })
      }
    }

    const employees =
      await empModel
        .find(query)
        .populate(
          "currentSite",
          "siteName"
        )
        .populate(
          "currentJob",
          "name"
        )

    const sortedEmployees =
      employees.sort((a, b) => {
        const aSupervisor =
          a.user ? 1 : 0

        const bSupervisor =
          b.user ? 1 : 0

        // supervisors first
        if (
          aSupervisor !==
          bSupervisor
        ) {
          return (
            bSupervisor -
            aSupervisor
          )
        }

        // then alphabetical
        return a.name.localeCompare(
          b.name
        )
      })

    const total =
      sortedEmployees.length

    const paginatedEmployees =
      sortedEmployees.slice(
        skip,
        skip + limit
      )

    return res.status(200).json({
      success: true,

      page: Number(page),

      limit,

      total,

      totalPages: Math.ceil(
        total / limit
      ),

      filters: {
        name,
        employeeId,
        jobTitle,
        currentSite,
      },

      employees: paginatedEmployees,
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch employees",
      error: error.message,
    })
  }
}

//A funtion to make the currentSite null after we deactivate a site when its complete.
//It should iterate thru the list of employees and set the current site to null as well as check if the supervisor is true then also set the assignedSite 
//to null

export const deleteSite = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { siteId } = req.params;

    // Find site
    const site = await siteModel.findById(siteId).session(session);
    if (!site) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // Set site as soft-deleted
    site.isDeleted = true;
    site.isActive = false;
    await site.save({ session });

    // Disassociate all employees associated with this site
    await empModel.updateMany(
      { currentSite: siteId },
      {
        $set: {
          currentSite: null,
          currentJob: null,
        },
      },
      { session }
    );

    // Disassociate supervisors (set assignedSite to null in User model)
    await userModel.updateMany(
      { assignedSite: siteId },
      {
        $set: {
          assignedSite: null,
        },
      },
      { session }
    );

    // Soft-delete all jobs belonging to the site
    await jobModel.updateMany(
      { site: siteId },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          employees: [],
        },
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Site and its associated jobs soft-deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const deleteJob = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { jobId } = req.params;

    // Find job
    const job = await jobModel.findById(jobId).session(session);
    if (!job) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Job not found",
      });
    }

    // Soft-delete job
    job.isDeleted = true;
    job.isActive = false;
    job.employees = [];
    await job.save({ session });

    // Disassociate all employees assigned to this job
    await empModel.updateMany(
      { currentJob: jobId },
      {
        $set: {
          currentJob: null,
        },
      },
      { session }
    );

    // Remove job from the site's jobs array
    if (job.site) {
      await siteModel.findByIdAndUpdate(job.site, {
        $pull: {
          jobs: jobId,
        },
      }, { session });
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Job soft-deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const updateSite = async (req, res) => {
  try {
    const { siteId } = req.params;
    const {
      locationDetails,
      isCompleted,
      defaultCheckIn,
      defaultCheckOut,
      nightDefaultCheckIn,
      nightDefaultCheckOut,
      staffDefaultCheckIn,
      staffDefaultCheckOut,
      staffNightDefaultCheckIn,
      staffNightDefaultCheckOut,
      omaniDefaultCheckIn,
      omaniDefaultCheckOut,
      omaniNightDefaultCheckIn,
      omaniNightDefaultCheckOut,
      omaniStaffDefaultCheckIn,
      omaniStaffDefaultCheckOut,
      omaniStaffNightDefaultCheckIn,
      omaniStaffNightDefaultCheckOut,
      updateTodayRecords,
    } = req.body;

    const site = await siteModel.findById(siteId);
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }

    // Supervisor site-access check: supervisors can only update their assigned site
    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      if (!user || !user.assignedSite || user.assignedSite.toString() !== siteId.toString()) {
        return res.status(403).json({ message: "Forbidden: Access denied to this site" });
      }
    }

    const workConfig = await workModel.findOne();

    const toMinutes = (t) => {
      if (!t) return null;
      const [h, m] = t.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    // --- NIGHT SHIFT SANITY VALIDATION ---
    // Absolute constraints only: a night DEFAULT check-in must be in the PM half and a
    // night DEFAULT check-out in the AM half. These bound the site's default times; actual
    // sessions are free-form and validated by ordering + duration (utils/timeLocal.js).
    const eff = (incoming, stored) => (incoming !== undefined ? incoming : stored);
    const effectiveTimes = {
      nightDefaultCheckIn: eff(nightDefaultCheckIn, site.nightDefaultCheckIn),
      nightDefaultCheckOut: eff(nightDefaultCheckOut, site.nightDefaultCheckOut),
      staffNightDefaultCheckIn: eff(staffNightDefaultCheckIn, site.staffNightDefaultCheckIn),
      staffNightDefaultCheckOut: eff(staffNightDefaultCheckOut, site.staffNightDefaultCheckOut),
      omaniNightDefaultCheckIn: eff(omaniNightDefaultCheckIn, site.omaniNightDefaultCheckIn),
      omaniNightDefaultCheckOut: eff(omaniNightDefaultCheckOut, site.omaniNightDefaultCheckOut),
      omaniStaffNightDefaultCheckIn: eff(omaniStaffNightDefaultCheckIn, site.omaniStaffNightDefaultCheckIn),
      omaniStaffNightDefaultCheckOut: eff(omaniStaffNightDefaultCheckOut, site.omaniStaffNightDefaultCheckOut),
    };

    const NOON = 12 * 60;
    for (const [field, label] of [
      ["nightDefaultCheckIn", "Night shift check-in"],
      ["staffNightDefaultCheckIn", "Staff night check-in"],
      ["omaniNightDefaultCheckIn", "Omani night check-in"],
      ["omaniStaffNightDefaultCheckIn", "Omani staff night check-in"],
    ]) {
      const min = toMinutes(effectiveTimes[field]);
      if (effectiveTimes[field] && min === null) {
        return res.status(400).json({ message: `Invalid ${label.toLowerCase()} time` });
      }
      if (min !== null && min < NOON) {
        return res.status(400).json({ message: `${label} must be 12:00 (noon) or later` });
      }
    }
    for (const [field, label] of [
      ["nightDefaultCheckOut", "Night shift check-out"],
      ["staffNightDefaultCheckOut", "Staff night check-out"],
      ["omaniNightDefaultCheckOut", "Omani night check-out"],
      ["omaniStaffNightDefaultCheckOut", "Omani staff night check-out"],
    ]) {
      const min = toMinutes(effectiveTimes[field]);
      if (effectiveTimes[field] && min === null) {
        return res.status(400).json({ message: `Invalid ${label.toLowerCase()} time` });
      }
      if (min !== null && min > NOON) {
        return res.status(400).json({ message: `${label} must be at or before 12:00 (noon)` });
      }
    }

    // NOTE: there is no business-day "cutoff" any more — a site's day and night default
    // windows may overlap freely (a 06:00 day start alongside an 08:00 night end), because
    // cross-midnight is recorded per session as an explicit day offset rather than inferred
    // from a global hour. Only the absolute per-shift sanity rules below still apply.

    // --- DAY SHIFT VALIDATION (all four categories) ---
    // Day shifts are same-day: check-out after check-in, before midnight.
    for (const [inField, outField, label] of [
      ["defaultCheckIn", "defaultCheckOut", "Day shift"],
      ["staffDefaultCheckIn", "staffDefaultCheckOut", "Staff"],
      ["omaniDefaultCheckIn", "omaniDefaultCheckOut", "Omani day shift"],
      ["omaniStaffDefaultCheckIn", "omaniStaffDefaultCheckOut", "Omani staff"],
    ]) {
      const inVal = eff(req.body[inField], site[inField]);
      const outVal = eff(req.body[outField], site[outField]);
      if (inVal && outVal) {
        const inMin = toMinutes(inVal);
        const outMin = toMinutes(outVal);
        if (inMin === null || outMin === null) {
          return res.status(400).json({ message: `Invalid ${label.toLowerCase()} times` });
        }
        if (outMin <= inMin) {
          return res.status(400).json({
            message: `${label} check-out must be after check-in (before midnight)`,
          });
        }
      }
    }

    // Capture previous default values BEFORE updating
    const prevDefaults = {
      defaultCheckIn: site.defaultCheckIn || '',
      defaultCheckOut: site.defaultCheckOut || '',
      nightDefaultCheckIn: site.nightDefaultCheckIn || '',
      nightDefaultCheckOut: site.nightDefaultCheckOut || '',
      staffDefaultCheckIn: site.staffDefaultCheckIn || '',
      staffDefaultCheckOut: site.staffDefaultCheckOut || '',
      staffNightDefaultCheckIn: site.staffNightDefaultCheckIn || '',
      staffNightDefaultCheckOut: site.staffNightDefaultCheckOut || '',
    };

    if (locationDetails !== undefined) site.locationDetails = locationDetails;
    if (isCompleted !== undefined) site.isCompleted = isCompleted;
    if (defaultCheckIn !== undefined) site.defaultCheckIn = defaultCheckIn;
    if (defaultCheckOut !== undefined) site.defaultCheckOut = defaultCheckOut;
    if (nightDefaultCheckIn !== undefined) site.nightDefaultCheckIn = nightDefaultCheckIn;
    if (nightDefaultCheckOut !== undefined) site.nightDefaultCheckOut = nightDefaultCheckOut;
    if (staffDefaultCheckIn !== undefined) site.staffDefaultCheckIn = staffDefaultCheckIn;
    if (staffDefaultCheckOut !== undefined) site.staffDefaultCheckOut = staffDefaultCheckOut;
    if (staffNightDefaultCheckIn !== undefined) site.staffNightDefaultCheckIn = staffNightDefaultCheckIn;
    if (staffNightDefaultCheckOut !== undefined) site.staffNightDefaultCheckOut = staffNightDefaultCheckOut;
    if (omaniDefaultCheckIn !== undefined) site.omaniDefaultCheckIn = omaniDefaultCheckIn;
    if (omaniDefaultCheckOut !== undefined) site.omaniDefaultCheckOut = omaniDefaultCheckOut;
    if (omaniNightDefaultCheckIn !== undefined) site.omaniNightDefaultCheckIn = omaniNightDefaultCheckIn;
    if (omaniNightDefaultCheckOut !== undefined) site.omaniNightDefaultCheckOut = omaniNightDefaultCheckOut;
    if (omaniStaffDefaultCheckIn !== undefined) site.omaniStaffDefaultCheckIn = omaniStaffDefaultCheckIn;
    if (omaniStaffDefaultCheckOut !== undefined) site.omaniStaffDefaultCheckOut = omaniStaffDefaultCheckOut;
    if (omaniStaffNightDefaultCheckIn !== undefined) site.omaniStaffNightDefaultCheckIn = omaniStaffNightDefaultCheckIn;
    if (omaniStaffNightDefaultCheckOut !== undefined) site.omaniStaffNightDefaultCheckOut = omaniStaffNightDefaultCheckOut;

    await site.save();

    // Propagate changes to today's attendance records if requested
    if (updateTodayRecords) {
      const newDefaults = {
        defaultCheckIn: defaultCheckIn !== undefined ? defaultCheckIn : prevDefaults.defaultCheckIn,
        defaultCheckOut: defaultCheckOut !== undefined ? defaultCheckOut : prevDefaults.defaultCheckOut,
        nightDefaultCheckIn: nightDefaultCheckIn !== undefined ? nightDefaultCheckIn : prevDefaults.nightDefaultCheckIn,
        nightDefaultCheckOut: nightDefaultCheckOut !== undefined ? nightDefaultCheckOut : prevDefaults.nightDefaultCheckOut,
        staffDefaultCheckIn: staffDefaultCheckIn !== undefined ? staffDefaultCheckIn : prevDefaults.staffDefaultCheckIn,
        staffDefaultCheckOut: staffDefaultCheckOut !== undefined ? staffDefaultCheckOut : prevDefaults.staffDefaultCheckOut,
        staffNightDefaultCheckIn: staffNightDefaultCheckIn !== undefined ? staffNightDefaultCheckIn : prevDefaults.staffNightDefaultCheckIn,
        staffNightDefaultCheckOut: staffNightDefaultCheckOut !== undefined ? staffNightDefaultCheckOut : prevDefaults.staffNightDefaultCheckOut,
      };

      try {
        const propagation = await propagateDefaultChanges(
          site,
          prevDefaults,
          newDefaults,
          workConfig
        );

        return res.status(200).json({
          ...site.toObject(),
          propagation,
        });
      } catch (propagationError) {
        console.error('Error propagating default changes:', propagationError);
        // Site was already saved successfully, return it with a propagation error note
        return res.status(200).json({
          ...site.toObject(),
          propagation: {
            updated: 0,
            skipped: [],
            error: 'Failed to propagate changes to attendance records',
          },
        });
      }
    }

    return res.status(200).json({ ...site.toObject() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const toggleJobCompleted = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await jobModel.findById(jobId);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id);
      if (!user || !user.assignedSite || user.assignedSite.toString() !== job.site.toString()) {
        return res.status(403).json({ message: "Forbidden: Job is not on your assigned site" });
      }
    }

    job.isCompleted = !job.isCompleted;
    await job.save();
    return res.status(200).json(job);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const updateEmployeeJob = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { siteId, employeeId } = req.params;
    const { jobId, deferred = false } = req.body;

    const employee = await empModel.findById(employeeId).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    if (!employee.currentSite || employee.currentSite.toString() !== siteId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Employee is not assigned to this site",
      });
    }

    const oldJobId = employee.currentJob;

    // If new jobId is specified, check that the job exists and belongs to the site
    if (jobId) {
      const job = await jobModel.findById(jobId).session(session);
      if (!job) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          message: "Job not found",
        });
      }
      if (job.site.toString() !== siteId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: "Job does not belong to this site",
        });
      }
    }

    // Deferred (from-tomorrow) job change via SiteDetail: stash the target job with
    // tomorrow's local midnight and leave currentJob/job arrays untouched today. A
    // null scheduledSiteId marks this as a job-only change for the cron to apply.
    if (deferred) {
      employee.scheduledSiteId = null;
      employee.scheduledJobId = jobId || null;
      employee.scheduledEffectiveDate = combineFromOffset(getDateLocal(1), "00:00", false);
      await employee.save({ session });
      await session.commitTransaction();
      session.endSession();
      await employee.populate("currentJob", "name");
      await employee.populate("scheduledJobId", "name");
      return res.status(200).json(employee);
    }

    // If job hasn't changed, just return
    if (oldJobId && jobId && oldJobId.toString() === jobId.toString()) {
      await session.commitTransaction();
      session.endSession();
      await employee.populate("currentJob", "name");
      return res.status(200).json(employee);
    }

    // Pull from old job list
    if (oldJobId) {
      await jobModel.findByIdAndUpdate(
        oldJobId,
        { $pull: { employees: employee._id } },
        { session }
      );
    }

    // Set new job
    employee.currentJob = jobId || null;
    await employee.save({ session });

    // Push to new job list (prevent duplicates)
    if (jobId) {
      await jobModel.findByIdAndUpdate(
        jobId,
        { $addToSet: { employees: employee._id } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await employee.populate("currentJob", "name");
    return res.status(200).json(employee);

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Clear a deferred (from-tomorrow) assignment before the cron applies it. Used by
// the SiteDetail Manage Employees "Cancel" action on a pending row.
export const cancelScheduledAssignment = async (req, res) => {
  try {
    const { siteId, employeeId } = req.params;

    const employee = await empModel.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    // The pending change must belong to THIS site: either a scheduled add/move
    // targeting it (scheduledSiteId), or a job-only change for an employee
    // currently on it (scheduledSiteId null, currentSite === siteId).
    const belongsToSite =
      (employee.scheduledSiteId && employee.scheduledSiteId.toString() === siteId) ||
      (!employee.scheduledSiteId &&
        employee.currentSite &&
        employee.currentSite.toString() === siteId);

    if (!employee.scheduledEffectiveDate || !belongsToSite) {
      return res.status(400).json({
        success: false,
        message: "No scheduled change for this site",
      });
    }

    employee.scheduledSiteId = null;
    employee.scheduledJobId = null;
    employee.scheduledEffectiveDate = null;
    await employee.save();

    return res.status(200).json({
      success: true,
      message: "Scheduled change cancelled",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel scheduled change",
    });
  }
};

const siteController = {
    getSites,
    getSite,
    createSite,
    deleteSite,
    deleteJob,
    assignEmployee,
    assignSupervisor,
    removeSupervisor,
    removeEmployee,
    checkPending,
    addJob,
    addEmployeeToJob,
    jobManHoursAndDays,
    siteManHoursAndDays,
    deactivateSite,
    getSiteJobs,
    removeEmployeeFromJob,
    reactivateSite,
    getUnassignedSiteEmployees,
    getJobEmployees,
    getJob,
    changeJobStatus,
    instaAddEmployee,
    getAvailableEmployeesForSite,
    updateSite,
    toggleJobCompleted,
    updateEmployeeJob,
    cancelScheduledAssignment
}

export default siteController;

