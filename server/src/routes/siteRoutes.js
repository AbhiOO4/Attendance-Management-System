import express from 'express'

import siteController from '../controllers/siteController.js'

const router = express.Router()

//Admin

// POST /api/sites
// PATCH /api/sites/:siteId/assign-supervisor
// PATCH /api/sites/:siteId/add-employees

router.post('/', siteController.createSite)

router.patch('/:siteId/assign-supervisor', siteController.assignSupervisor)

router.patch('/:siteId/add-employees', siteController.assignEmployees)



export default router