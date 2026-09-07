import dotenv from 'dotenv'
dotenv.config({quiet: true})

import express from 'express'
import cookieParser from "cookie-parser"
const app = express()

import cors from "cors"

// TEMPORARY origin audit — remove once the old client link is confirmed dead.
// Logs the first time each distinct Origin/Referer host is seen so the Render
// logs can be grepped for `[ORIGIN-AUDIT]` to spot old-link (*.onrender.com)
// traffic. Runs BEFORE cors so it captures origins cors would otherwise reject.
const seenOrigins = new Set();
app.use((req, res, next) => {
  const origin = req.headers.origin || req.headers.referer || "(none)";
  if (!seenOrigins.has(origin)) {
    seenOrigins.add(origin);
    console.log(
      `[ORIGIN-AUDIT] first seen: ${origin} | ua: ${req.headers["user-agent"] || "?"} | path: ${req.method} ${req.originalUrl}`
    );
  }
  next();
});

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
import { startCheckoutReminderCron } from './cron/checkoutReminder.js'
import { startExpireTransferRequestsCron } from './cron/expireTransferRequests.js'
// Night check-in is now pre-filled when a night shift is assigned (see
// assignNightShift), so the auto check-in cron is no longer scheduled.

app.use(express.json()); // Essential to parse JSON payloads
//Importing routes
import empRoutes from '../src/routes/empRoutes.js'
import userRoutes from '../src/routes/userRoutes.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import siteRoutes from '../src/routes/siteRoutes.js'
import configRoutes from '../src/routes/configRoutes.js'
import requestRoutes from '../src/routes/requestRoutes.js'

app.use(cookieParser())

//Connecting routes
app.use('/api/employees', empRoutes)
app.use('/api/user', userRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/site', siteRoutes)
app.use('/api/config', configRoutes)
app.use('/api/requests', requestRoutes)






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
    startCheckoutReminderCron();
    startExpireTransferRequestsCron();
    app.listen(process.env.PORT || 3000, () => {
        console.log(`Server is running on PORT : ${process.env.PORT} `)
    })
})

