import express from 'express'

const router = express.Router()


//Admin

// GET /api/workers
// POST /api/workers/add
// PATCH /api/workers/:id 

router.get('/', getAllEmployees())

router.post('/add', addEmployee())

router.patch('/:id ', getEmployee())


//Supervisor

// GET /api/workers/by-site/:siteId

router.get('/by-site/:siteId', getEmployeeBySite())





export default router