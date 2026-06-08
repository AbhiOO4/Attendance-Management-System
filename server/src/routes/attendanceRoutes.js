import express from 'express'

import { verifyToken } from '../middlewares/verifyToken.js'
import attendanceController from '../controllers/attendanceController.js'

const router = express.Router()

//prefix : /api/attendance

router.use(verifyToken)

// --- Specific routes FIRST (must come before /:attendanceId wildcard) ---

router.post('/submit', attendanceController.siteFirstSubmitAttendance)

router.get('/dashboard', attendanceController.getSummary)

router.get('/reports/daily', attendanceController.getSiteAttendance)

router.get('/reports/monthly/:month/:year', attendanceController.monthlyReport)

router.get('/employee/:employeeId', attendanceController.getEmployeeAttendanceByMonth)

// Backfill
router.get('/missing', attendanceController.getMissingEmployees)

router.post('/backfill', attendanceController.backfillAttendance)

// GET /attendance?date=2026-05-25&name=abhi&page=1&limit=20
router.get('/', attendanceController.getAttendanceRecords)

router.patch('/bulk-update', attendanceController.bulkEditAttendance)

router.patch('/unlock', attendanceController.unlockAttendance)

router.patch('/update/set-holiday', attendanceController.toggleHolidayStatus)

router.patch('/update/:attendanceId', attendanceController.updateAttendance)

router.post('/:attendanceId/sessions', attendanceController.addSessionToAttendance)

// --- Wildcard route LAST ---
router.get('/:attendanceId', attendanceController.getAttendanceById)

export default router
