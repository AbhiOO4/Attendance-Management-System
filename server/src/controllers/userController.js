import userModel from "../models/userModel.js";
import bcrypt from "bcryptjs";
import { generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";
import empModel from "../models/empModel.js";
import siteModel from "../models/siteModel.js";
import mongoose from "mongoose";
import { applySupervisorSiteChange } from "../services/supervisorReassignment.js";

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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId } = req.params;
    const { email, password, assignedSite } = req.body;

    const user = await userModel.findById(userId).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const employee = user.employeeId ? await empModel.findOne({employeeId: user.employeeId}).session(session) : null;

    if (user.role === 'supervisor' && !employee){
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Employee not found",
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

    // Site change is conditional on attendance state — only act when it actually
    // changed (the modal resends assignedSite on every save, so an email/password
    // edit must not trigger a reassignment). Supervisors only (they have an employee).
    let deferredSiteChange = false;

    if (
      assignedSite &&
      employee &&
      String(assignedSite) !== String(employee.currentSite || "")
    ) {
      const result = await applySupervisorSiteChange({
        employee,
        newSiteId: assignedSite,
        actorId: req.user.id,
        dbSession: session,
      });
      if (result.assignedSite) {
        updateData.assignedSite = result.assignedSite;
      }
      deferredSiteChange = result.deferred;
    }

    const updatedUser = await userModel.findByIdAndUpdate(userId, updateData, {new: true, session});

    if (employee) {
      await employee.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: deferredSiteChange
        ? "User updated — site change scheduled to take effect tomorrow"
        : "The user has been updated",
      deferred: deferredSiteChange,
      updatedUser
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

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
        const users = await userModel.find({})
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

export const addAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "The email already exists",
      });
    }

    const admin = new userModel({
      name,
      email,
      password,
      role: "admin",
    });

    await admin.save();

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      user: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

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

export const demoLogin = async (req, res) => {
  try {
    const { token } = req.body;
    const configuredToken = process.env.DEMO_LOGIN_TOKEN;
    if (!configuredToken) {
      return res.status(500).json({
        success: false,
        message: "Demo login is not configured on the server."
      });
    }

    if (token !== configuredToken) {
      return res.status(403).json({
        success: false,
        message: "Invalid demo token."
      });
    }

    const email = process.env.DEMO_USER_EMAIL;
    const password = process.env.DEMO_USER_PASSWORD;
    const name = process.env.DEMO_USER_NAME || "Guest User";
    const role = process.env.DEMO_USER_ROLE || "admin";

    if (!email || !password) {
      return res.status(500).json({
        success: false,
        message: "Demo guest credentials are not configured on the server."
      });
    }

    let user = await userModel.findOne({ email }).select("+password");
    if (!user) {
      // Create guest user if it doesn't exist
      user = new userModel({
        name,
        email,
        password,
        role
      });
      await user.save();
    }

    // Generate token and set cookie
    generateTokenAndSetCookie(res, user);

    return res.status(200).json({
      message: "Demo login success",
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        role: user.role,
        assignedSite: user.assignedSite ? String(user.assignedSite) : null
      }
    });
  } catch (error) {
    console.error("Demo login error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to login with demo session."
    });
  }
};

export async function deleteUser(req, res) {
  const { userId } = req.params;
  const deletePassword = req.body.deletePassword || req.headers['x-delete-password'] || req.query.deletePassword;

  const configPassword = process.env.MAIN_ADMIN_DELETE_PASSWORD;
  if (!configPassword) {
    return res.status(500).json({ success: false, message: "Main admin delete password is not configured on the server." });
  }

  if (deletePassword !== configPassword) {
    return res.status(403).json({ success: false, message: "Invalid delete password." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await userModel.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.role === "supervisor" && user.employeeId) {
      const employee = await empModel.findOne({ employeeId: user.employeeId }).session(session);
      if (employee) {
        employee.user = null;
        await employee.save({ session });
      }
    }

    await userModel.findByIdAndDelete(userId, { session });

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("deleteUser error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

