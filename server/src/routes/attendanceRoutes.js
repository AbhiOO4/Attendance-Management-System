import express from 'express'

import { verifyToken } from '../middlewares/verifyToken.js'
import attendanceController from '../controllers/attendanceController.js'

const router = express.Router()


//Admin

//prefix : /api/attendance

router.use(verifyToken)

router.post('/submit', attendanceController.bulkSubmitAttendance)

router.get('/reports/daily', attendanceController.getSiteAttendance)

router.patch('/bulk-update', attendanceController.bulkEditAttendance)

router.patch('/unlock', attendanceController.unlockAttendance)

router.get('/reports/monthly', attendanceController.getMonthlyReport)

router.get('/reports/daily-summary', attendanceController.getSummary)

router.patch('/update/set-holiday', attendanceController.toggleHolidayStatus)

router.patch('/update/:attendanceId', attendanceController.updateAttendance)

//GET /attendance?date=2026-05-25&name=abhi&page=1&limit=20
router.get('/', attendanceController.getAttendanceRecords)

router.get('/employee/:employeeId', attendanceController.getEmployeeAttendanceByMonth)



// router.get('/worker/:workerId', Attendance.getWorkerAttendance)



export default router
