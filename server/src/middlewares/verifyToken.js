import jwt from "jsonwebtoken"
import userModel from "../models/userModel.js"

const unauthorized = (res) =>
    res.status(401).json({ success: false, message: "Unauthorized - invalid or expired token" })

export const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token
    if (!token) return res.status(401).json({ success: false, message: "Unauthorized- no token provided" })

    let decoded
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET)
    } catch {
        return unauthorized(res)
    }

    try {
        // The account decides, not the token: a deleted user or an ended session stops working
        // at once, and a role change applies on the next request. Tokens issued before
        // tokenVersion existed have no `v` and count as 0, so deploying this logs nobody out.
        const user = await userModel.findById(decoded.id).select("role tokenVersion").lean()
        if (!user || (user.tokenVersion ?? 0) !== (decoded.v ?? 0)) return unauthorized(res)

        req.user = { id: String(user._id), role: user.role }
    } catch (error) {
        // A database failure says nothing about the session, so don't answer 401.
        console.error("verifyToken error:", error)
        return res.status(500).json({ success: false, message: "Internal server error" })
    }
    next()
}
