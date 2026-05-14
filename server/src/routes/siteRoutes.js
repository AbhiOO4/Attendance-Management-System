import express from 'express'

import siteController from '../controllers/siteController.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'

const router = express.Router()

//Admin

// POST /api/site
// PATCH /api/site/:siteId/assign-supervisor
// PATCH /api/site/:siteId/add-employees

// router.use(verifyToken)

// router.use(authorizeRoles("admin"))

router.get('/', siteController.getSites) 

router.get('/:id', siteController.getSite) 

router.post('/', siteController.createSite) // server validation req

router.patch('/:siteId/assign-supervisor', siteController.assignSupervisor) // sever validation req

router.patch('/:siteId/remove-supervisor', siteController.removeSupervisor) // sever validation req

router.patch('/:siteId/add-employee', siteController.assignEmployee) // sever validation req

router.patch('/:siteId/remove-employee', siteController.removeEmployee) // sever validation req

//Job routes







export default router