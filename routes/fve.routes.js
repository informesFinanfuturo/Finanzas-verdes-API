
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

// FVE_SELECCION_INTEGRADA_RUTAS
const { crearControlador } = require('../controllers/fve.seleccion.controller');
const seleccionFve = crearControlador({db:pool});
router.get('/procesos/:idProceso/seleccion',
  requirePermissions(['Obtener diagnósticos']), seleccionFve.leerSeleccion);
router.put('/procesos/:idProceso/seleccion',
  requirePermissions(['Generar diagnóstico']), seleccionFve.guardarBorrador);
router.post('/procesos/:idProceso/confirmar-seleccion',
  requirePermissions(['Generar diagnóstico']), seleccionFve.confirmarSeleccion);

// FVE_DIAGNOSTICO_ORIGEN_RUTA
const {crearControlador: crearOrigenFve} = require('../controllers/fve.diagnosticoOrigen.controller');
const origenFve = crearOrigenFve({db:pool});
router.get('/procesos/:idProceso/diagnostico-origen',
  requirePermissions(['Obtener diagnósticos']), origenFve.obtenerDiagnosticoOrigen);

module.exports = router;
