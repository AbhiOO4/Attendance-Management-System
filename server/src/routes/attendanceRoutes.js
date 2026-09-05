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

// Employee-scoped carryover fetch: the prior-day open shifts of the employees rostered
// at this site TODAY, wherever those shifts physically live (the "follow the employee"
// flow). Site-scoped by the queried siteId, so requireSiteAccess confines a supervisor
// to their own site.
router.get('/reports/carryovers', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.getSiteCarryovers)

router.get('/reports/monthly/:month/:year', authorizeRoles("superadmin"), attendanceController.monthlyReport)

router.get('/reports/job-report', authorizeRoles("superadmin"), attendanceController.jobReport)

router.get('/employee/:employeeId', authorizeRoles("admin", "supervisor"), attendanceController.getEmployeeAttendanceByMonth)

// Cross-site visibility for the instant Add-Employee modal: an employee's sessions for a
// day across all sites (read-only). Not site-scoped — it intentionally reveals other
// sites' sessions so the adding supervisor can spot a same-day conflict before check-in.
router.get('/employee-day-sessions', authorizeRoles("admin", "supervisor"), attendanceController.getEmployeeDaySessions)

// Backfill
router.get('/missing', authorizeRoles("admin", "supervisor"), attendanceController.getMissingEmployees)

router.post('/backfill', authorizeRoles("admin"), attendanceController.backfillAttendance)

router.post('/backfill/bulk', authorizeRoles("admin"), attendanceController.bulkBackfillAttendance)

// Bulk close open (checked-in, no check-out) sessions with one shared check-out time —
// the Edit-Past-Attendance recovery tool for sessions the auto-checkout cron never closed.
router.post('/bulk-checkout', authorizeRoles("admin"), attendanceController.bulkCheckout)

// Night shift bulk assignment
router.get('/night-shift/candidates', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.getNightShiftCandidates)

router.post('/night-shift/assign', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.assignNightShift)

// Employee transfer between sites. Not using requireSiteAccess since it only
// validates a single siteId; access is checked manually against fromSiteId
// inside the controller.
router.post('/transfer', authorizeRoles("admin", "supervisor"), attendanceController.transferEmployee)

// GET /attendance?date=2026-05-25&name=abhi&page=1&limit=20
router.get('/', authorizeRoles("admin", "supervisor"), attendanceController.getAttendanceRecords)

router.patch('/bulk-update', authorizeRoles("admin", "supervisor"), requireSiteAccess, attendanceController.bulkEditAttendance)

router.patch('/unlock', authorizeRoles("admin"), attendanceController.unlockAttendance)

router.patch('/update/set-holiday', authorizeRoles("admin"), attendanceController.toggleHolidayStatus)

router.patch('/update/:attendanceId', authorizeRoles("admin", "supervisor"), attendanceController.updateAttendance)

router.post('/:attendanceId/sessions', authorizeRoles("admin", "supervisor"), attendanceController.addSessionToAttendance)

// Per-record edit log + supervisor remark. Site-scope for supervisors is enforced inside
// the controller (the param is an attendance id, not a site id, so requireSiteAccess can't).
router.get('/:attendanceId/history', authorizeRoles("admin", "supervisor"), attendanceController.getAttendanceHistory)

router.patch('/:attendanceId/remark', authorizeRoles("admin", "supervisor"), attendanceController.updateAttendanceRemark)

// --- Wildcard route LAST ---
router.get('/:attendanceId', authorizeRoles("admin", "supervisor"), attendanceController.getAttendanceById)

export default router

