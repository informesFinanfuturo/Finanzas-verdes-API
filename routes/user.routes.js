const express =
  require('express');

const router =
  express.Router();

const requirePermissions =
  require(
    '../middleware/requirePermissions'
  );

const {
  getUsers,
  createUser,
  updateUser,
  resetUserPassword,
  changeOwnPassword,
  changeUserAccessStatus,
  getUsersByRol,
  getUserFullDetail,
  getUserAudit,
} = require(
  '../controllers/user.controller'
);

// =====================================
// CONTRASEÑA DEL USUARIO AUTENTICADO
// =====================================

router.put(
  '/me/password',
  changeOwnPassword
);

// =====================================
// CONSULTAS
// =====================================

router.get(
  '/',
  requirePermissions([
    'Obtener usuarios'
  ]),
  getUsers
);

router.get(
  '/rol/:id',
  requirePermissions([
    'Obtener usuarios'
  ]),
  getUsersByRol
);

router.get(
  '/:id/audit',
  requirePermissions([
    'Consultar auditoría usuarios',
  ]),
  getUserAudit
);

router.get(
  '/:id',
  requirePermissions([
    'Obtener usuario'
  ]),
  getUserFullDetail
);

// =====================================
// CREACIÓN
// =====================================

router.post(
  '/',
  requirePermissions([
    'Crear usuario'
  ]),
  createUser
);

// =====================================
// SEGURIDAD
// =====================================

router.post(
  '/:id/reset-password',
  requirePermissions([
    'Restablecer contraseña usuario'
  ]),
  resetUserPassword
);

router.patch(
  '/:id/status',
  requirePermissions([
    'Cambiar estado usuario'
  ]),
  changeUserAccessStatus
);

// =====================================
// EDICIÓN GENERAL
// =====================================

router.patch(
  '/:id',
  requirePermissions([
    'Editar usuario'
  ]),
  updateUser
);

module.exports = router;