'use strict';
const router = require('express').Router();
const requirePermissions = require('../middleware/requirePermissions');
const pool = require('../db');
const c = require('../controllers/fve.evaluacion.controller').crearHandlers(pool);

router.post('/evaluaciones', requirePermissions(['Generar diagnóstico']), c.evaluar);
router.get('/evaluaciones/proceso/:idProceso', requirePermissions(['Obtener diagnósticos']), c.listado);
router.get('/evaluaciones/:idEvaluacion', requirePermissions(['Obtener diagnósticos']), c.detalle);
module.exports = router;
