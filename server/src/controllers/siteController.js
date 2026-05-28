import empModel from '../models/empModel.js'
import siteModel from '../models/siteModel.js'
import userModel from '../models/userModel.js'
import AttendanceLock from '../models/lockModel.js'
import jobModel from '../models/jobModel.js'
import attendanceModel from '../models/attendanceModel.js'
import mongoose from 'mongoose'
import { json } from 'express'


//Admin

export const getSites = async (req, res) => {
    try{
        const { siteName, isActive } = req.query
        let filter  = {}
        if (siteName) {
            filter.siteName = { $regex: `^${siteName}`, $options: "i" };
        }

        if (isActive === "true"){
           filter.isActive = true
        }

        
        const sites = await siteModel.find(filter,"_id siteName locationDetails jobs isActive ").sort({isActive: -1}).populate("jobs", "name")
        res.status(200).json(sites)
    }catch(error){  
        res.status(500).json({message: "Internal server error"})
        console.log(error)
    }
}

export const getSite = async (req, res) => {
    try{
        const { id } = req.params
        const site = await siteModel.findById(id)
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
    try {
        const { _id } = req.body
        const { siteId } = req.params
        const employee = await empModel.findById(_id)

        if (!employee){
            return res.status(404).json({message: "Employee Doesnt exist"})
        }

        const supervisor = await userModel.findOne({ _id: employee.user })

        supervisor.assignedSite = siteId
        
        employee.currentSite = siteId
        await supervisor.save()
        await employee.save()
        res.status(200).json(supervisor)
    }
    catch (error) {
        res.status(500).json({message: "Internal server error"})
        console.log(error)
    }
}


//Req: takes in the object id of the employee who is a supervisor
//Res: status code 200
export const removeSupervisor = async (req, res) => {
    try{
        const {_id} = req.body
        const employee = await empModel.findById(_id)
        if (!employee){
            return res.status(400).json({message: "Employee doent exist"})
        }
        if (employee.currentJob) {
            await jobModel.findByIdAndUpdate(employee.currentJob, {
                $pull: {
                    employees: employee._id,
                },
            });
        }
        employee.currentSite = null
        employee.currentJob = null
        const supervisor = await userModel.findOne({_id: employee.user})
        if (!supervisor){
            return res.status(400).json({message: "Employee is not a supervisor"})
        }
        supervisor.assignedSite = null
        await supervisor.save()
        await employee.save()
        res.status(200).json(supervisor)
    }
    catch(error){
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
  try {
    const { _id } = req.body;

    const employee = await empModel.findById(_id);

    if (!employee) {
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
      });
    }

    // Clear employee assignments
    employee.currentSite = null;
    employee.currentJob = null;

    const saved = await employee.save();

    res.status(200).json(saved);

  } catch (error) {
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
  try {
    const { siteId } = req.params;
    const { name, jobCode } = req.body;

    // Create job
    const newJob = await jobModel.create({
      name,
      jobCode,
      site: siteId,
    });

    // Push job id into site's jobs array
    await siteModel.findByIdAndUpdate(siteId, {
      $push: {
        jobs: newJob._id,
      },
    });

    res.status(201).json({
      message: "New Job Created",
    });

  } catch (error) {
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

export const getSiteJobs = async (req, res) => {
  try {
    const { siteId } = req.params;

    // Check if site exists
    const site = await siteModel.findById(siteId);

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // Get jobs for this site
    const jobs = await jobModel
      .find({ site: siteId })
      .lean();

    // Attendance metrics aggregation
    // Attendance metrics aggregation
    const attendanceStats =
      await attendanceModel.aggregate([
        {
          $match: {
            siteId:
              new mongoose.Types.ObjectId(
                siteId
              ),
            jobId: { $ne: null },
          },
        },

        {
          $group: {
            _id: "$jobId",

            // unique days worked
            uniqueDates: {
              $addToSet: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$date",
                },
              },
            },

            // total manhours
            totalManHours: {
              $sum: {
                $add: [
                  {
                    $ifNull: [
                      "$workHours",
                      0,
                    ],
                  },

                  {
                    $ifNull: [
                      "$overtimeHours",
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },

        {
          $project: {
            _id: 1,

            totalManHours: 1,

            totalDays: {
              $size: "$uniqueDates",
            },
          },
        },
      ]);

    // Live employee count aggregation
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

    // Create lookup maps
    const statsMap = {};

    attendanceStats.forEach((stat) => {
      statsMap[stat._id.toString()] =
        stat;
    });

    const employeeCountMap = {};

    employeeCounts.forEach((item) => {
      employeeCountMap[
        item._id.toString()
      ] = item.employeeCount;
    });

    // Merge everything into jobs
    const enrichedJobs = jobs.map(
      (job) => {
        const stats =
          statsMap[job._id.toString()];

        return {
          ...job,

          totalManHours:
            stats?.totalManHours || 0,

          totalDays:
            stats?.totalDays || 0,

          employeeCount:
            employeeCountMap[
              job._id.toString()
            ] || 0,
        };
      }
    );

    return res
      .status(200)
      .json(enrichedJobs);

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


export const addEmployeeToJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { empId } = req.body;

    // Check employee exists
    const employee = await empModel.findById(empId);

    if (!employee) {
      return res.status(404).json({
        message: "Employee was not found",
      });
    }

    // Check job exists
    const job = await jobModel.findById(jobId);

    if (!job) {
      return res.status(404).json({
        message: "Job was not found",
      });
    }

    // Ensure employee belongs to same site as the job
    if (
      !employee.currentSite ||
      employee.currentSite.toString() !== job.site.toString()
    ) {
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

    await employee.save();
    await job.save();

    res.status(200).json({
      message: "Employee added to job successfully",
    });

  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const removeEmployeeFromJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { empId } = req.body;

    // Check employee exists
    const employee = await empModel.findById(empId);

    if (!employee) {
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    // Check job exists
    const job = await jobModel.findById(jobId);

    if (!job) {
      return res.status(404).json({
        message: "Job not found",
      });
    }

    // Ensure employee actually belongs to this job
    if (
      !employee.currentJob ||
      employee.currentJob.toString() !== jobId
    ) {
      return res.status(400).json({
        message: "Employee is not assigned to this job",
      });
    }

    // Remove employee from job employees array
    job.employees.pull(empId);

    // Clear employee currentJob
    employee.currentJob = null;

    await employee.save();
    await job.save();

    return res.status(200).json({
      message: "Employee removed from job successfully",
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const jobManHoursAndDays = async (req, res) => {
  try {
    const { jobId } = req.params;

    const records = await attendanceModel.find({ jobId });

    if (!records.length) {
      return res.status(404).json({
        message: "No attendance records found for this job",
      });
    }

    let totalManHours = 0;
    const uniqueDays = new Set();

    for (const rec of records) {
      const day = new Date(rec.date).toISOString().split("T")[0];
      uniqueDays.add(day);

      let hours = 0;

      if (rec.status === "present") {
        hours = rec.workHours || 8;
      } 
      else if (rec.status === "halfday") {
        hours = rec.workHours || 4;
      } 
      else {
        hours = 0;
      }

      // overtime always included
      hours += rec.overtimeHours || 0;

      totalManHours += hours;
    }

    return res.status(200).json({
      jobId,
      totalManHours,
      totalDays: uniqueDays.size,
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const siteManHoursAndDays = async (req, res) => {
  try {
    const { siteId } = req.params;

    // Get all attendance records for this site
    const records = await attendanceModel.find({ siteId });

    if (!records.length) {
      return res.status(404).json({
        message: "No attendance records found for this site",
      });
    }

    let totalManHours = 0;

    const uniqueDays = new Set();

    for (const rec of records) {
      const day = new Date(rec.date)
        .toISOString()
        .split("T")[0];

      uniqueDays.add(day);

      let hours = 0;

      if (rec.status === "present") {
        hours = rec.workHours || 8;
      } 
      else if (rec.status === "halfday") {
        hours = rec.workHours || 4;
      } 
      else {
        hours = 0;
      }

      // Add overtime
      hours += rec.overtimeHours || 0;

      totalManHours += hours;
    }

    return res.status(200).json({
      siteId,
      totalManHours,
      totalDays: uniqueDays.size,
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const deactivateSite = async (req, res) => {
  try {
    const { siteId } = req.params;

    // Find site
    const site = await siteModel.findById(siteId);

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // Get all jobs associated with this site
    const jobs = await jobModel.find({ site: siteId });

    const jobIds = jobs.map((job) => job._id);

    
    // REMOVE EMPLOYEES FROM SITE
   

    await empModel.updateMany(
      { currentSite: siteId },
      {
        $set: {
          currentSite: null,
          currentJob: null,
        },
      }
    );

    
    // CLEAR JOB EMPLOYEE ARRAYS
   

    await jobModel.updateMany(
      { site: siteId },
      {
        $set: {
          employees: [],
          isActive: false,
        },
      }
    );

    
    // DEACTIVATE SITE
   

    site.isActive = false;

    await site.save();

    return res.status(200).json({
      message: "Site deactivated successfully",
      deactivatedJobs: jobIds.length,
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const reactivateSite = async (req, res) => {
  try {
    const { siteId } = req.params;

    // Find site
    const site = await siteModel.findById(siteId);

    if (!site) {
      return res.status(404).json({
        message: "Site not found",
      });
    }

    // Reactivate all jobs under this site
    const result = await jobModel.updateMany(
      { site: siteId },
      {
        $set: {
          isActive: true,
        },
      }
    );

    // Reactivate site
    site.isActive = true;

    await site.save();

    return res.status(200).json({
      message: "Site reactivated successfully",
      reactivatedJobs: result.modifiedCount,
    });

  } catch (error) {
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
        $regex: name,
        $options: "i",
      };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: employeeId,
        $options: "i",
      };
    }

    if (jobTitle) {
      filter.jobTitle = {
        $regex: jobTitle,
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
    const job = await jobModel.findById(jobId)

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
  try {
    const { jobId } = req.params;

    const job = await jobModel.findById(jobId);

    if (!job) {
      return res.status(404).json({
        message: "Job not found",
      });
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
        }
      );

      // Optional cleanup
      job.employees = [];

      job.isActive = false;

      await job.save();

      return res.status(200).json({
        message:
          "Job deactivated successfully",
      });
    }

    // If currently inactive -> reactivate
    job.isActive = true;

    await job.save();

    return res.status(200).json({
      message:
        "Job re-activated successfully",
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

//A funtion to make the currentSite null after we deactivate a site when its complete.
//It should iterate thru the list of employees and set the current site to null as well as check if the supervisor is true then also set the assignedSite 
//to null

const siteController = {
    getSites,
    getSite,
    createSite,
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
    changeJobStatus
}

export default siteController;

