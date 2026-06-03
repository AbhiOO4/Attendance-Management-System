import express from 'express'
import userModel from '../models/userModel.js'
import { getMe, getUsers, login, logout, updateUser } from '../controllers/userController.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'

const router = express.Router()



//current user check
router.get("/me", verifyToken, getMe)

//login
router.post('/login', login)

router.post('/logout', logout)

router.use(verifyToken)

router.patch('/update/:userId',authorizeRoles('admin'), updateUser )

router.get('/',authorizeRoles('admin'), getUsers)



export default router