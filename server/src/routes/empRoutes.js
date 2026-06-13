import express from 'express'

import empController from '../controllers/empController.js'

import { employeeValidation, supervisorValidation } from '../middlewares/validation.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles, requireSiteAccess } from '../middlewares/rbac.js'

const router = express.Router()


//Admin

// GET /api/employees
// POST /api/employees/add
// POST /api/employees/add/Supervisors
// PATCH /api/employees/:id 

router.use(verifyToken)

router.get('/', authorizeRoles("admin","supervisor"), empController.getAllEmployees)// 

router.post('/', authorizeRoles("admin"), employeeValidation, empController.addEmployee)// 

router.get('/Supervisors', authorizeRoles("admin"), empController.getSupervisors)//

router.get('/jobTitles', authorizeRoles('admin'), empController.getJobTitles)

router.post('/jobTitles', authorizeRoles('admin'), empController.addJobTitle)

router.delete('/jobTitles/:id', authorizeRoles('admin'), empController.deleteJobTitle)

router.get('/:id', authorizeRoles("admin"), empController.getEmployee)//

router.put('/:id', authorizeRoles("admin"), employeeValidation ,  empController.editEmployee)// 

router.delete('/:id', authorizeRoles("admin"), empController.deleteEmployee)//

router.post('/Supervisor', authorizeRoles("admin"), supervisorValidation, empController.addSupervisor)// 

router.delete('/Supervisor/:id', authorizeRoles("admin"), empController.deleteSupervisor)







//Supervisor

// GET /api/workers/by-site/:siteId

router.get('/by-site/:siteId', authorizeRoles("admin", "supervisor"), requireSiteAccess, empController.getEmployeeBySite) 





export default router