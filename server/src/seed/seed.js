import dotenv from 'dotenv'
dotenv.config({quiet: true})

import mongoose from "mongoose";

const connectDB = async () => {
    try{
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

const employeeNames = [
  "Abhilash Nair",
  "Akhil Menon",
  "Anand Pillai",
  "Arun Warrier",
  "Athul Nambiar",
  "Biju Thomas",
  "Deepak Mathew",
  "Dileep George",
  "Harikrishnan Joseph",
  "Jithin Paul",
  "Karthik Kumar",
  "Manoj Babu",
  "Naveen Das",
  "Nikhil Krishnan",
  "Pradeep Sreekumar",
  "Rajesh Prasad",
  "Ranjith Mohan",
  "Santhosh Rajan",
  "Sreenath Soman",
  "Sudheesh Kurup",
  "Sujith Panicker",
  "Sunil Nath",
  "Vijesh Chandran",
  "Vipin Varma",
  "Vishnu Radhakrishnan",
  "Abhinav Nair",
  "Ajith Menon",
  "Akshay Pillai",
  "Albin Thomas",
  "Amal George",
  "Anoop Joseph",
  "Aravind Paul",
  "Arjun Kumar",
  "Ashwin Babu",
  "Bibin Das",
  "Danish Krishnan",
  "Dhanush Sreekumar",
  "Faisal Prasad",
  "Gokul Mohan",
  "Hari Rajan",
  "Harish Soman",
  "Jagan Kurup",
  "Jaison Panicker",
  "Jithesh Nath",
  "Kiran Chandran",
  "Mahesh Varma",
  "Midhun Radhakrishnan",
  "Nandu Nair",
  "Nithin Menon",
  "Pranav Pillai",
  "Rahul Warrier",
  "Rakesh Nambiar",
  "Ranjan Thomas",
  "Ratheesh Mathew",
  "Rohith George",
  "Sachin Joseph",
  "Sandeep Paul",
  "Sarath Kumar",
  "Shyam Babu",
  "Sijin Das",
  "Sreejith Krishnan",
  "Sreerag Sreekumar",
  "Sujin Prasad",
  "Suresh Mohan",
  "Umesh Rajan",
  "Unnikrishnan Soman",
  "Vimal Kurup",
  "Vinod Panicker",
  "Vipul Nath",
  "Vivek Chandran",
  "Yadhu Varma",
  "Aadarsh Radhakrishnan",
  "Adarsh Nair",
  "Afsal Menon",
  "Ajeesh Pillai",
  "Anoop Warrier",
  "Antony Nambiar",
  "Arshad Thomas",
  "Ashik Mathew",
  "Basil George",
  "Bijoy Joseph",
  "Christy Paul",
  "Denson Kumar",
  "Ebin Babu",
  "Eldho Das",
  "Farhan Krishnan",
  "Firoz Sreekumar",
  "Gireesh Prasad",
  "Haneef Mohan",
  "Irfan Rajan",
  "Jafar Soman",
  "Jerin Kurup",
  "Jomon Panicker",
  "Joyal Nath",
  "Kabeer Chandran",
  "Lijin Varma",
  "Linto Radhakrishnan",
  "Mansoor Nair",
  "Nasar Menon",
  "Niyas Pillai",
  "Noufal Warrier",
  "Prabin Nambiar",
  "Prakash Thomas",
  "Praveen Mathew",
  "Rafi George",
  "Ramees Joseph",
  "Rejith Paul",
  "Riyas Kumar",
  "Robin Babu",
  "Rony Das",
  "Shabeer Krishnan",
  "Shafiq Sreekumar",
  "Shanavas Prasad",
  "Shiju Mohan",
  "Shine Rajan",
  "Shinto Soman",
  "Sibin Kurup",
  "Sinoj Panicker",
  "Subin Nath",
  "Thajudeen Chandran",
  "Tijo Varma",
  "Tomy Radhakrishnan",
  "Abhilash Menon",
  "Akhil Pillai",
  "Anand Warrier",
  "Arun Nambiar",
  "Athul Thomas",
  "Biju Mathew",
  "Deepak George",
  "Dileep Joseph",
  "Harikrishnan Paul",
  "Jithin Kumar",
  "Karthik Babu",
  "Manoj Das",
  "Naveen Krishnan",
  "Nikhil Sreekumar",
  "Pradeep Prasad",
  "Rajesh Mohan",
  "Ranjith Rajan",
  "Santhosh Soman",
  "Sreenath Kurup",
  "Sudheesh Panicker",
  "Sujith Nath",
  "Sunil Chandran",
  "Vijesh Varma",
  "Vipin Radhakrishnan",
  "Vishnu Nair",
  "Abhinav Menon",
  "Ajith Pillai",
  "Akshay Warrier",
  "Albin Nambiar",
  "Amal Thomas",
  "Anoop Mathew",
  "Aravind George",
  "Arjun Joseph",
  "Ashwin Paul",
  "Bibin Kumar",
  "Danish Babu",
  "Dhanush Das",
  "Faisal Krishnan",
  "Gokul Sreekumar",
  "Hari Prasad",
  "Harish Mohan",
  "Jagan Rajan",
  "Jaison Soman",
  "Jithesh Kurup",
  "Kiran Panicker",
  "Mahesh Nath",
  "Midhun Chandran",
  "Nandu Varma",
  "Nithin Radhakrishnan",
  "Pranav Nair",
  "Rahul Menon",
  "Rakesh Pillai",
  "Ranjan Warrier",
  "Ratheesh Nambiar",
  "Rohith Thomas",
  "Sachin Mathew",
  "Sandeep George",
  "Sarath Joseph",
  "Shyam Paul",
  "Sijin Kumar",
  "Sreejith Babu",
  "Sreerag Das",
  "Sujin Krishnan",
  "Suresh Sreekumar",
  "Umesh Prasad",
  "Unnikrishnan Mohan",
  "Vimal Rajan",
  "Vinod Soman",
  "Vipul Kurup",
  "Vivek Panicker",
  "Yadhu Nath",
  "Aadarsh Chandran",
  "Adarsh Varma",
  "Afsal Radhakrishnan",
  "Ajeesh Nair",
  "Anoop Menon",
  "Antony Pillai",
  "Arshad Warrier",
  "Ashik Nambiar",
  "Basil Thomas",
  "Bijoy Mathew",
  "Christy George",
  "Denson Joseph",
  "Ebin Paul",
  "Eldho Kumar",
  "Farhan Babu",
  "Firoz Das",
  "Gireesh Krishnan",
  "Haneef Sreekumar",
  "Irfan Prasad",
  "Jafar Mohan"
];

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

const employees = [];

for (let i = 1; i <= 200; i++) {
  employees.push({
    name: employeeNames[i-1],
    employeeId: `EMP${String(i).padStart(4, "0")}`,
    jobTitle: jobTitles[(i - 1) % jobTitles.length],
    monthlySalary: 20000,
    isActive: true,
  });
}

// console.log(JSON.stringify(employees, null, 2));

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

// await jobTitleModel.insertMany(jobtitles);
// await employeeModel.insertMany(employees);


async function createAdmin (name, email, password) {
    const admin = new userModel({name, email, password, role: 'admin'})
    await admin.save()
}

// seeWorkSchedule()
createAdmin('Sheikha', 'Sheikha.ngdp@hotmail.com', "adminngdp@2026", )
createAdmin('Halimafazari', 'halimafazari.ngdp@gmail.com', "adminngdp@2026", )
createAdmin('Lamyakhalfan', 'lamyakhalfan.ngdp@gmail.com', "adminngdp@2026", )
