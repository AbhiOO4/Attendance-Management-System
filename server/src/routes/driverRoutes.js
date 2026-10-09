import express from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'
import { getDriverPool, getDriverRoster, getDriverJobs } from '../controllers/driverController.js'

const router = express.Router()

router.use(verifyToken)

// Prefix /api/drivers — the Drivers Attendance sheet (admins + driver supervisors).
router.get('/pool', authorizeRoles("admin", "driverSupervisor"), getDriverPool)
router.get('/roster', authorizeRoles("admin", "driverSupervisor"), getDriverRoster)
router.get('/jobs', authorizeRoles("admin", "driverSupervisor"), getDriverJobs)

export default router
