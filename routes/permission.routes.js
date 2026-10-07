const express =
  require('express');

const router =
  express.Router();

const requirePermissions =
  require(
    '../middleware/requirePermissions'
  );

const {
  getPermissions,
  createPermission,
  updatePermission,
} = require(
  '../controllers/permission.controller'
);

// =====================================
// CONSULTAS
// =====================================

router.get(
  '/',
  requirePermissions([
    'Obtener permisos'
  ]),
  getPermissions
);

// =====================================
// CREACIÓN
// =====================================

router.post(
  '/',
  requirePermissions([
    'Crear permiso'
  ]),
  createPermission
);

// =====================================
// EDICIÓN
// =====================================

router.patch(
  '/:id',
  requirePermissions([
    'Editar permiso'
  ]),
  updatePermission
);

module.exports = router;