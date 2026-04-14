import express from 'express'

import Attendance from '../controllers/attendanceController.js'

const router = express.Router()


//Admin

// GET /api/attendance/report?month=04&year=2026
// GET /api/attendance?date=2026-04-14
// GET api/attendance/daily-summary
// GET /api/attendance/worker/:workerId
// PUT /api/attendance/admin-override/:id


router.get('/report', Attendance.getMonthly)

router.get('/', Attendance.getDaily)

router.get('/daily-summary', Attendance.getSummary)

router.get('/worker/:workerId', Attendance.getWorkerAttendance)

router.put('/admin-override/:id',  Attendance.editAttendanceAfterFreeze)



//supervisor

// GET /api/attendance/by-site/:siteId ?date=2026-04-14
// GET /api/attendance/by-site/:siteId/monthly ?month=04&year=2026
// POST /api/attendance/submit
// PATCH /api/attendance/update/:id


router.get('/by-site/:siteId', Attendance.getDailyBySite)

router.get('/by-site/:siteId/monthly', Attendance.getMonthlyBySite)

router.post('/submit', Attendance.confirmAttendance )

router.patch('/update/:id', Attendance.editAttendance)



export default router