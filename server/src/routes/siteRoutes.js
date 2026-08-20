import express from 'express'

import siteController from '../controllers/siteController.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles, requireSiteAccess } from '../middlewares/rbac.js'

const router = express.Router()

router.use(verifyToken)

// --- READ-ONLY routes (accessible by both Admin and Supervisor globally) ---
router.get('/', authorizeRoles("admin", "supervisor"), siteController.getSites)
router.get('/:id', authorizeRoles("admin", "supervisor"), siteController.getSite)
router.get('/:siteId/site-data', authorizeRoles("admin", "supervisor"), siteController.siteManHoursAndDays)
router.get('/job/:jobId', authorizeRoles("admin", "supervisor"), siteController.getJob)
router.get('/:jobId/job-data', authorizeRoles("admin", "supervisor"), siteController.jobManHoursAndDays)
router.get('/:siteId/Jobs', authorizeRoles("admin", "supervisor"), siteController.getSiteJobs)
router.get('/:siteId/employees', authorizeRoles("admin", "supervisor"), siteController.getAvailableEmployeesForSite)
router.get('/job/:jobId/employees', authorizeRoles("admin", "supervisor"), siteController.getJobEmployees)
router.get('/:siteId/free-employees', authorizeRoles("admin", "supervisor"), siteController.getUnassignedSiteEmployees)
router.post('/:siteId/check-pending', authorizeRoles("admin", "supervisor"), siteController.checkPending)

// --- SUPERVISOR & ADMIN WRITE routes (restricted to assigned site for Supervisor) ---
router.post('/:siteId/insta-add-employee', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.instaAddEmployee)
router.patch('/job/:jobId/status', authorizeRoles("admin", "supervisor"), siteController.changeJobStatus)
router.patch('/job/:jobId/toggle-completed', authorizeRoles("admin", "supervisor"), siteController.toggleJobCompleted)
router.patch('/:siteId/remove-employee', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.removeEmployee)
router.patch('/:siteId/schedule-removal', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.scheduleEmployeeRemoval)

// --- ADMIN ONLY routes ---
router.post('/', authorizeRoles("admin"), siteController.createSite)
router.patch('/:siteId/assign-supervisor', authorizeRoles("admin"), siteController.assignSupervisor)
router.patch('/:siteId/remove-supervisor', authorizeRoles("admin"), siteController.removeSupervisor)
router.patch('/:siteId/add-employee', authorizeRoles("admin"), siteController.assignEmployee)
router.patch("/deactivate/:siteId", authorizeRoles("admin"), siteController.deactivateSite)
router.patch("/reactivate/:siteId", authorizeRoles("admin"), siteController.reactivateSite)
router.delete("/:siteId", authorizeRoles("admin"), siteController.deleteSite)
router.delete("/job/:jobId", authorizeRoles("admin"), siteController.deleteJob)
router.post('/:siteId/add-job', authorizeRoles("admin"), siteController.addJob)
router.delete('/job/:jobId/remove-employee', authorizeRoles("admin"), siteController.removeEmployeeFromJob)
router.post('/job/:jobId/add-employee', authorizeRoles("admin"), siteController.addEmployeeToJob)
router.patch('/:siteId/employees/job', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.bulkSetEmployeeJob)
router.patch('/:siteId/employee/:employeeId/job', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.updateEmployeeJob)
router.delete('/:siteId/employee/:employeeId/scheduled', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.cancelScheduledAssignment)
router.patch('/:siteId', authorizeRoles("admin", "supervisor"), requireSiteAccess, siteController.updateSite)

export default router