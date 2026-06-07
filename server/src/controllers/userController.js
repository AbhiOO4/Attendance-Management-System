import userModel from "../models/userModel.js";
import bcrypt from "bcryptjs";
import { generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";
import empModel from "../models/empModel.js";
import siteModel from "../models/siteModel.js";

export const login = async (req, res) => {
    try{
        const {email, password} = req.body
        const user = await userModel.findOne({email}).select("+password")
        const AuthFailMessage = "Auth failed, email or password is wrong"
        if (!user){
            return res.status(403).json({message: AuthFailMessage})
        }

        const isValid = await bcrypt.compare(password, user.password)
        if (!isValid){
            return res.status(403).json({message: AuthFailMessage})
        }
        generateTokenAndSetCookie(res, user)
        res.status(200).json({message: "Login success", success: true, user: {...user._doc, password: undefined}})
    }catch(error){
        console.log(error)
        res.status(500).json({message: "Failed to login", success: false})
    }
}

export function logout(req, res) {
    const isProduction = process.env.NODE_ENV === "production"
    res.clearCookie("token", {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "strict"
    });
    res.status(200).json({success: true, message: "Logged out successfully"})
}

export async function updateUser(req, res) {
  try {
    const { userId } = req.params;
    const { email, password, assignedSite } = req.body;

    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const employee = await empModel.findOne({employeeId: user.employeeId})

    if (!employee){
      return res.status(404).json({
        success: false,
        message: "Employe not found",
      });
    }

    const updateData = {};

    if (email) {
      updateData.email = email;
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    if (assignedSite){
      updateData.assignedSite = assignedSite
      employee.currentSite = assignedSite
    }

    const updatedUser = await userModel.findByIdAndUpdate(userId, updateData, {new: true});

    await employee.save()

    res.status(200).json({
      success: true,
      message: "The user has been updated",
      updatedUser
    });

  } catch (error) {

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "The email already exists",
      });
    }

    console.log(error);

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export async function getUsers(req, res) {
    try
    {
        const users = await userModel.find({role: "supervisor"})
        res.status(200).json(users)
    }
    catch (error) {
        console.log(error)
        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
}

export const getMe = async (req, res) => {
  try {
    const user = await userModel
      .findById(req.user.id)

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      })
    }

    return res.json({
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        assignedSite: user.assignedSite
          ? String(user.assignedSite)
          : null,
      },
    })
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      message: "Internal Server Error",
    })
  }
}
