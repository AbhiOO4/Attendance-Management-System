import express from 'express'

import empController from '../controllers/empController.js'

const router = express.Router()


//Admin

// GET /api/workers
// POST /api/workers/add
// POST /api/workers/add/Supervisors
// PATCH /api/workers/:id 

router.get('/', empController.getAllEmployees)

router.post('/add', empController.addEmployee)

router.post('/add/Supervisors', empController.addSupervisor)

router.patch('/:id ', empController.getEmployee)


//Supervisor

// GET /api/workers/by-site/:siteId

router.get('/by-site/:siteId', empController.getEmployeeBySite)





export default router