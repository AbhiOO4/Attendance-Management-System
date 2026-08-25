import express from 'express'
import userModel from '../models/userModel.js'
import { getMe, getUsers, login, logout, updateUser, addAdmin, addSuperadmin, promoteToSuperadmin, demoLogin, deleteUser } from '../controllers/userController.js'
import { getVapidPublicKey, savePushSubscription, deletePushSubscription } from '../controllers/pushController.js'
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

// Push notifications — available to every authenticated role (supervisors +
// admins subscribe their own PWA), so these sit above the superadmin-only block.
router.get('/vapid-public-key', getVapidPublicKey)
router.post('/push-subscription', savePushSubscription)
router.delete('/push-subscription', deletePushSubscription)

router.patch('/update/:userId',authorizeRoles('superadmin'), updateUser )

router.post('/admin', authorizeRoles('superadmin'), addAdmin)

router.post('/superadmin', authorizeRoles('superadmin'), addSuperadmin)

router.patch('/promote/:userId', authorizeRoles('superadmin'), promoteToSuperadmin)

router.get('/',authorizeRoles('superadmin'), getUsers)

router.delete('/:userId', authorizeRoles('superadmin'), deleteUser)

export default router