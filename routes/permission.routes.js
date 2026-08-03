// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const {
  getPermissions,
  createPermission,
  updatePermission,
} = require('../controllers/permission.controller');

// GET /api/permission
router.get('/', requirePermissions(["Obtener permisos"]), getPermissions);

// POST /api/permission
router.post('/', requirePermissions(["Crear permiso"]), createPermission);

// PATCH /api/permission
router.patch('/:id', requirePermissions(["Editar permiso"]), updatePermission);

module.exports = router;