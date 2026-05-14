import empModel from '../models/empModel.js'
import userModel from '../models/userModel.js'

//Admin

//GET /api/employees?site=&jobTitle=&name=&employeeId=

export const getAllEmployees = async (req, res) => {
  try {
    const { name, employeeId, site, jobTitle, page = 1, limit = 10, notSupervisor = "false" } = req.query;

    let filter = {};

    if (notSupervisor === "true") {
      filter.$or = [
        { user: { $exists: false } },
        { user: null }
      ];
    }

    filter.isActive = true;

    if (site){
      if (site === "null"){
        filter.currentSite = null
      }else{
        filter.currentSite = site
      }
    } 

    if (jobTitle) {
      filter.jobTitle = { $regex: jobTitle, $options: "i" }
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

    const skip = (page - 1) * limit;

    const employees = await empModel
      .find(
        filter,
        "_id name employeeId jobTitle monthlySalary currentSite currentJob"
      )
      .skip(skip)
      .limit(Number(limit));

    const totalEmployees = await empModel.countDocuments(filter);

    res.status(200).json({
      employees,
      currentPage: Number(page),
      totalPages: Math.ceil(totalEmployees / limit),
      totalEmployees,
    });

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
    const { name, employeeId, email, password } = req.body;

    const role = "supervisor";

    const supervisor = new userModel({ name, email, password, role });
    const savedUser = await supervisor.save();

    const employee = await empModel.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    employee.user = savedUser._id;
    await employee.save();

    res.status(201).json(savedUser);

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Conflict: Email ID already exists in the system."
      });
    }
    console.log(error);
    res.status(500).json({ message: "Internal server error" });
  }
};


// PUT /api/employees/:id
export const editEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, currentSite } = req.body;

    const employee = await empModel.findByIdAndUpdate(
      id,
      req.body,
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (employee.user) {
      await userModel.findByIdAndUpdate(employee.user, {
        name,
        assignedSite: currentSite
      });
    }

    res.status(200).json({ message: "Updated employee details successfully" });

  } catch (error) {
    res.status(500).json({ message: "Internal Server Error" });
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

const empController = {
  getAllEmployees,
  addEmployee,
  addSupervisor,
  getEmployee,
  getEmployeeBySite,
  deleteEmployee,
  editEmployee,
  getSupervisors,
  deleteSupervisor
};

export default empController;