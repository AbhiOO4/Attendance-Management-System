import express from 'express'

import Attendance from '../controllers/attendanceController.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import attendanceController from '../controllers/attendanceController.js'

const router = express.Router()


//Admin

//prefix : /api/attendance

router.use(verifyToken)

router.post('/submit', Attendance.bulkSubmitAttendance)

router.get('/reports/daily', Attendance.getSiteAttendance)

router.patch('/bulk-update', Attendance.bulkEditAttendance)

router.patch('/unlock', Attendance.unlockAttendance)

router.get('/reports/monthly', Attendance.getMonthlyReport)

router.get('/reports/daily-summary', Attendance.getSummary)

router.patch('/update/set-holiday', Attendance.toggleHolidayStatus)

router.patch('/update/:attendanceId', Attendance.updateAttendance)

//GET /attendance?date=2026-05-25&name=abhi&page=1&limit=20
router.get('/', attendanceController.getAttendanceRecords)



// router.get('/worker/:workerId', Attendance.getWorkerAttendance)



export default router
