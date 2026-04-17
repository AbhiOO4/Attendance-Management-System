import empModel from '../models/empModel.js'
import siteModel from '../models/siteModel.js'
import userModel from '../models/userModel.js'


//Admin


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
        res.status(500).json({message: "Internal server error"})
    }
}

//Req: Supervisors id, employee id, siteId
//Res: status 200 supervisor details
export const  assignSupervisor = async (req , res) => {
    try {
        const { supervisorId, employeeId } = req.body
        const {siteId} = req.params
        const supervisor = await userModel.findOne({ _id: supervisorId })
        supervisor.assignedSite = siteId
        const employee = await empModel.findOne({ employeeId: employeeId })
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
        const employee = await empModel.findOne({_id})
        employee.currentSite = null
        const supervisor = await userModel.findOne({_id: employee.isSupervisor})
        supervisor.assignedSite = null
        await supervisor.save()
        await employee.save()
        res.status(200).json(supervisor)
    }catch{error}{
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
    try{
        const {_id} = req.body
        const employee = await empModel.findOne({_id})
        if (!employee){
            return res.status(400).json({message: "Employee doent exist"})
        }
        employee.currentSite = null
        const saved = await employee.save()
        res.status(200).json(saved)
    }
    catch(error){
        res.status(500).json({message: "Internal Server error"})
    }
}

//A funtion to make the currentSite null after we deactivate a site when its complete.
//It should iterate thru the list of employees and set the current site to null as well as check if the supervisor is true then also set the assignedSite 
//to null

const siteController = {
    createSite,
    assignEmployee,
    assignSupervisor,
    removeSupervisor,
    removeEmployee
}

export default siteController;

