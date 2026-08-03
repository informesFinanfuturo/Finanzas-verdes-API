// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');
const { createRequerimiento } = require('../controllers/requerimiento.controller');

// POST /api/activo
router.post('/', requirePermissions(["Crear requerimiento"]), createRequerimiento);

// GET /api/activo


// PATCH /api/activo


// DELETE /api/activo


module.exports = router;