
import userModel from '../models/userModel.js'

export const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin" && req.user.role !== "superadmin") {
    return res.status(403).json({
      message: "Admins only",
    })
  }

  next()
}

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    const userRole = req.user.role;
    const authorizedRoles = [...roles];

    // If a route allows 'admin', it should automatically allow 'superadmin' as well
    if (authorizedRoles.includes('admin') && !authorizedRoles.includes('superadmin')) {
      authorizedRoles.push('superadmin');
    }

    if (!authorizedRoles.includes(userRole)) {
      return res.status(403).json({
        message: "Forbidden",
      })
    }

    next()
  }
} 

export const requireSiteAccess = async (req, res, next) => {
  if (req.user.role === "admin" || req.user.role === "superadmin") {
    return next();
  }

  try {
    const siteId = req.params?.siteId || req.params?.id || req.body?.siteId || req.query?.siteId;
    if (!siteId) {
      return res.status(400).json({ success: false, message: "Site ID is required" });
    }

    const user = await userModel.findById(req.user.id);
    if (!user || !user.assignedSite) {
      return res.status(403).json({ success: false, message: "Forbidden: No site assigned to supervisor" });
    }

    if (user.assignedSite.toString() !== siteId.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden: Access denied to this site" });
    }

    // Attach user's assigned site to request object for downstream use
    req.user.assignedSite = user.assignedSite;
    next();
  } catch (error) {
    console.error("Error in requireSiteAccess middleware:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};