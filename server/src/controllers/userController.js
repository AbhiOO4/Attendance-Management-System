import userModel from "../models/userModel.js";
import bcrypt from "bcryptjs";
import { authCookieOptions, generateTokenAndSetCookie } from "../utils/generateTokenAndSetCookie.js";
import empModel from "../models/empModel.js";
import mongoose from "mongoose";
import { getDriverPoolId } from "../utils/driverPool.js";

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
    res.clearCookie("token", authCookieOptions());
    res.status(200).json({success: true, message: "Logged out successfully"})
}

export async function updateUser(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { userId } = req.params;
    const { email, password } = req.body;

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

    // assignedSite (the supervisor's site access) is NOT editable here: it mirrors the
    // linked employee's permanent site and is kept in step by every permanent move or
    // removal (utils/supervisorScope.js). A stray assignedSite in the body is ignored.

    const updatedUser = await userModel.findByIdAndUpdate(userId, updateData, {new: true, session});

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "The user has been updated",
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
        const users = await userModel.find({}).select("-pushSubscriptions -checkoutReminder")
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

// Shared creator for privileged (non-supervisor) accounts. `role` is fixed by the
// caller, never taken from the request body.
async function createPrivilegedUser(role, req, res) {
  try {
    const { name, email, password } = req.body;
    const label = role === "superadmin" ? "Superadmin" : "Admin";

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

    const user = new userModel({
      name,
      email,
      password,
      role,
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: `${label} created successfully`,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

export const addAdmin = (req, res) => createPrivilegedUser("admin", req, res);

/**
 * POST /api/user/driver-supervisor — a Driver Supervisor account: marks the Drivers
 * Attendance sheet only. Site access is pinned to the hidden drivers pool. A linked
 * employee is optional (by employeeId); when given it must exist and have no account yet.
 */
export async function addDriverSupervisor(req, res) {
  const session = await mongoose.startSession();
  try {
    const { name, email, password } = req.body;
    const employeeId = req.body.employeeId ? String(req.body.employeeId).trim().toUpperCase() : null;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters long" });
    }
    if (await userModel.findOne({ email })) {
      return res.status(409).json({ success: false, message: "The email already exists" });
    }

    const poolId = await getDriverPoolId();
    if (!poolId) {
      return res.status(503).json({ success: false, message: "Drivers pool is not set up yet" });
    }

    let created = null;
    await session.withTransaction(async () => {
      created = null;
      let employee = null;
      if (employeeId) {
        employee = await empModel.findOne({ employeeId }).session(session);
        if (!employee) {
          const err = new Error("Employee not found");
          err.status = 404;
          throw err;
        }
        if (employee.user) {
          const err = new Error("This employee already has a user account");
          err.status = 409;
          throw err;
        }
      }

      const [user] = await userModel.create(
        [{ name, email, password, role: "driverSupervisor", assignedSite: poolId, employeeId: employeeId || undefined }],
        { session }
      );
      if (employee) {
        employee.user = user._id;
        await employee.save({ session });
      }
      created = user;
    });

    res.status(201).json({
      success: true,
      message: "Driver supervisor created successfully",
      user: { _id: created._id, name: created.name, email: created.email, role: created.role },
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "The email or employee is already linked to an account" });
    }
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  } finally {
    session.endSession();
  }
}

export const addSuperadmin = (req, res) => createPrivilegedUser("superadmin", req, res);

// Promote an existing admin to superadmin. Only admins can be promoted.
export const promoteToSuperadmin = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.role === "superadmin") {
      return res.status(400).json({
        success: false,
        message: "User is already a superadmin",
      });
    }

    if (user.role !== "admin") {
      return res.status(400).json({
        success: false,
        message: "Only an admin can be promoted to superadmin",
      });
    }

    user.role = "superadmin";
    await user.save();

    res.status(200).json({
      success: true,
      message: "Admin promoted to superadmin",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
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

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await userModel.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if ((user.role === "supervisor" || user.role === "driverSupervisor") && user.employeeId) {
      const employee = await empModel.findOne({ employeeId: user.employeeId }).session(session);
      if (employee && String(employee.user) === String(user._id)) {
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

