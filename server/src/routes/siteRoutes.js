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

router.get('/', authorizeRoles("admin"),  siteController.getSites) 

router.get('/:id',authorizeRoles("admin"), siteController.getSite) 

router.post('/',authorizeRoles("admin"), siteController.createSite) // server validation req

router.patch('/:siteId/assign-supervisor', authorizeRoles("admin"), siteController.assignSupervisor) // sever validation req

router.patch('/:siteId/remove-supervisor', authorizeRoles("admin"), siteController.removeSupervisor) // sever validation req

router.patch('/:siteId/add-employee', authorizeRoles("admin"), siteController.assignEmployee) // sever validation req

router.patch('/:siteId/remove-employee', authorizeRoles("admin"), siteController.removeEmployee) // sever validation req



export default router