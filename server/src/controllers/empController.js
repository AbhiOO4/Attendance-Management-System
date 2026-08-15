import empModel from '../models/empModel.js'
import jobModel from '../models/jobModel.js';
import jobTitleModel from '../models/jobTitleModel.js';
import userModel from '../models/userModel.js'
import mongoose from 'mongoose'
import { escapeRegExp } from '../utils/escapeRegExp.js'
import AttendanceLock from '../models/lockModel.js'
import attendanceModel from '../models/attendanceModel.js'
import workModel from '../models/workModel.js'
import { resolveCollarType } from '../utils/collar.js'

//Admin

//GET /api/employees?site=&jobTitle=&name=&employeeId=

export const getAllEmployees = async (req, res) => {
  try {
    const {
      name,
      employeeId,
      site,
      jobTitle,
      job,
      page,
      limit,
      notSupervisor = "false",
      employmentType,
      rosterForSite,
    } = req.query;

    let filter = {};

    if (employmentType) {
      filter.employmentType = employmentType;
    }

    if (notSupervisor === "true") {
      filter.$or = [
        { user: { $exists: false } },
        { user: null },
      ];
    }

    filter.isActive = true;

    if (rosterForSite) {
      // Manage-Employees-from-SiteDetail roster: on-site employees (incl. those
      // with a pending job change) AND incoming scheduled-adds targeting this site.
      // Wrapped in $and so it never clashes with the notSupervisor $or above.
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { currentSite: rosterForSite },
            { scheduledSiteId: rosterForSite },
          ],
        },
      ];
    } else if (site) {
      if (site === "null") {
        filter.currentSite = null;
      } else {
        filter.currentSite = site;
      }
    }

    if (job) {
      // Narrow to a specific site Job (currentJob reference). "unassigned" → no job.
      filter.currentJob = job === "unassigned" ? null : job;
    }

    if (jobTitle) {
      filter.jobTitle = { $regex: escapeRegExp(jobTitle), $options: "i" };
    }

    if (name) {
      filter.name = { $regex: `^${escapeRegExp(name)}`, $options: "i" };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: `^${escapeRegExp(employeeId)}`,
        $options: "i",
      };
    }

    let query = empModel.find(filter,
        "_id name employeeId jobTitle currentSite currentJob user employmentType collarType nationality pendingTransferCheckIn pendingTransferSiteId pendingTransferDate pendingTransferFromSiteId scheduledSiteId scheduledJobId scheduledEffectiveDate"
      )
      .populate("currentJob", "name") // 👈 add this
      .populate("pendingTransferFromSiteId", "siteName") // source site for transfer badge
      .sort({ name: 1 });

    // Only the manage-from-SiteDetail roster needs the pending target names resolved.
    if (rosterForSite) {
      query = query
        .populate("scheduledSiteId", "siteName")
        .populate("scheduledJobId", "name");
    }

    // apply pagination only if both page and limit are provided
    if (page && limit) {
      const pageNumber = Math.max(Number(page), 1);
      const limitNumber = Math.max(Number(limit), 1);
      const skip = (pageNumber - 1) * limitNumber;

      query = query.skip(skip).limit(limitNumber);
    }

    const employees = await query;
    const totalEmployees = await empModel.countDocuments(filter);

    const response = {
      employees,
      totalEmployees,
    };

    // send pagination data only when pagination is used
    if (page && limit) {
      const pageNumber = Number(page);
      const limitNumber = Number(limit);

      response.currentPage = pageNumber;
      response.totalPages = Math.ceil(totalEmployees / limitNumber);
    }

    res.status(200).json(response);

  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "failed to fetch employees" });
  }
};

