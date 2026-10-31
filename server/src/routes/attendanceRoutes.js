import express from 'express'

import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles, requireSiteAccess } from '../middlewares/rbac.js'
import attendanceController from '../controllers/attendanceController.js'
import * as draftController from '../controllers/draftController.js'
import * as leaveAllocationController from '../controllers/leaveAllocationController.js'

const router = express.Router()

//prefix : /api/attendance

router.use(verifyToken)

// --- Specific routes FIRST (must come before /:attendanceId wildcard) ---

router.post('/submit', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, attendanceController.siteFirstSubmitAttendance)

// Shared cloud draft of a site's unsubmitted day (404 while CLOUD_DRAFT_ENABLED is off).
router.get('/draft', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, draftController.getDraft)

router.put('/draft/rows', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, draftController.saveDraftRows)

router.get('/dashboard', authorizeRoles("admin", "supervisor"), attendanceController.getSummary)

router.get('/dashboard/active-sites', authorizeRoles("admin", "supervisor"), attendanceController.getActiveSitesOverview)

router.get('/reports/daily', authorizeRoles("admin", "supervisor", "driverSupervisor"), attendanceController.getSiteAttendance)

// Employee-scoped carryover fetch: the prior-day open shifts of the employees rostered
// at this site TODAY, wherever those shifts physically live (the "follow the employee"
// flow). Site-scoped by the queried siteId, so requireSiteAccess confines a supervisor
// to their own site.
router.get('/reports/carryovers', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, attendanceController.getSiteCarryovers)

router.get('/reports/monthly/:month/:year', authorizeRoles("admin"), attendanceController.monthlyReport)

// The same hours report over any from–to span of business days (?from&to, YYYY-MM-DD, max a year).
router.get('/reports/range', authorizeRoles("admin"), attendanceController.rangeReport)

// ERPNext Data Import CSV export. Body { type: attendance|timesheet, employeeIds } —
// POST because the picked employee list can outgrow a query string. admin + superadmin,
// from the Timesheets page; APPROVED timesheets only (409 TIMESHEET_NOT_APPROVED).
router.post('/reports/erpnext/:month/:year', authorizeRoles("admin"), attendanceController.exportErpnext)

// Per-employee ERPNext export (same CSVs, scoped to one employee for easier testing).
// admin + superadmin — lives on the employee timesheet page. Approved timesheets only.
router.get('/employee/:employeeId/erpnext/:month/:year', authorizeRoles("admin"), attendanceController.exportErpnext)

// --- Leave: annual allocations + leave applications (admin implicitly allows superadmin) ---
// Specific /leave/* paths declared before the /:attendanceId wildcard, and the
// /leave/allocations paths before /leave/:leaveId.
router.get('/leave/allocations', authorizeRoles("admin"), leaveAllocationController.listAllocations)
router.post('/leave/allocations', authorizeRoles("admin"), leaveAllocationController.createAllocation)
router.patch('/leave/allocations/:id', authorizeRoles("admin"), leaveAllocationController.updateAllocation)
router.delete('/leave/allocations/:id', authorizeRoles("admin"), leaveAllocationController.deleteAllocation)

router.get('/leave/balance/:employeeId', authorizeRoles("admin"), attendanceController.getLeaveBalance)

router.get('/leave/preview', authorizeRoles("admin"), attendanceController.previewLeave)

// Read-only leave lookup for a date — supervisors need it to lock leave rows on the
// Site Attendance page (declared before the /:attendanceId wildcard).
router.get('/leave/on-date', authorizeRoles("admin", "supervisor", "driverSupervisor"), attendanceController.getEmployeesOnLeaveForDate)

router.get('/leave/employee/:employeeId', authorizeRoles("admin"), attendanceController.listEmployeeLeaves)

router.get('/leave', authorizeRoles("admin"), attendanceController.listLeaves)

router.post('/leave', authorizeRoles("admin"), attendanceController.grantLeave)

router.put('/leave/:leaveId', authorizeRoles("admin"), attendanceController.updateLeave)

router.patch('/leave/:leaveId/cancel', authorizeRoles("admin"), attendanceController.cancelLeave)

router.delete('/leave/:leaveId', authorizeRoles("admin"), attendanceController.deleteLeave)

router.get('/reports/job-report', authorizeRoles("admin"), attendanceController.jobReport)

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
router.get('/night-shift/candidates', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, attendanceController.getNightShiftCandidates)

router.post('/night-shift/assign', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, attendanceController.assignNightShift)

// Employee transfer between sites. Not using requireSiteAccess since it only
// validates a single siteId; access is checked manually against fromSiteId
// inside the controller.
router.post('/transfer', authorizeRoles("admin", "supervisor"), attendanceController.transferEmployee)

// GET /attendance?date=2026-05-25&name=abhi&page=1&limit=20
router.get('/', authorizeRoles("admin", "supervisor"), attendanceController.getAttendanceRecords)

router.patch('/unlock', authorizeRoles("admin"), attendanceController.unlockAttendance)

router.patch('/update/set-holiday', authorizeRoles("admin"), attendanceController.toggleHolidayStatus)

router.patch('/update/:attendanceId', authorizeRoles("admin", "supervisor", "driverSupervisor"), attendanceController.updateAttendance)

router.post('/:attendanceId/sessions', authorizeRoles("admin", "supervisor"), attendanceController.addSessionToAttendance)

// Per-record edit log + supervisor remark. Site-scope for supervisors is enforced inside
// the controller (the param is an attendance id, not a site id, so requireSiteAccess can't).
router.get('/:attendanceId/history', authorizeRoles("admin", "supervisor", "driverSupervisor"), attendanceController.getAttendanceHistory)

router.patch('/:attendanceId/remark', authorizeRoles("admin", "supervisor", "driverSupervisor"), attendanceController.updateAttendanceRemark)

// --- Wildcard route LAST ---
router.get('/:attendanceId', authorizeRoles("admin", "supervisor", "driverSupervisor"), attendanceController.getAttendanceById)

export default router

