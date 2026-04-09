// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const {
  getVisits,
  createVisit,
} = require('../controllers/visit.controller');

// GET /api/visit
router.get('/', getVisits);

// POST /api/visit
router.post('/', createVisit);

module.exports = router;