// POST /api/employees
export const addEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Derive collar type from the chosen job title (client never sets it directly).
    req.body.collarType = await resolveCollarType(req.body.jobTitle);
    // Nationality is set on the employee (not derived). Normalize to the allowed pair.
    req.body.nationality = req.body.nationality === 'omani' ? 'omani' : 'foreign';

    const newEmployee = new empModel(req.body);
    const savedEmp = await newEmployee.save({ session });

    if (savedEmp.currentJob) {
      await jobModel.findByIdAndUpdate(
        savedEmp.currentJob,
        { $addToSet: { employees: savedEmp._id } },
        { session }
      );
    }

    if (savedEmp.employmentType === 'temporary' && savedEmp.currentSite) {
      const siteId = savedEmp.currentSite;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const attendanceLock = await AttendanceLock.findOne({
        siteId,
        date: today,
        isLocked: true,
      }).session(session);

      if (attendanceLock) {
        const markedBy = req.user?.id || null;
        await attendanceModel.create([{
          employee: savedEmp._id,
          siteId,
          jobId: null,
          markedBy,
          date: today,
          status: "absent",
          isHoliday: false,
          totalWorkHours: 0,
          overtimeHours: 0,
          sessions: [
            {
              siteId,
              jobId: null,
              checkIn: null,
              checkOut: null,
              workedHours: 0,
              markedBy,
            },
          ],
        }], { session });
      }
    }

    await session.commitTransaction();
    session.endSession();
    res.status(201).json(savedEmp);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Conflict: Employee ID already exists in the system."
      });
    }
    res.status(500).json({ message: "Internal server error" });
    console.log(error);
  }
};


// POST /api/employees/Supervisor
export const addSupervisor = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {

    const {
      name,
      employeeId,
      email,
      password,
    } = req.body

    const role = "supervisor"

    const employee = await empModel.findOne({ employeeId }).session(session)

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee not found",
      })
    }

    const supervisor = new userModel({
      name,
      employeeId,
      email,
      password,
      role,

      assignedSite: employee.currentSite,
    })

    const savedUser = await supervisor.save({ session })

    employee.user = savedUser._id

    await employee.save({ session })

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(savedUser)

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    if (error.code === 11000) {
      return res.status(409).json({
        message: "Conflict: Email ID already exists in the system.",
      })
    }

    console.log(error)

    res.status(500).json({
      message: "Internal server error",
    })
  }
}


// PUT /api/employees/:id
export const editEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { name, currentSite, currentJob, employeeId } = req.body;

    const existingEmployee = await empModel.findById(id).session(session);

    if (!existingEmployee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    // Keep the denormalized collar type in sync when the job title changes.
    if (req.body.jobTitle && req.body.jobTitle !== existingEmployee.jobTitle) {
      req.body.collarType = await resolveCollarType(req.body.jobTitle);
    }
    // Normalize nationality only when the edit actually includes it (findByIdAndUpdate
    // skips validators, so guard against a stray value slipping through).
    if (req.body.nationality !== undefined) {
      req.body.nationality = req.body.nationality === 'omani' ? 'omani' : 'foreign';
    }

    // Site/job assignment is managed through the site-detail / hired-workers flows,
    // not this edit form. Only reconcile currentSite/currentJob when the request
    // explicitly includes currentSite — otherwise leave them untouched (an absent
    // field must never be read as "clear the assignment").
    if (currentSite !== undefined) {
      const prevSite = existingEmployee.currentSite?.toString() || null;
      const newSite = currentSite || null;

      const prevJob = existingEmployee.currentJob?.toString() || null;
      // If site cleared, job must also be null; otherwise use what was sent
      const newJob = !newSite ? null : (currentJob || null);

      // ----------------------------------------
      // SITE CHANGED → pull from old job, apply new job if provided
      // ----------------------------------------
      if (prevSite !== newSite) {
        // Remove from old job
        if (prevJob) {
          await jobModel.findByIdAndUpdate(prevJob, {
            $pull: { employees: existingEmployee._id },
          }, { session });
        }
        // Add to new job if one was sent alongside the new site
        if (newJob) {
          await jobModel.findByIdAndUpdate(newJob, {
            $addToSet: { employees: existingEmployee._id },
          }, { session });
        }
        req.body.currentJob = newJob; // null if no job sent, or the new job id
      }
      // ----------------------------------------
      // SITE SAME, JOB CHANGED
      // ----------------------------------------
      else if (prevJob !== newJob) {
        // Remove from old job
        if (prevJob) {
          await jobModel.findByIdAndUpdate(prevJob, {
            $pull: { employees: existingEmployee._id },
          }, { session });
        }
        // Add to new job
        if (newJob) {
          await jobModel.findByIdAndUpdate(newJob, {
            $addToSet: { employees: existingEmployee._id },
          }, { session });
        }
        req.body.currentJob = newJob;
      }
    }

    const employee = await empModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true, session }
    );

    if (employee.user) {
      await userModel.findByIdAndUpdate(employee.user, {
        name,
        employeeId,
        // Keep the supervisor's assignedSite in sync only when the edit actually
        // carried a site change.
        ...(currentSite !== undefined ? { assignedSite: currentSite } : {}),
      }, { session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: "Updated employee details successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Conflict: Employee ID already exists in the system."
      });
    }

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


