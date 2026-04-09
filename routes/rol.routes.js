// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const {
  getRoles,
  createRole,
} = require('../controllers/rol.controller');

// GET /api/roles
router.get('/', getRoles);

// POST /api/roles
router.post('/', createRole);

module.exports = router;