import express from 'express'
import { authorizeRoles } from '../middlewares/rbac.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import configController from '../controllers/configController.js'


const router = express.Router()

router.use(verifyToken)

router.use(authorizeRoles("admin"))


//Prefix /api/config

//Getting the single doc 
router.get('/', configController.getWorkSchedule)//


//Update work schedule
router.patch('/update', configController.updateWorkSchedule) //


//add custom holidays
router.post('/custom-holidays', configController.addCustomHoliday)//


//delete custom holiday
router.delete('/custom-holidays/:holidayId', configController.deleteCustomHoliday)//


//get all then holiday //take month and year as query
router.get('/custom-holidays', configController.getAllHolidays)//


//check whether the date is a custom holiday  //takes date as query
router.get('/custom-holidays/check', configController.isHoliday)



export default router