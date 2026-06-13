import express from 'express'
import { authorizeRoles } from '../middlewares/rbac.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import configController from '../controllers/configController.js'

const router = express.Router()

router.use(verifyToken)

//Prefix /api/config

//Getting the single doc 
router.get('/', authorizeRoles("admin", "supervisor"), configController.getWorkSchedule)

//get all custom holidays //take month and year as query
router.get('/custom-holidays', authorizeRoles("admin", "supervisor"), configController.getAllHolidays)

//check whether the date is a custom holiday  //takes date as query
router.get('/custom-holidays/check', authorizeRoles("admin", "supervisor"), configController.isHoliday)

//Update work schedule
router.patch('/update', authorizeRoles("admin"), configController.updateWorkSchedule)

//add custom holidays
router.post('/custom-holidays', authorizeRoles("admin"), configController.addCustomHoliday)

//delete custom holiday
router.delete('/custom-holidays/:holidayId', authorizeRoles("admin"), configController.deleteCustomHoliday)

export default router