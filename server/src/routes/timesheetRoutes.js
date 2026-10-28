import express from 'express'

import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'
import * as timesheetController from '../controllers/timesheetController.js'

const router = express.Router()

// prefix: /api/timesheets — monthly timesheet approval. Supervisors read the list (and can
// download an APPROVED employee's timesheet from the employee page); admins + superadmins
// approve, revoke and export.

router.use(verifyToken)

router.get('/', authorizeRoles("admin", "supervisor"), timesheetController.listTimesheets)

router.post('/approve', authorizeRoles("admin"), timesheetController.approveTimesheets)

router.post('/revoke', authorizeRoles("admin"), timesheetController.revokeTimesheet)

router.post('/export/summary', authorizeRoles("admin"), timesheetController.exportSummary)

export default router
