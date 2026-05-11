
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admins only",
    })
  }

  next()
}

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Forbidden",
      })
    }

    next()
  }
} 