
'use strict';

const router = require('express').Router();

const requirePermissions =
  require('../middleware/requirePermissions');

const {
  consultarProspecto
} = require('../controllers/prospecto.controller');

// Consultar un cliente por documento.
router.post(
  '/consulta',

  requirePermissions(['Buscar cliente']),

  consultarProspecto
);


// Gestión manual de prospectos
const gestion = require(
  '../controllers/prospecto.gestion.controller'
);

// Listar prospectos del asesor autenticado.
router.get(
  '/',
  requirePermissions(['Gestionar prospectos']),
  gestion.listarProspectos
);

// Registrar un prospecto nuevo.
router.post(
  '/manual',
  requirePermissions(['Gestionar prospectos']),
  gestion.registrarManual
);

// Registrar una decisión comercial.
router.patch(
  '/:idProspecto/decision',
  requirePermissions(['Gestionar prospectos']),
  gestion.actualizarDecision
);


// Consultar historial de un prospecto.
router.get(
  '/:idProspecto/historial',
  requirePermissions(['Gestionar prospectos']),
  gestion.obtenerHistorial
);


router.post(
  '/:idProspecto/agendar',
  requirePermissions(['Gestionar prospectos']),
  gestion.agendarProspecto
);

module.exports = router;
