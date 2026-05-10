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

router.post('/', employeeValidation, empController.addEmployee)// 

router.get('/Supervisors', empController.getSupervisors)//

router.get('/:id', empController.getEmployee)//

router.put('/:id',employeeValidation, empController.editEmployee)// 

router.delete('/:id', empController.deleteEmployee)//

router.post('/Supervisor', empController.addSupervisor)// 

router.delete('/Supervisor/:id', empController.deleteSupervisor)





//Supervisor

// GET /api/workers/by-site/:siteId

router.get('/by-site/:siteId', empController.getEmployeeBySite)





export default router