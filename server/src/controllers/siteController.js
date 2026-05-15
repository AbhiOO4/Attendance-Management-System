import empModel from '../models/empModel.js'
import siteModel from '../models/siteModel.js'
import userModel from '../models/userModel.js'


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

        
        const sites = await siteModel.find(filter,"_id siteName locationDetails isActive").sort({isActive: -1})
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
        employee.currentSite = null
        const supervisor = await userModel.findOne({_id: employee.user})
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
    getSites,
    getSite,
    createSite,
    assignEmployee,
    assignSupervisor,
    removeSupervisor,
    removeEmployee
}

export default siteController;

