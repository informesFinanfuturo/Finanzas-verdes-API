const express =
  require('express');

const router =
  express.Router();

const requirePermissions =
  require(
    '../middleware/requirePermissions'
  );

const {

  consultarClienteExterno,

  descartarConsulta,

  agendarProspecto,

  actualizarDecisionProspecto,

  convertirProspecto,

  getConsultasRecientes,

} = require(
  '../controllers/prospecto.controller'
);


// ============================================================
// CONSULTAR
// ============================================================

router.post(
  '/consulta',

  requirePermissions([
    'Buscar cliente'
  ]),

  consultarClienteExterno
);


// ============================================================
// HISTORIAL
// ============================================================

router.get(
  '/consulta/recientes',

  requirePermissions([
    'Buscar cliente'
  ]),

  getConsultasRecientes
);


// ============================================================
// DESCARTAR
// ============================================================

router.patch(
  '/consulta/:id/descartar',

  requirePermissions([
    'Buscar cliente'
  ]),

  descartarConsulta
);


// ============================================================
// AGENDAR
// ============================================================

router.post(
  '/consulta/:id/agendar',

  requirePermissions([
    'Buscar cliente',
    'Crear calendario',
  ]),

  agendarProspecto
);


// ============================================================
// DECISIÓN DESPUÉS DE LA REUNIÓN
// ============================================================

router.patch(
  '/:id/decision',

  requirePermissions([
    'Buscar cliente'
  ]),

  actualizarDecisionProspecto
);


// ============================================================
// CONVERTIR A CLIENTE FV
// ============================================================

router.post(
  '/:id/convertir',

  requirePermissions([
    'Crear cliente',
    'Crear mipyme',
  ]),

  convertirProspecto
);


module.exports = router;