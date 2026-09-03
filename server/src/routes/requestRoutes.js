import express from "express"
import { verifyToken } from "../middlewares/verifyToken.js"
import { authorizeRoles } from "../middlewares/rbac.js"
import {
  createRequest,
  listRequests,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  getSummary,
  listNotifications,
  markNotificationsRead,
} from "../controllers/requestController.js"

const router = express.Router()

router.use(verifyToken)

// Badge + activity feed (specific paths before the /:id wildcards).
router.get("/summary", authorizeRoles("admin", "supervisor"), getSummary)
router.get("/notifications", authorizeRoles("admin", "supervisor"), listNotifications)
router.post("/notifications/read", authorizeRoles("admin", "supervisor"), markNotificationsRead)

// Requests. Only supervisors create (admins direct-add); two-site auth is done
// inside each controller, so requireSiteAccess (single-site) is not used here.
router.get("/", authorizeRoles("admin", "supervisor"), listRequests)
router.post("/", authorizeRoles("supervisor"), createRequest)
router.post("/:id/accept", authorizeRoles("admin", "supervisor"), acceptRequest)
router.post("/:id/reject", authorizeRoles("admin", "supervisor"), rejectRequest)
router.post("/:id/cancel", authorizeRoles("admin", "supervisor"), cancelRequest)

export default router
