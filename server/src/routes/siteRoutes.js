import express from 'express'

const router = express.Router()

//Admin

// POST /api/sites
// PATCH /api/sites/:siteId/assign-supervisor
// PATCH /api/sites/:siteId/add-employees

router.post('/', createSite())

router.patch('/:siteId/assign-supervisor', assignSupervisor())

router.patch('/:siteId/add-employees', assignEmployees())



export default router