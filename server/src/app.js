// The Express app — middleware + routes, with no DB connection, crons or listen, so tests
// can mount it (supertest) against their own database. server.js boots it.
// dotenv runs here, not in server.js: ES imports are hoisted, so server.js's own
// dotenv.config() would run AFTER this module read CLIENT_URL for cors.
import dotenv from 'dotenv'
dotenv.config({quiet: true})

import express from 'express'
import cookieParser from "cookie-parser"
const app = express()

import cors from "cors"

// How many proxies sit between visitors and this app, so req.ip (the login rate limit's key)
// is the visitor rather than the host's proxy. Too low is the safe mistake: everyone looks
// like one network. Too high lets a caller fake their address. Never set this to `true`.
const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "", 10);
app.set("trust proxy", Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 1);

app.use(
  cors({
    origin: [process.env.CLIENT_URL, process.env.CLIENT_URL_2],
    credentials: true,
    // The ERPNext export reports hours it could not place in the file through these
    // headers (see exportErpnext); a cross-origin client can only read exposed headers.
    exposedHeaders: [
      "X-Erpnext-Skipped-No-Job",
      "X-Erpnext-Skipped-Hours",
      "X-Erpnext-Unallocated-Activity",
      "X-Erpnext-Dropped-Overtime-Hours",
      "X-Erpnext-Dropped-Holiday-Hours",
    ],
  })
)

app.use(express.json()); // Essential to parse JSON payloads
//Importing routes
import empRoutes from '../src/routes/empRoutes.js'
import userRoutes from '../src/routes/userRoutes.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import siteRoutes from '../src/routes/siteRoutes.js'
import configRoutes from '../src/routes/configRoutes.js'
import requestRoutes from '../src/routes/requestRoutes.js'
import driverRoutes from '../src/routes/driverRoutes.js'
import jobRoutes from '../src/routes/jobRoutes.js'
import activityTypeRoutes from '../src/routes/activityTypeRoutes.js'
import backfillRequestRoutes from '../src/routes/backfillRequestRoutes.js'
import timesheetRoutes from '../src/routes/timesheetRoutes.js'

app.use(cookieParser())

// API responses are live state (rosters, locks, attendance) — never let a browser, webview
// or proxy cache serve an old copy. The PWA service worker doesn't cache /api either.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

//Connecting routes
app.use('/api/employees', empRoutes)
app.use('/api/user', userRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/site', siteRoutes)
app.use('/api/config', configRoutes)
app.use('/api/requests', requestRoutes)
app.use('/api/drivers', driverRoutes)
app.use('/api/jobs', jobRoutes)
app.use('/api/activity-types', activityTypeRoutes)
app.use('/api/backfill-requests', backfillRequestRoutes)
app.use('/api/timesheets', timesheetRoutes)

export default app
