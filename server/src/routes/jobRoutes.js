import express from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'
import {
  getGlobalJobs,
  getGlobalJobsForManage,
  createGlobalJob,
  toggleGlobalJobStatus,
  deleteGlobalJob,
} from '../controllers/globalJobController.js'

const router = express.Router()

router.use(verifyToken)

// Prefix /api/jobs — global jobs (jobs common to every site; see utils/globalJobs.js).
// Specific paths before the /:jobId ones.
router.get('/global', authorizeRoles("admin", "supervisor", "driverSupervisor"), getGlobalJobs)
router.get('/global/manage', authorizeRoles("admin"), getGlobalJobsForManage)
router.post('/global', authorizeRoles("admin"), createGlobalJob)
router.patch('/global/:jobId/status', authorizeRoles("admin"), toggleGlobalJobStatus)
router.delete('/global/:jobId', authorizeRoles("admin"), deleteGlobalJob)

export default router
