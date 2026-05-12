import express from 'express'
import userModel from '../models/userModel.js'
import { login, logout } from '../controllers/userController.js'
import { verifyToken } from '../middlewares/verifyToken.js'

const router = express.Router()


//current user check
router.get("/me", verifyToken, async (req, res) => {

    const user = await userModel.findById(req.user.id)

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      })
    }

    res.json({
      user: {
        _id: user._id,
        role: user.role,
        email: user.email,
      },
    })
  }
)

//login
router.post('/login', login)

router.post('/logout', logout)


export default router