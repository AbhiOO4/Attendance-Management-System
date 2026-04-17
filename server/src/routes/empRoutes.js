import express from 'express'

import empController from '../controllers/empController.js'

import { employeeValidation } from '../middlewares/validation.js'

const router = express.Router()


//Admin

// GET /api/employees
// POST /api/employees/add
// POST /api/employees/add/Supervisors
// PATCH /api/employees/:id 

router.get('/',  empController.getAllEmployees)//

router.get('/:id', empController.getEmployee)//

router.post('/add', employeeValidation, empController.addEmployee)// 

router.put('/:id', empController.editEmployee)// server validation req

router.delete('/:id', empController.deleteEmployee)//

router.post('/add/Supervisors', empController.addSupervisor)//  server validation req




//Supervisor

// GET /api/workers/by-site/:siteId

router.get('/by-site/:siteId', empController.getEmployeeBySite)





export default router