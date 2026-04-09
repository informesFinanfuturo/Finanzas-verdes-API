// routes/workPlan.routes.js
const express = require('express');
const router = express.Router();
const { getworkPlans, createWorkPlan, getworkPlansProcess, updateWorkPlan, deleteWorkPlan } = require('../controllers/workPlan.controller');

// GET /api/workPlan
router.get('/', getworkPlans);
router.get('/process/:idProcess', getworkPlansProcess);

// POST /api/workPlan
router.post('/', createWorkPlan);

// PUT /api/workPlan/:id
router.put('/:id', updateWorkPlan);

// DELETE /api/workPlan/:Id
router.delete('/:id', deleteWorkPlan);


module.exports = router;