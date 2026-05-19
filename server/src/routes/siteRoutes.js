import express from 'express'

import siteController from '../controllers/siteController.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'

const router = express.Router()

//Admin

// POST /api/site
// PATCH /api/site/:siteId/assign-supervisor
// PATCH /api/site/:siteId/add-employees

router.use(verifyToken)

router.use(authorizeRoles("admin"))

router.get('/', siteController.getSites) //

router.get('/:id', siteController.getSite) //

router.post('/', siteController.createSite) // server validation req

router.patch('/:siteId/assign-supervisor', siteController.assignSupervisor) // sever validation req

router.patch('/:siteId/remove-supervisor', siteController.removeSupervisor) // sever validation req

router.patch('/:siteId/add-employee', siteController.assignEmployee) // sever validation req

router.patch('/:siteId/remove-employee', siteController.removeEmployee) // sever validation req

router.post('/:siteId/check-pending', siteController.checkPending)//

router.get('/:siteId/site-data',siteController.siteManHoursAndDays)

router.patch("/deactivate/:siteId", siteController.deactivateSite)//

router.patch("/reactivate/:siteId",siteController.reactivateSite)//

//Job routes

router.post('/:siteId/add-job', siteController.addJob)//

router.delete('/:jobId/remove-employee', siteController.removeEmployeeFromJob)//

router.post('/:jobId/add-employee', siteController.addEmployeeToJob)//

router.get('/:jobId/job-data', siteController.jobManHoursAndDays)//

router.get('/:siteId/Jobs', siteController.getSiteJobs)//










export default router