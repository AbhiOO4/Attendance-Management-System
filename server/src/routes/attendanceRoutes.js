import express from 'express'

import Attendance from '../controllers/attendanceController.js'
import { verifyToken } from '../middlewares/verifyToken.js'

const router = express.Router()


//Admin

//prefix : /api/attendance

router.use(verifyToken)

router.post('/submit', Attendance.submitDaily)

router.patch('/bulk-update', Attendance.bulkUpdateAttendance)

router.patch('/unlock', Attendance.unlockAttendance)

router.get('/reports/monthly', Attendance.getMonthlyReport)

router.get('/reports/daily', Attendance.getDaily)

router.get('/reports/daily-summary', Attendance.getSummary)

// router.get('/worker/:workerId', Attendance.getWorkerAttendance)



export default router
