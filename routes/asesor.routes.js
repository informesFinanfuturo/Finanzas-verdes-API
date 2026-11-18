// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requireAdministrator = require('../middleware/requireAdministrator');
const requirePermissions = require('../middleware/requirePermissions');
const {
  getUsers,
  createUser,
  updateAsesor,
} = require('../controllers/asesor.controller');

// GET /api/user
router.get('/', requirePermissions(["Obtener usuarios"]), getUsers);

// POST /api/user
router.post('/', requireAdministrator, createUser);

// PUT /api/user
router.patch('/:id', requireAdministrator, updateAsesor);

module.exports = router;
