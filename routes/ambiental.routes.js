
'use strict';

const router = require('express').Router();

const requirePermissions = require('../middleware/requirePermissions');

const c = require('../controllers/ambiental.controller');

// Consultar el cuestionario vigente
router.get(
  '/formulario',
  requirePermissions(['Obtener diagnósticos']),
  c.obtenerFormulario
);

// Consultar una versión histórica del cuestionario
router.get(
  '/formulario/:codigo',
  requirePermissions(['Obtener diagnósticos']),
  c.obtenerFormulario
);

// Listar evaluaciones ambientales de una empresa
router.get(
  '/mipymes/:idMipyme/evaluaciones',
  requirePermissions(['Obtener diagnósticos']),
  c.listarEvaluaciones
);

// Consultar una evaluación específica
router.get(
  '/evaluaciones/:idEvaluacion',
  requirePermissions(['Obtener diagnósticos']),
  c.obtenerEvaluacion
);

// Crear una evaluación ambiental
router.post(
  '/mipymes/:idMipyme/evaluaciones',
  requirePermissions(['Generar diagnóstico']),
  c.guardarEvaluacion
);

// Actualizar o finalizar una evaluación
router.patch(
  '/evaluaciones/:idEvaluacion',
  requirePermissions(['Generar diagnóstico']),
  c.guardarEvaluacion
);

module.exports = router;
