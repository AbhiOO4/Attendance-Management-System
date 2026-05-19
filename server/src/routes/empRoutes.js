import express from 'express'

import empController from '../controllers/empController.js'

import { employeeValidation } from '../middlewares/validation.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'

const router = express.Router()


//Admin

// GET /api/employees
// POST /api/employees/add
// POST /api/employees/add/Supervisors
// PATCH /api/employees/:id 

router.use(verifyToken)

router.get('/', authorizeRoles("admin"), empController.getAllEmployees)// 

router.post('/', authorizeRoles("admin"), employeeValidation, empController.addEmployee)// 

router.get('/Supervisors', authorizeRoles("admin"), empController.getSupervisors)//

router.get('/:id', authorizeRoles("admin"), empController.getEmployee)//

router.put('/:id', authorizeRoles("admin"), employeeValidation ,  empController.editEmployee)// 

router.delete('/:id', authorizeRoles("admin"), empController.deleteEmployee)//

router.post('/Supervisor', authorizeRoles("admin"), empController.addSupervisor)// 

router.delete('/Supervisor/:id', authorizeRoles("admin"), empController.deleteSupervisor)





//Supervisor

// GET /api/workers/by-site/:siteId

router.get('/by-site/:siteId', empController.getEmployeeBySite) 





export default router