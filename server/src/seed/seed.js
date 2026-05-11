
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


async function createAdmin (name, email, password) {
    const admin = new userModel({name, email, password, role: 'admin'})
    await admin.save()
}

createAdmin('Abhi', 'abhinavsree243@gmail.com', "abhi@123", )