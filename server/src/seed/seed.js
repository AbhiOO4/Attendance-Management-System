import dotenv from 'dotenv'
dotenv.config({quiet: true})

import mongoose from "mongoose";

const connectDB = async () => {
    try{
        console.log(process.env.MONGO_URI)
        await mongoose.connect(`${process.env.MONGO_URI}`)
        console.log('connected to db')
    }catch(error){
        console.log('connection failed', error)
        process.exit(1) //status code 1: exit with failiure
    }
}

connectDB()

import employeeModel from "../models/empModel.js"
import userModel from "../models/userModel.js";
import workModel from "../models/workModel.js";
import jobTitleModel from "../models/jobTitleModel.js";

const seeWorkSchedule = async () => {
  try {
    const schedule = await workModel.create({
      type: "default",
      name: "Default Work Schedule",

      fullDayHours: 8,
      halfDayHours: 4,

      overtimeThreshold: 8,
      overtimeRatePerHour: 0,

      weeklyHolidays: ["friday"],
    })

    console.log("Doc created", schedule)
  } catch (error) {
    console.log(error)
  }
}

const employees = [];

const jobTitles = [
  "Welder",
  "Staff",
  "Mechanic",
  "Fitter",
  "Gas-cutter",
  "Grinder",
  "Mig-welder",
  "T-welder",
  "HSE",
];

for (let i = 1; i <= 200; i++) {
  employees.push({
    name: `Employee ${i}`,
    employeeId: `EMP${String(i).padStart(4, "0")}`,
    jobTitle: jobTitles[(i - 1) % jobTitles.length],
    monthlySalary: 18000 + Math.floor(Math.random() * 32000),
    isActive: true,
  });
}

console.log(JSON.stringify(employees, null, 2));

const jobtitles = [
  { title: "Welder" },
  { title: "Staff" },
  { title: "Mechanic" },
  { title: "Fitter" },
  { title: "Gas-cutter" },
  { title: "Grinder" },
  { title: "Mig-welder" },
  { title: "T-welder" },
  { title: "HSE" },
];

await jobTitleModel.insertMany(jobtitles);
await employeeModel.insertMany(employees);


async function createAdmin (name, email, password) {
    const admin = new userModel({name, email, password, role: 'admin'})
    await admin.save()
}

// seeWorkSchedule()
// createAdmin('Abhi', 'abhinavsree243@gmail.com', "abhi@123", )