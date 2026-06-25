import express from 'express'
import userModel from '../models/userModel.js'
import { getMe, getUsers, login, logout, updateUser, addAdmin, demoLogin, deleteUser } from '../controllers/userController.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'

const router = express.Router()



//current user check
router.get("/me", verifyToken, getMe)

//login
router.post('/login', login)

router.post('/demo-login', demoLogin)

router.post('/logout', logout)

router.use(verifyToken)

router.patch('/update/:userId',authorizeRoles('superadmin'), updateUser )

router.post('/admin', authorizeRoles('superadmin'), addAdmin)

router.get('/',authorizeRoles('superadmin'), getUsers)

router.delete('/:userId', authorizeRoles('superadmin'), deleteUser)

export default router