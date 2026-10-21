import express from 'express'

import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles, requireSiteAccess } from '../middlewares/rbac.js'
import * as backfillRequestController from '../controllers/backfillRequestController.js'

const router = express.Router()

// prefix: /api/backfill-requests — supervisor backfill requests (draft → admin approval).
// Driver supervisors use the same routes; their assignedSite is the Drivers pool.
// Supervisor scope: requireSiteAccess where a siteId is in the query/body; the :id routes
// check the loaded document's site inside the controller.

router.use(verifyToken)

// --- Specific routes FIRST (before the /:id wildcard) ---
router.get('/', authorizeRoles("admin", "supervisor", "driverSupervisor"), backfillRequestController.listBackfillRequests)

router.get('/pending-count', authorizeRoles("admin"), backfillRequestController.getPendingBackfillCount)

router.get('/by-day', authorizeRoles("admin", "supervisor", "driverSupervisor"), requireSiteAccess, backfillRequestController.getBackfillRequestByDay)

router.get('/candidates', authorizeRoles("supervisor", "driverSupervisor"), requireSiteAccess, backfillRequestController.getBackfillCandidates)

// Bulk apply — supervisors only (admins backfill directly from Missing Employees).
router.post('/rows', authorizeRoles("supervisor", "driverSupervisor"), requireSiteAccess, backfillRequestController.addBackfillRows)

// --- :id routes ---
router.get('/:id', authorizeRoles("admin", "supervisor", "driverSupervisor"), backfillRequestController.getBackfillRequest)

router.put('/:id/rows/:employeeId', authorizeRoles("admin", "supervisor", "driverSupervisor"), backfillRequestController.updateBackfillRow)

router.delete('/:id/rows/:employeeId', authorizeRoles("admin", "supervisor", "driverSupervisor"), backfillRequestController.removeBackfillRow)

router.post('/:id/submit', authorizeRoles("supervisor", "driverSupervisor"), backfillRequestController.submitBackfillRequest)

router.post('/:id/approve', authorizeRoles("admin"), backfillRequestController.approveBackfillRequest)

router.post('/:id/reject', authorizeRoles("admin"), backfillRequestController.rejectBackfillRequest)

router.delete('/:id', authorizeRoles("supervisor", "driverSupervisor"), backfillRequestController.discardBackfillRequest)

export default router
