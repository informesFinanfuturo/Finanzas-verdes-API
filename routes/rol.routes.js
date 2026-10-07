const express =
  require('express');

const router =
  express.Router();

const requirePermissions =
  require(
    '../middleware/requirePermissions'
  );

const {
  createRole,
  getRols,
  updateRol,
  getRolById,
  togglePermisoRol,
  replaceRolePermissions,
} = require(
  '../controllers/rol.controller'
);

// =====================================
// CONSULTAS
// =====================================

router.get(
  '/',
  requirePermissions([
    'Obtener roles'
  ]),
  getRols
);

router.get(
  '/:id',
  requirePermissions([
    'Obtener roles'
  ]),
  getRolById
);

// =====================================
// CREACIÓN
// =====================================

router.post(
  '/',
  requirePermissions([
    'Crear rol'
  ]),
  createRole
);

// =====================================
// ASIGNACIÓN DE PERMISOS
// =====================================

router.patch(
  '/permission',
  requirePermissions([
    'Asignar permisos rol'
  ]),
  togglePermisoRol
);

// =====================================
// EDICIÓN
// =====================================

router.put(
  '/:id/permissions',
  requirePermissions([
    'Asignar permisos rol'
  ]),
  replaceRolePermissions
);

router.patch(
  '/:id',
  requirePermissions([
    'Editar rol'
  ]),
  updateRol
);

module.exports = router;