// DELETE /api/employees/:id
export const deleteEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    const employee = await empModel.findById(id).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Employee doesnt exist" });
    }

    if (employee.user) {
      await userModel.deleteOne({ _id: employee.user }, { session });
    }

    employee.isActive = false;
    await employee.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: "Deactivated the employee" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: "Internal Server Error" });
  }
};


//Supervisor

// GET /api/employees/by-site/:siteId
export const getEmployeeBySite = async (req, res) => {
  try {
    const { siteId } = req.params;

    const employees = await empModel.find({
      currentSite: siteId,
      isActive: true
    });

    if (employees.length === 0) {
      return res.status(404).json({ message: "No employees assigned" });
    }

    res.status(200).json(employees);

  } catch (error) {
    res.status(500).json({ message: "Internal Server Error" });
  }
};


// GET /api/employees/:id

export const getEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await empModel.findById(id);

    if (!employee) {
      return res.status(404).json({ message: "Employee doesnt exist" });
    }

    res.status(200).json(employee);

  } catch (error) {
    res.status(500).json({ message: "Internal Server Error" });
  }
};


// GET /api/employees/Supervisors?siteId=
export const getSupervisors = async (req, res) => {
  try {
    const {
      name,
      employeeId,
      site,
      jobTitle,
      page = 1,
      limit = 10
    } = req.query;

    let filter = {
      isActive: true,
      user: { $ne: null }
    };

    if (site) {
      if (site === "null"){
        filter.currentSite = null
      }else{
        filter.currentSite = site;
      }
    }

    if (jobTitle) {
      filter.jobTitle = {
        $regex: escapeRegExp(jobTitle),
        $options: "i"
      };
    }

    if (name) {
      filter.name = {
        $regex: `^${escapeRegExp(name)}`,
        $options: "i"
      };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: `^${escapeRegExp(employeeId)}`,
        $options: "i"
      };
    }

    const skip = (page - 1) * limit;

    const employees = await empModel
      .find(
        filter,
        "_id name employeeId jobTitle currentSite currentJob"
      )
      .skip(skip)
      .limit(Number(limit));

    const totalEmployees =
      await empModel.countDocuments(filter);

    res.status(200).json({
      employees,
      currentPage: Number(page),
      totalPages: Math.ceil(
        totalEmployees / limit
      ),
      totalEmployees
    });

  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Error fetching supervisors"
    });
  }
};

