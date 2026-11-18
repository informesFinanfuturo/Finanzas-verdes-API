// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requireAdministrator = require('../middleware/requireAdministrator');
const requirePermissions = require('../middleware/requirePermissions');
const {
  getPermissions,
  createPermission,
  updatePermission,
} = require('../controllers/permission.controller');

// GET /api/permission
router.get('/', requirePermissions(["Obtener permisos"]), getPermissions);

// POST /api/permission
router.post('/', requireAdministrator, createPermission);

// PATCH /api/permission
router.patch('/:id', requireAdministrator, updatePermission);

module.exports = router;
