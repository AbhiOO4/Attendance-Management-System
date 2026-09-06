import empModel from '../models/empModel.js'
import jobModel from '../models/jobModel.js';
import jobTitleModel from '../models/jobTitleModel.js';
import userModel from '../models/userModel.js'
import mongoose from 'mongoose'
import { escapeRegExp } from '../utils/escapeRegExp.js'
import AttendanceLock from '../models/lockModel.js'
import attendanceModel from '../models/attendanceModel.js'
import siteModel from '../models/siteModel.js'
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
      search,
      job,
      page,
      limit,
      notSupervisor = "false",
      employmentType,
      rosterForSite,
      status,
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

    // Active-only by default. The Manage-Employees list can pass status=deactivated
    // to see soft-deleted tombstones (rendered muted, with a Restore action) or
    // status=all to see both. Every other consumer omits status → active-only.
    if (status === "deactivated") {
      filter.isActive = false;
    } else if (status !== "all") {
      filter.isActive = true;
    }

    if (rosterForSite) {
      // Manage-Employees-from-SiteDetail roster: on-site employees (incl. those
      // with a pending job change), incoming scheduled-adds targeting this site,
      // AND today's "only for today" visitors — an only-for-today add leaves
      // currentSite at the home site but stamps pendingTransferSiteId = this site,
      // so without this they'd be absent from the Today roster until attendance is
      // submitted. (The client filters these to TODAY-dated ones and shows them as
      // read-only "Visiting" rows; stale pendingTransfer* rows are dropped there.)
      // Wrapped in $and so it never clashes with the notSupervisor $or above.
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { currentSite: rosterForSite },
            { scheduledSiteId: rosterForSite },
            { pendingTransferSiteId: rosterForSite },
          ],
        },
      ];
    } else if (site) {
      if (site === "null") {
        filter.currentSite = null;
      } else {
        // On-site employees AND today's "only for today" visitors: such a transfer/add
        // leaves currentSite elsewhere but stamps pendingTransferSiteId = this site, so
        // without this they'd be missing from the draft and their carried session lost.
        // (Permanent moves set currentSite = site, so they match either way.) Wrapped in
        // $and so it never clashes with the notSupervisor $or above — same as rosterForSite.
        filter.$and = [
          ...(filter.$and || []),
          {
            $or: [
              { currentSite: site },
              { pendingTransferSiteId: site },
            ],
          },
        ];
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

    // Unified search box: split into whitespace tokens; each token must match
    // (substring, case-insensitive) at least one of name / employeeId / jobTitle.
    // So "john welder" matches John whose job title is Welder. Composed via $and
    // so it never clashes with the notSupervisor $or or the site/roster $and.
    if (search && search.trim()) {
      const tokenClauses = search
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((tok) => {
          const rx = { $regex: escapeRegExp(tok), $options: "i" };
          return { $or: [{ name: rx }, { employeeId: rx }, { jobTitle: rx }] };
        });

      filter.$and = [...(filter.$and || []), ...tokenClauses];
    }

    let query = empModel.find(filter,
        "_id name employeeId jobTitle currentSite currentJob user employmentType collarType nationality isActive pendingTransferCheckIn pendingTransferSiteId pendingTransferDate pendingTransferFromSiteId pendingTransferJobId scheduledSiteId scheduledJobId scheduledEffectiveDate scheduledRemoval"
      )
      .populate("currentJob", "name") // 👈 add this
      .populate("pendingTransferFromSiteId", "siteName") // source site for transfer badge
      .populate("pendingTransferJobId", "name") // per-visit job for a cross-site visitor
      .sort({ name: 1 });

    // Only the manage-from-SiteDetail roster needs the pending target names resolved.
    // pendingTransferSiteId is populated here (not globally) so the roster can name the
    // site a home member is visiting today; the ?site= consumers compare it as a raw id
    // (String()) and must keep receiving the unpopulated ObjectId.
    if (rosterForSite) {
      query = query
        .populate("scheduledSiteId", "siteName")
        .populate("scheduledJobId", "name")
        .populate("pendingTransferSiteId", "siteName");
    }

    // apply pagination only if both page and limit are provided
    if (page && limit) {
      const pageNumber = Math.max(Number(page), 1);
      const limitNumber = Math.max(Number(limit), 1);
      const skip = (pageNumber - 1) * limitNumber;

      query = query.skip(skip).limit(limitNumber);
    }

    const employeesRaw = await query;
    const totalEmployees = await empModel.countDocuments(filter);

    // A home member on a one-day visit to another site is dropped from their home
    // roster/draft via the pendingTransfer* stash — but that stash is CONSUMED once the
    // visited site saves the session, after which the home site would re-list them as an
    // ordinary absent member (offering a second, phantom record). Consult the durable
    // signal instead: a session at a site != the queried site on today's attendance.
    // Annotate `recordedElsewhereToday` so both the mark-attendance draft (?site=) and the
    // Manage-Employees roster (?rosterForSite=) can exclude/flag them.
    const anchorSite = site && site !== "null" ? site : rosterForSite;
    let employees = employeesRaw;
    if (anchorSite) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const rosterIds = employeesRaw.map((e) => e._id);
      const atts = await attendanceModel.find(
        { employee: { $in: rosterIds }, date: today },
        "employee sessions"
      );
      const elsewhereByEmp = new Map();
      for (const a of atts) {
        const sessions = a.sessions || [];
        const hasHere = sessions.some((s) => String(s.siteId) === String(anchorSite));
        if (hasHere) continue; // a real multi-site day (also here) still belongs here
        const other = sessions.find((s) => s.siteId && String(s.siteId) !== String(anchorSite));
        if (other) elsewhereByEmp.set(String(a.employee), String(other.siteId));
      }
      if (elsewhereByEmp.size) {
        const otherIds = [...new Set(elsewhereByEmp.values())];
        const siteDocs = await siteModel.find({ _id: { $in: otherIds } }, "siteName");
        const nameById = new Map(siteDocs.map((s) => [String(s._id), s.siteName]));
        employees = employeesRaw.map((e) => {
          const otherId = elsewhereByEmp.get(String(e._id));
          const obj = e.toObject();
          obj.recordedElsewhereToday = otherId
            ? { siteId: otherId, siteName: nameById.get(otherId) || null }
            : null;
          return obj;
        });
      }
    }

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


// DELETE /api/employees/:id            → soft delete (deactivate)
// DELETE /api/employees/:id?mode=permanent → hard delete (only when it leaves no
//   orphans: blocked if the employee has attendance history or a linked user)
export const deleteEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const permanent = req.query.mode === "permanent";

    const employee = await empModel.findById(id).session(session);

    if (!employee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Employee doesnt exist" });
    }

    if (permanent) {
      // A hard delete must not orphan attendance rows (keyed by employee _id) or a
      // supervisor account. When either exists, force the caller to soft-delete.
      const attendanceCount = await attendanceModel.countDocuments({
        employee: id,
      }).session(session);

      if (attendanceCount > 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          message: "Employee has attendance history — deactivate instead.",
        });
      }

      if (employee.user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          message: "Employee is a supervisor — remove the supervisor account first.",
        });
      }

      // Safe to remove: pull any lingering job membership, then drop the document.
      if (employee.currentJob) {
        await jobModel.updateOne(
          { _id: employee.currentJob },
          { $pull: { employees: employee._id } },
          { session }
        );
      }

      await empModel.deleteOne({ _id: id }, { session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({ message: "Employee permanently deleted" });
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
    console.log(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};


// PATCH /api/employees/:id/restore — reactivate a soft-deleted employee. Comes back
// UNASSIGNED (no site/job) and with all pending-transfer / scheduled state cleared,
// so a returning worker is re-posted fresh by an admin. Keeps the same _id, so any
// attendance history stays attached.
export const restoreEmployee = async (req, res) => {
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

    if (employee.isActive) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({ message: "Employee is already active" });
    }

    // Soft delete never pulled the record from its job — do it now so "unassigned"
    // is true at every level.
    if (employee.currentJob) {
      await jobModel.updateOne(
        { _id: employee.currentJob },
        { $pull: { employees: employee._id } },
        { session }
      );
    }

    employee.isActive = true;
    employee.currentSite = null;
    employee.currentJob = null;
    employee.pendingTransferCheckIn = null;
    employee.pendingTransferSiteId = null;
    employee.pendingTransferFromSiteId = null;
    employee.pendingTransferDate = null;
    employee.pendingTransferJobId = null;
    employee.scheduledSiteId = null;
    employee.scheduledJobId = null;
    employee.scheduledEffectiveDate = null;
    employee.scheduledRemoval = false;

    await employee.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: "Employee restored" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.log(error);
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
  restoreEmployee,
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