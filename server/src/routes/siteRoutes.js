import express from 'express'

import siteController from '../controllers/siteController.js'

const router = express.Router()

//Admin

// POST /api/sites
// PATCH /api/sites/:siteId/assign-supervisor
// PATCH /api/sites/:siteId/add-employees

router.post('/', siteController.createSite) // server validation req

router.patch('/:siteId/assign-supervisor', siteController.assignSupervisor) // sever validation req

router.patch('/:siteId/remove-supervisor', siteController.removeSupervisor) // sever validation req

router.patch('/:siteId/add-employee', siteController.assignEmployee) // sever validation req

router.patch('/:siteId/remove-employee', siteController.removeEmployee) // sever validation req



export default router