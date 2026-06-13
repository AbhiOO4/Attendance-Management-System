import empModel from '../models/empModel.js'
import jobModel from '../models/jobModel.js';
import jobTitleModel from '../models/jobTitleModel.js';
import userModel from '../models/userModel.js'
import mongoose from 'mongoose'
import { escapeRegExp } from '../utils/escapeRegExp.js'

//Admin

//GET /api/employees?site=&jobTitle=&name=&employeeId=

export const getAllEmployees = async (req, res) => {
  try {
    const {
      name,
      employeeId,
      site,
      jobTitle,
      page,
      limit,
      notSupervisor = "false",
    } = req.query;

    let filter = {};

    if (notSupervisor === "true") {
      filter.$or = [
        { user: { $exists: false } },
        { user: null },
      ];
    }

    filter.isActive = true;

    if (site) {
      if (site === "null") {
        filter.currentSite = null;
      } else {
        filter.currentSite = site;
      }
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
        "_id name employeeId jobTitle monthlySalary currentSite currentJob user"
      )
      .populate("currentJob", "name") // 👈 add this
      .sort({ name: 1 });

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
  try {
    const newEmployee = new empModel(req.body);
    const savedEmp = await newEmployee.save();
    res.status(201).json(savedEmp);
  } catch (error) {
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

    const employee = await empModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true, session }
    );

    if (employee.user) {
      await userModel.findByIdAndUpdate(employee.user, {
        name,
        employeeId,
        assignedSite: currentSite,
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
        "_id name employeeId jobTitle monthlySalary currentSite currentJob"
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
  const deletePassword = req.body.deletePassword || req.headers['x-delete-password'] || req.query.deletePassword;

  const configPassword = process.env.MAIN_ADMIN_DELETE_PASSWORD;
  if (!configPassword) {
    return res.status(500).json({ message: "Main admin delete password is not configured on the server." });
  }

  if (deletePassword !== configPassword) {
    return res.status(403).json({ message: "Invalid delete password." });
  }

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
    const {title} = req.body
    const newJob = new jobTitleModel({title})

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
  deleteEmployee,
  deleteJobTitle
};

export default empController;