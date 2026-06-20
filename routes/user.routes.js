// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const {
  getUsers,
  createUser,
  updateUser, 
  changeUserPassword,
  getUsersByRol,
  getUserFullDetail,
} = require('../controllers/user.controller');

// GET /api/user
router.get('/', requirePermissions(["Obtener usuarios"]), getUsers);
router.get('/:id', requirePermissions(["Obtener usuario"]), getUserFullDetail);
router.get('/rol/:id', requirePermissions(["Obtener usuarios"]), getUsersByRol);

// POST /api/user
router.post('/', requirePermissions(["Crear usuario"]), createUser);

// PUT /api/user
router.patch('/:id', requirePermissions(["Editar usuario"]), updateUser);
router.put('/password/:id', changeUserPassword);

module.exports = router;