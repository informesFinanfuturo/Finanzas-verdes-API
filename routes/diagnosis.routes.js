// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const { generateDiagnosis, getDiagnosisForProcess } = require('../controllers/diagnosis.controller');

// GET /api/roles
router.get('/process/:idProcess', getDiagnosisForProcess);

// POST /api/diagnosis
router.post('/:idProcess', generateDiagnosis);

module.exports = router;