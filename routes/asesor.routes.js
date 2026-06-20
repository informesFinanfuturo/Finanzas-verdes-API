// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const {
  getUsers,
  createUser,
  updateAsesor,
} = require('../controllers/asesor.controller');

// GET /api/user
router.get('/', requirePermissions(["Obtener usuarios"]), getUsers);

// POST /api/user
router.post('/', requirePermissions(["Crear usuario"]), createUser);

// PUT /api/user
router.patch('/:id', requirePermissions(["Editar usuario"]), updateAsesor);

module.exports = router;