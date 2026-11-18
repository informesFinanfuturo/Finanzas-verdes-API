// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requireAdministrator = require('../middleware/requireAdministrator');
const {
  createRole,
  getRols,
  updateRol,
  getRolById,
  togglePermisoRol,
} = require('../controllers/rol.controller');

// GET /api/roles
router.get('/', getRols);
router.get('/:id', getRolById);

// POST /api/roles
router.post('/', requireAdministrator, createRole);

// PATCH /api/roles
router.patch('/permission', requireAdministrator, togglePermisoRol);
router.patch('/:id', requireAdministrator, updateRol);

module.exports = router;
