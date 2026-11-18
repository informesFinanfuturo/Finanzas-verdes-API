// routes/roles.routes.js
const express = require('express');
const { guardarSeleccionActivosV2 } = require('../controllers/diagnostico.seleccion.v2.controller');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const { obtenerAlternativas } = require('../controllers/diagnostico.alternativas.controller');
const { crearControlador: crearVinculos } = require('../services/diagnosticoVinculos');
const vinculosDiagnostico = crearVinculos();
const upload = require('../upload');
const { generarYSyncDiagnosticos, getMisDiagnosticos, guardarSeleccionActivos } = require('../controllers/diagnostico.controller');

// POST /api/activo
router.post('/generar', requirePermissions(["Generar diagnóstico"]), generarYSyncDiagnosticos);
//router.post('/upload', upload.single('image'), uploadImagenActivo);

// GET /api/activo
router.get('/', requirePermissions(["Obtener diagnósticos"]), getMisDiagnosticos);

router.get('/:idDiagnostico/activo/:idActivo/alternativas', requirePermissions(["Obtener diagnósticos"]), obtenerAlternativas);
router.post('/:idDiagnostico/activo/:idActivo/vincular', requirePermissions(["Generar diagnóstico"]), vinculosDiagnostico.vincular);

router.patch('/:idDiagnostico/seleccion-activos', requirePermissions(["Obtener diagnósticos"]), guardarSeleccionActivosV2);

// PATCH /api/activo
//router.patch('/:id', requirePermissions(["Editar activo"]), updateActivo);

// DELETE /api/activo
//router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen activo"]), deleteImagenActivo);

module.exports = router;