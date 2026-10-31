import express from 'express'
import { verifyToken } from '../middlewares/verifyToken.js'
import { authorizeRoles } from '../middlewares/rbac.js'
import {
  getActivityTypes,
  createActivityType,
  updateActivityType,
  deleteActivityType,
  allocateActivityType,
  exportActivityTypesErpnext,
} from '../controllers/activityTypeController.js'

const router = express.Router()

router.use(verifyToken)
// The whole page is admin + superadmin (admin implicitly allows superadmin).
router.use(authorizeRoles("admin"))

// Prefix /api/activity-types (see utils/activityTypes.js). Specific paths before /:id.
router.get('/', getActivityTypes)
router.post('/', createActivityType)
router.get('/erpnext', exportActivityTypesErpnext)
router.post('/allocate', allocateActivityType)
router.patch('/:id', updateActivityType)
router.delete('/:id', deleteActivityType)

export default router
