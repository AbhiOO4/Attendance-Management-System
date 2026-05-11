import userModel from "../models/userModel.js";
import bcrypt from "bcryptjs";
import { generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";

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


export async function checkAuth(req, res){
    try{
        const id = req.user._id
        const user = await userModel.findById(id).select("-password")
        if (!user){
            return res.status(400).json({success: false, message: "User not found"})
        }
        res.status(200).json({success: true, user})
    }catch(error){
        res.status(400).json({success: false, message: error.message})
    }
}