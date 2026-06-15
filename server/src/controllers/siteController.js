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

        const sites = await siteModel.find(filter,"_id siteName locationDetails jobs isActive isPermanent isCompleted defaultCheckIn defaultCheckOut").sort({isCompleted: 1, isActive: -1}).populate("jobs", "name")
        
        if (date) {
            const parsedDate = new Date(date)
            parsedDate.setUTCHours(0, 0, 0, 0)

            // Fetch all attendance records for this date
            const records = await attendanceModel.find({ date: parsedDate }).lean()

            const sitesWithStatus = sites.map(site => {
                const siteIdStr = site._id.toString()
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
                
                const siteObj = site.toObject ? site.toObject() : site
                return {
                    ...siteObj,
                    taken
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
        const site = await siteModel.findOne({ _id: id, isDeleted: { $ne: true } }).populate("jobs", "name")
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
    const { _id } = req.body;

    const employee = await empModel.findById(_id).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee doesn't exist",
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

    // Clear employee assignments
    employee.currentSite = null;
    employee.currentJob = null;

    const saved = await employee.save({ session });

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

    const attendanceRecords =
      await attendanceModel.find({
        "sessions.siteId": siteId,
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

    const records =
      await Attendance.find({
        "sessions.jobId": jobId,
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

    const records =
      await attendanceModel.find({
        "sessions.siteId": siteId,
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
    const { empId, currentJob } = req.body

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

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const attendanceLock =
      await AttendanceLock.findOne({
        siteId,
        date: today,
        isLocked: true,
      }).session(session)

    const oldJobId = employee.currentJob

    // ----------------------------------
    // SITE ATTENDANCE NOT SUBMITTED YET
    // ----------------------------------
    if (!attendanceLock) {
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
        message:
          "Employee assigned to site successfully",
      })
    }

    // ----------------------------------
    // SITE ATTENDANCE ALREADY SUBMITTED
    // ----------------------------------

    let attendance = await attendanceModel.findOne({
      employee: empId,
      date: today,
    }).session(session)

    if (attendance) {
      const alreadyHasSession =
        attendance.sessions.some(
          (session) =>
            session.siteId.toString() ===
            siteId.toString()
        )

      if (!alreadyHasSession) {
        attendance.sessions.push({
          siteId,
          jobId: currentJob,
          checkIn: null,
          checkOut: null,
          workedHours: 0,
          markedBy,
        })

        await attendance.save({ session })
      }
    } else {
      const newAttendances = await attendanceModel.create([{
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
            checkIn: null,
            checkOut: null,
            workedHours: 0,
            markedBy,
          },
        ],
      }], { session })
      attendance = newAttendances[0]
    }

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
      attendance,
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
    const { locationDetails, isCompleted, defaultCheckIn, defaultCheckOut } = req.body;

    const site = await siteModel.findById(siteId);
    if (!site) {
      return res.status(404).json({ message: "Site not found" });
    }

    if (defaultCheckIn !== undefined && defaultCheckIn !== "") {
      const [inH] = defaultCheckIn.split(":").map(Number);
      const workConfig = await workModel.findOne();
      const cutoffHour = workConfig ? workConfig.nightShiftCutoffHour : 7;
      if (inH < cutoffHour) {
        return res.status(400).json({
          message: `Default check-in time cannot be before the night shift cutoff hour (${cutoffHour}:00 AM)`
        });
      }
    }

    if (locationDetails !== undefined) site.locationDetails = locationDetails;
    if (isCompleted !== undefined) site.isCompleted = isCompleted;
    if (defaultCheckIn !== undefined) site.defaultCheckIn = defaultCheckIn;
    if (defaultCheckOut !== undefined) site.defaultCheckOut = defaultCheckOut;

    await site.save();
    return res.status(200).json(site);
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
    toggleJobCompleted
}

export default siteController;

