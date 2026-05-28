
import mongoose from "mongoose";

const connectDB = async () => {
    try{
        await mongoose.connect("mongodb://localhost:27017/AMS")
        console.log('connected to db')
    }catch(error){
        console.log('connection failed', error)
        process.exit(1) //status code 1: exit with failiure
    }
}

connectDB()

import userModel from "../models/userModel.js";
import workModel from "../models/workModel.js";
import jobTitleModel from "../models/jobTitleModel.js";

const seeWorkSchedule = async () => {
    try {
        const schedule = await workModel.create({
            type: "default",
            name: "Default Work Schedule",
            shiftHours: 10,
            weeklyHolidays: ["friday"],
            customHolidays: [],
        })
        console.log("Doc created")
    }catch(error){
        console.log(error)
    }
}

jobTitleModel.insertMany([{title: "Welder"}, {title: "Staff"}, {title: "Mechanic"}, {title: "Fitter"}, {title: "Gas-cutter"}, {title: "Grinder"}, {title: "Mig-welder"}, {title: "T-welder"}, {title: "HSE"}])

// seeWorkSchedule()

// async function createAdmin (name, email, password) {
//     const admin = new userModel({name, email, password, role: 'admin'})
//     await admin.save()
// }

// createAdmin('Abhi', 'abhinavsree243@gmail.com', "abhi@123", )