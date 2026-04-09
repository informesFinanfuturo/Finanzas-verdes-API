// routes/process.routes.js
const express = require('express');
const router = express.Router();
const { createProcess, getProcesses, createAnswerProcess, getAnswersByProcess, deleteAnswerProcess, getProcessFull } = require('../controllers/process.controller');

// GET /api/process
router.get('/', getProcesses);
router.get('/:id', getProcessFull);
router.get('/answer/:idProcess', getAnswersByProcess);

// POST /api/process
router.post('/', createProcess);
router.post('/answer', createAnswerProcess);

// DELETE /api/process
router.delete('/answer/:id', deleteAnswerProcess);

module.exports = router;