export const deleteSupervisor = async (req, res) => {
  const { id } = req.params

  const session = await mongoose.startSession();
  session.startTransaction();
  try {

    const employee = await empModel.findById(id).session(session)

    if (!employee){
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({message: "Employee Doesn't Exist"})
    }

    const findUser = await userModel.findById(employee.user).session(session)

    if (!findUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "The user doesn't exist",
      })
    } 

    await userModel.findByIdAndDelete(employee.user, { session })

    employee.user = null

    await employee.save({ session })

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Supervisor deleted successfully",
    })
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error)

    return res.status(500).json({
      message: "Internal Server Error",
    })
  }
}

export const getJobTitles = async (req, res) => {
  try {
    const jobTitles = await jobTitleModel
      .find()
      .sort({ title: 1 })
      .lean()

    res.status(200).json(jobTitles)

  } catch (error) {
    console.error(error)

    res.status(500).json({
      message: "Internal Server Errorr",
    })
  }
}

export const addJobTitle = async (req, res) => {
  try{
    const {title, collarType} = req.body
    const newJob = new jobTitleModel({
      title,
      ...(collarType === 'staff' || collarType === 'skilled' ? { collarType } : {}),
    })

    await newJob.save()

    res.status(201).json({message: "Job title added"})
  }catch(error){
    console.log(error)
    if (error.code === 11000){
      return res.status(400).json({message: `${error.keyValue.title} already exists`})
    }
    res.status(500).json({
      message: "Internal Server Errorr",
    })
  }
}

