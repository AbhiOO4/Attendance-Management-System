import dotenv from 'dotenv'
dotenv.config({quiet: true})

import express from 'express'
import cookieParser from "cookie-parser"
const app = express()

import cors from "cors"

app.use(
  cors({
    origin: [process.env.CLIENT_URL, process.env.CLIENT_URL_2],
    credentials: true,
  })
)

import connectDB from './config/db.js'
import Site from './models/siteModel.js'
import { startAutoCheckOutCron } from './cron/autoCheckOut.js'
import { startApplyScheduledAssignmentsCron } from './cron/applyScheduledAssignments.js'
// Night check-in is now pre-filled when a night shift is assigned (see
// assignNightShift), so the auto check-in cron is no longer scheduled.

app.use(express.json()); // Essential to parse JSON payloads
//Importing routes
import empRoutes from '../src/routes/empRoutes.js'
import userRoutes from '../src/routes/userRoutes.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import siteRoutes from '../src/routes/siteRoutes.js'
import configRoutes from '../src/routes/configRoutes.js'

app.use(cookieParser())

//Connecting routes
app.use('/api/employees', empRoutes)
app.use('/api/user', userRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/site', siteRoutes)
app.use('/api/config', configRoutes)






const initializePermanentSite = async () => {
  try {
    const siteName = "Workshop Phase 7";
    const existing = await Site.findOne({ siteName: { $regex: new RegExp(`^${siteName}$`, 'i') } });
    if (!existing) {
      await Site.create({
        siteName,
        locationDetails: "Main Office & Workshop (Permanent Site)",
        isPermanent: true,
        isActive: true,
      });
      console.log(`Permanent site '${siteName}' created.`);
    } else if (!existing.isPermanent) {
      existing.isPermanent = true;
      await existing.save();
      console.log(`Site '${siteName}' updated to permanent.`);
    }
  } catch (error) {
    console.error("Failed to initialize permanent site:", error);
  }
};

connectDB().then(async () => {
    await initializePermanentSite();
    startAutoCheckOutCron();
    startApplyScheduledAssignmentsCron();
    app.listen(process.env.PORT || 3000, () => {
        console.log(`Server is running on PORT : ${process.env.PORT} `)
    })
})

