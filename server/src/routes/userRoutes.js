import express from 'express'
import userModel from '../models/userModel.js'
import { login, logout } from '../controllers/userController.js'
import { verifyToken } from '../middlewares/verifyToken.js'

const router = express.Router()


//current user check
router.get("/me", verifyToken, async (req, res) => {
    const user = await userModel.findById(req.user.id)
    res.json(user)
  }
)

//login
router.post('/login', login)

router.post('/logout', logout)


export default router