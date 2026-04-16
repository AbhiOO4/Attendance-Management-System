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
        console.log(req.body)
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

export const getEmployee = async (req, res) => {

}


//Supervisor

export const getEmployeeBySite = async (req, res) => {

}



const empController = {
    getAllEmployees,
    addEmployee,
    addSupervisor,
    getEmployee,
    getEmployeeBySite
};

export default empController;

