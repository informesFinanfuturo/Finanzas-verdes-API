// routes/roles.routes.js
const express = require('express');
const router = express.Router();
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
router.post('/', createRole);

// PATCH /api/roles
router.patch('/permission', togglePermisoRol);
router.patch('/:id', updateRol);

module.exports = router;