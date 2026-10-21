
'use strict';

const router = require('express').Router();
const requirePermissions =
  require('../middleware/requirePermissions');

const pool = require('../db');

const { createFveHandlers } =
  require('../controllers/fve.controller');

const c = createFveHandlers(pool);

router.post(
  '/procesos',
  requirePermissions(['Generar diagnóstico']),
  c.iniciarProceso
);

router.get(
  '/procesos/mipyme/:idMipyme',
  requirePermissions(['Obtener diagnósticos']),
  c.listarPorMipyme
);

router.get(
  '/procesos/diagnostico/:idDiagnostico',
  requirePermissions(['Obtener diagnósticos']),
  c.obtenerPorDiagnostico
);

router.get(
  '/procesos/:idProceso',
  requirePermissions(['Obtener diagnósticos']),
  c.obtenerProceso
);

module.exports = router;
