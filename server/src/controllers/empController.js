import empModel from '../models/empModel.js'
import userModel from '../models/userModel.js'

//Admin

//Req: null
//Res: 200 status code 
export const getAllEmployees = async (req, res) => {
    try{
        const employees = await empModel.find({})
        res.status(200).json(employees)
    }catch(error){
        res.status(500).json({ message: "failed to fetch employees" });
        console.log(error);
    }
}


//Req: takes in the name, employeeId and Job title of the employee
//Res: 201 status code
export const addEmployee = async (req, res) => {
    try{
        const newEmployee = new empModel(req.body);
        const savedEmp = await newEmployee.save();
        res.status(201).json(savedEmp);
    }catch(error){
        if (error.code === 11000) {
            return res.status(409).json({ 
                message: "Conflict: Employee ID already exists in the system." 
            });
        }
        res.status(500).json({message: "Internal server error"})
        console.log(error)
    }
}

//Req: Takes the name, email, password and the employee id of the person.
export const addSupervisor = async (req, res) => {
    try {
        const { name, employeeId, email, password } = req.body
        const role = "Supervisor"
        const supervisor = new userModel({ name, email, password, role })
        const savedDoc = await supervisor.save()
        const employee = await empModel.findOne({ employeeId: employeeId })
        if (!employee){
            return res.status(404).json({message: "Employee not found"})
        }
        employee.isSupervisor = savedDoc._id
        await employee.save()
        res.status(201).json(savedDoc)
    }
    catch (error) {
        res.status(500).json({message: "Interal server error"})
        console.log(error)
    }
}

//Req: employee object id
export const editEmployee = async (req, res) => {
    try{
        const {id} = req.params
        const {name, employeeId, jobTitle} = req.body
        const employee = await empModel.findByIdAndUpdate(id, {name, employeeId, jobTitle})
        if (employee.isSupervisor){
            await userModel.findByIdAndUpdate(employee.isSupervisor, {name})
        }
        res.status(200).json({message: "Updated employee details successfully"})

    }catch(error){
        res.status(500).json({message: "Internal Server Error"})
    }
}

//Req: employee object id
export const deleteEmployee = async (req, res) => {
    try{
        const {id} = req.params
        const employee = await empModel.findOne({_id: id})
        if (!employee){
            res.status(404).json({message: "Employee doesnt exist"})
            return 
        }
        if (employee.isSupervisor){
            await userModel.deleteOne({_id: employee.isSupervisor})
        }
        employee.isActive = false
        await employee.save()
        res.status(200).json({message: "Deactivated the employee"})
    }catch(error){
         res.status(500).json({message: "Internal Server Error"})
    }
}

  

//Supervisor

//Req: Take in the siteId 
//Res: Responds with list of employees in that current site.
export const getEmployeeBySite = async (req, res) => {
    try{
        const {siteId} = req.params
        const employees = await empModel.find({siteId: siteId})
        if (!employees){
            return res.status(400).json({message: "No employees assigned"})
        }
        res.status(200).json(employees)
    }
    catch(error){
        res.status(500).json({message: "Internal Server Error"})
    }
}


//Req: object id of employee
export const getEmployee = async (req, res) => {
    try{
        const {id} = req.params
        const employee = await empModel.find({_id: id})
        if (!employee){
            res.status(400).json({message: "Employee doesnt exist"})
            return 
        }
        res.status(200).json(employee)
    }
    catch(error){
        res.status(500).json({message: "Internal Server Error"})
    }
}



const empController = {
    getAllEmployees,
    addEmployee,
    addSupervisor,
    getEmployee,
    getEmployeeBySite,
    deleteEmployee,
    editEmployee
};

export default empController;

