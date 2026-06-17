import express from 'express'

import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles, requireSiteAccess } from '../middlewares/rbac.js'
import attendanceController from '../controllers/attendanceController.js'

const router = express.Router()

//prefix : /api/attendance

router.use(verifyToken)

// --- Specific routes FIRST (must come before /:attendanceId wildcard) ---

router.post('/submit', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.siteFirstSubmitAttendance)

router.get('/dashboard', authorizeRoles("admin", "supervisor"), attendanceController.getSummary)

router.get('/dashboard/active-sites', authorizeRoles("admin", "supervisor"), attendanceController.getActiveSitesOverview)

router.get('/reports/daily', authorizeRoles("admin", "supervisor"), attendanceController.getSiteAttendance)

router.get('/reports/monthly/:month/:year', authorizeRoles("admin"), attendanceController.monthlyReport)

router.get('/employee/:employeeId', authorizeRoles("admin", "supervisor"), attendanceController.getEmployeeAttendanceByMonth)

// Backfill
router.get('/missing', authorizeRoles("admin", "supervisor"), attendanceController.getMissingEmployees)

router.post('/backfill', authorizeRoles("admin"), attendanceController.backfillAttendance)

// Night shift bulk assignment
router.get('/night-shift/candidates', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.getNightShiftCandidates)

router.post('/night-shift/assign', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.assignNightShift)

// GET /attendance?date=2026-05-25&name=abhi&page=1&limit=20
router.get('/', authorizeRoles("admin", "supervisor"), attendanceController.getAttendanceRecords)

router.patch('/bulk-update', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.bulkEditAttendance)

router.patch('/unlock', authorizeRoles("admin"), attendanceController.unlockAttendance)

router.patch('/update/set-holiday', authorizeRoles("admin"), attendanceController.toggleHolidayStatus)

router.patch('/update/:attendanceId', authorizeRoles("admin", "supervisor"), attendanceController.updateAttendance)

router.post('/:attendanceId/sessions', authorizeRoles("admin", "supervisor"), attendanceController.addSessionToAttendance)

// --- Wildcard route LAST ---
router.get('/:attendanceId', authorizeRoles("admin", "supervisor"), attendanceController.getAttendanceById)

export default router