// PATCH /api/employees/jobTitles/:id  — reclassify a job title's collarType and
// re-sync the denormalized collarType on every employee holding that title.
export const updateJobTitle = async (req, res) => {
  try {
    const { id } = req.params;
    const { collarType } = req.body;

    if (collarType !== 'staff' && collarType !== 'skilled') {
      return res.status(400).json({
        message: "collarType must be 'skilled' or 'staff'",
      });
    }

    const jobTitle = await jobTitleModel.findByIdAndUpdate(
      id,
      { collarType },
      { new: true }
    );

    if (!jobTitle) {
      return res.status(404).json({ message: "Title doesn't exist" });
    }

    // Re-sync employees holding this title (jobTitle is stored lowercased).
    const result = await empModel.updateMany(
      { jobTitle: { $regex: `^${escapeRegExp(jobTitle.title.trim())}$`, $options: 'i' } },
      { collarType }
    );

    return res.status(200).json({
      message: "Job title updated",
      data: jobTitle,
      employeesUpdated: result.modifiedCount ?? result.nModified ?? 0,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const deleteJobTitle = async (req, res) => {
  try {
    const { id } = req.params;

    const found =
      await jobTitleModel.findByIdAndDelete(id);

    if (!found) {
      return res.status(404).json({
        message: "Title doesn't exist",
      });
    }

    return res.status(200).json({
      message: "Deleted successfully",
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getTempPool = async (req, res) => {
  try {
    const { name, employeeId, jobTitle, page = 1, limit = 10 } = req.query;

    let filter = {
      employmentType: 'temporary',
      currentSite: null,
      isActive: true
    };

    if (jobTitle) {
      filter.jobTitle = { $regex: escapeRegExp(jobTitle), $options: "i" };
    }

    if (name) {
      filter.name = { $regex: `^${escapeRegExp(name)}`, $options: "i" };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: `^${escapeRegExp(employeeId)}`,
        $options: "i",
      };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const employees = await empModel.find(filter,
        "_id name employeeId jobTitle currentSite currentJob user employmentType"
      )
      .populate("currentJob", "name")
      .sort({ name: 1 })
      .skip(skip)
      .limit(Number(limit));

    const totalEmployees = await empModel.countDocuments(filter);

    res.status(200).json({
      employees,
      currentPage: Number(page),
      totalPages: Math.ceil(totalEmployees / Number(limit)),
      totalEmployees,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "failed to fetch temp pool" });
  }
};

export const assignTempWorker = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { employeeId } = req.body;
    let siteId = req.body.siteId;

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id).session(session);
      if (!user || !user.assignedSite) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Supervisor has no assigned site" });
      }
      siteId = user.assignedSite;
    }

    if (!siteId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Site ID is required" });
    }

    const employee = await empModel.findById(employeeId).session(session);
    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.employmentType !== 'temporary') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Only temporary workers can be assigned from the pool" });
    }

    if (employee.currentSite) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Employee is already assigned to a site" });
    }

    employee.currentSite = siteId;
    await employee.save({ session });

    // Handle locked/submitted daily attendance check
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const attendanceLock = await AttendanceLock.findOne({
      siteId,
      date: today,
      isLocked: true,
    }).session(session);

    if (attendanceLock) {
      const markedBy = req.user?.id || null;
      await attendanceModel.create([{
        employee: employee._id,
        siteId,
        jobId: null,
        markedBy,
        date: today,
        status: "absent",
        isHoliday: false,
        totalWorkHours: 0,
        overtimeHours: 0,
        sessions: [
          {
            siteId,
            jobId: null,
            checkIn: null,
            checkOut: null,
            workedHours: 0,
            markedBy,
          },
        ],
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: "Employee assigned successfully", employee });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const releaseTempWorker = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { employeeId } = req.body;

    const employee = await empModel.findById(employeeId).session(session);
    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.employmentType !== 'temporary') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Only temporary workers can be released to the pool" });
    }

    if (!employee.currentSite) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Employee is not currently assigned to any site" });
    }

    if (req.user.role === 'supervisor') {
      const user = await userModel.findById(req.user.id).session(session);
      if (!user || !user.assignedSite || user.assignedSite.toString() !== employee.currentSite.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "You are not authorized to release a worker from another site" });
      }
    }

    const releasedSiteId = employee.currentSite;

    // Pull employee from Job list if assigned
    if (employee.currentJob) {
      await jobModel.findByIdAndUpdate(employee.currentJob, {
        $pull: { employees: employee._id }
      }, { session });
    }

    employee.currentSite = null;
    employee.currentJob = null;
    await employee.save({ session });

    // Handle today's attendance record & session cleanup
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const attendanceRecord = await attendanceModel.findOne({
      employee: employee._id,
      date: today
    }).session(session);

    if (attendanceRecord) {
      attendanceRecord.sessions = attendanceRecord.sessions.filter(
        (s) => s.siteId.toString() !== releasedSiteId.toString()
      );

      if (attendanceRecord.sessions.length === 0) {
        await attendanceModel.findByIdAndDelete(attendanceRecord._id, { session });
      } else {
        const workConfig = await workModel.findOne().session(session);
        const fullDayHours = workConfig?.fullDayHours || 8;
        const halfDayHours = workConfig?.halfDayHours || 4;
        const overtimeThreshold = workConfig?.overtimeThreshold || 8;

        const totalWorkHours = attendanceRecord.sessions.reduce(
          (sum, s) => sum + (s.workedHours || 0),
          0
        );

        let status = 'absent';
        if (totalWorkHours >= fullDayHours) {
          status = 'fullday';
        } else if (totalWorkHours >= halfDayHours) {
          status = 'halfday';
        }

        let overtimeHours = 0;
        if (totalWorkHours > overtimeThreshold) {
          overtimeHours = totalWorkHours - overtimeThreshold;
        }

        attendanceRecord.totalWorkHours = totalWorkHours;
        attendanceRecord.status = status;
        attendanceRecord.overtimeHours = overtimeHours;

        await attendanceRecord.save({ session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: "Employee released successfully" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const empController = {
  getAllEmployees,
  addEmployee,
  addSupervisor,
  getEmployee,
  getEmployeeBySite,
  deleteEmployee,
  editEmployee,
  getSupervisors,
  deleteSupervisor,
  getJobTitles,
  addJobTitle,
  updateJobTitle,
  deleteJobTitle,
  getTempPool,
  assignTempWorker,
  releaseTempWorker,
};

export default empController;