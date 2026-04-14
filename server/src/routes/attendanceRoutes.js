import express from 'express'

const router = express.Router()


//admin

// GET /api/attendance/report?month=04&year=2026
// GET /api/attendance?date=2026-04-14
// GET api/attendance/daily-summary
// GET /api/attendance/worker/:workerId
// PUT /api/attendance/admin-override/:id


router.get('/report', getMonthly())

router.get('/', getDaily())

router.get('/daily-summary', getSummary())

router.get('/worker/:workerId', getWorker())

router.put('/admin-override/:id',  editAttendanceAfterFreeze())



//supervisor

// GET /api/attendance/by-site/:siteId ?date=2026-04-14
// GET /api/attendance/by-site/:siteId/monthly ?month=04&year=2026
// POST /api/attendance/submit
// PATCH /api/attendance/update/:id


router.get('/by-site/:siteId', getDailyBySite())

router.get('/by-site/:siteId/monthly', getMonthlyBySite())

router.post('/submit', confirmAttendance() )

router.patch('/update/:id', editAttendance())



export default router