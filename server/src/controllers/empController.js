import empModel from '../models/empModel.js'
import jobModel from '../models/jobModel.js';
import jobTitleModel from '../models/jobTitleModel.js';
import userModel from '../models/userModel.js'

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
      filter.jobTitle = { $regex: jobTitle, $options: "i" };
    }

    if (name) {
      filter.name = { $regex: `^${name}`, $options: "i" };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: `^${employeeId}`,
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

  try {

    const {
      name,
      employeeId,
      email,
      password,
    } = req.body

    const role = "supervisor"

    const employee = await empModel.findOne({ employeeId })

    if (!employee) {
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

    const savedUser = await supervisor.save()

    employee.user = savedUser._id

    await employee.save()

    res.status(201).json(savedUser)

  } catch (error) {

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
  try {
    const { id } = req.params;
    const { name, currentSite, employeeId } = req.body;

    const existingEmployee = await empModel.findById(id);

    if (!existingEmployee) {
      return res.status(404).json({
        message: "Employee not found",
      });
    }

    const prevSite = existingEmployee.currentSite?.toString() || null;
    const newSite = currentSite || null;

    // If site changed OR site removed
    if (prevSite !== newSite) {

      // Remove employee from previous job employees array
      if (existingEmployee.currentJob) {
        await jobModel.findByIdAndUpdate(
          existingEmployee.currentJob,
          {
            $pull: {
              employees: existingEmployee._id,
            },
          }
        );
      }

      // Clear currentJob
      req.body.currentJob = null;
    }

    const employee = await empModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );

    if (employee.user) {
      await userModel.findByIdAndUpdate(employee.user, {
        name,
        employeeId,
        assignedSite: currentSite,
      });
    }

    res.status(200).json({
      message: "Updated employee details successfully",
    });

  } catch (error) {
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
  try {
    const { id } = req.params;

    const employee = await empModel.findById(id);

    if (!employee) {
      return res.status(404).json({ message: "Employee doesnt exist" });
    }

    if (employee.user) {
      await userModel.deleteOne({ _id: employee.user });
    }

    employee.isActive = false;
    await employee.save();

    res.status(200).json({ message: "Deactivated the employee" });

  } catch (error) {
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
        $regex: jobTitle,
        $options: "i"
      };
    }

    if (name) {
      filter.name = {
        $regex: `^${name}`,
        $options: "i"
      };
    }

    if (employeeId) {
      filter.employeeId = {
        $regex: `^${employeeId}`,
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

  try {

    const employee = await empModel.findById(id)

    if (!employee){
      return res.status(404).json({message: "Employee Doesn't Exist"})
    }

    const findUser = await userModel.findById(employee.user)

    if (!findUser) {
      return res.status(404).json({
        message: "The user doesn't exist",
      })
    } 

    await userModel.findByIdAndDelete(employee.user)

    employee.user = null

    await employee.save()

    return res.status(200).json({
      message: "Supervisor deleted successfully",
    })
  } catch (error) {
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