import express from 'express'
import cookieParser from "cookie-parser"
const app = express()

import cors from "cors"

app.use(
  cors({
    origin: "http://localhost:5173", // your frontend
    credentials: true,
  })
) 

import dotenv from 'dotenv'
dotenv.config({quiet: true})

import connectDB from './config/db.js'

app.use(express.json()); // Essential to parse JSON payloads

//Importing routes
import empRoutes from '../src/routes/empRoutes.js'
import userRoutes from '../src/routes/userRoutes.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import siteRoutes from '../src/routes/siteRoutes.js'

app.use(cookieParser())

//Connecting routes
app.use('/api/employees', empRoutes)
app.use('/api/user', userRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/site', siteRoutes)






connectDB().then(() => {
    app.listen(process.env.PORT || 3000, () => {
        console.log(`Server is running on PORT : ${process.env.PORT} `)
    })
})

