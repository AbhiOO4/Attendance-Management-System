import express from 'express'

import Attendance from '../controllers/attendanceController.js'

const router = express.Router()


//Admin

//prefix : /api/attendance

router.post('/submit', Attendance.submitDaily)

router.patch('/bulk-update', Attendance.bulkUpdateAttendance)

router.patch('/unlock', Attendance.unlockAttendance)

router.get('/reports/monthly', Attendance.getMonthlyReport)

// router.get('/', Attendance.getDaily)

// router.get('/daily-summary', Attendance.getSummary)

// router.get('/worker/:workerId', Attendance.getWorkerAttendance)



export default router