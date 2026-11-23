// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requireAdministrator = require('../middleware/requireAdministrator');
const requirePermissions = require('../middleware/requirePermissions');
const { resetUserPassword, changeOwnPassword } = require('../controllers/adminCompat.controller');
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
router.post('/', requireAdministrator, createUser);

// PUT /api/user
router.patch('/:id', requireAdministrator, updateUser);
router.post('/:id/reset-password', requireAdministrator, resetUserPassword);
router.put('/me/password', changeOwnPassword);
// El endpoint anterior no esta adaptado al esquema public.usuario.
// Se deshabilita para evitar cambios sin auditoria ni validacion administrativa.
router.put('/password/:id', requireAdministrator, (req, res) =>
  res.status(410).json({ error: 'Endpoint reemplazado por restablecimiento seguro' }));

module.exports = router;

