// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');
const { generarYSyncDiagnosticos, getMisDiagnosticos, guardarSeleccionActivos } = require('../controllers/diagnostico.controller');

// POST /api/activo
router.post('/generar', requirePermissions(["Generar diagnóstico"]), generarYSyncDiagnosticos);
//router.post('/upload', upload.single('image'), uploadImagenActivo);

// GET /api/activo
router.get('/', requirePermissions(["Obtener diagnósticos"]), getMisDiagnosticos);

router.patch('/:idDiagnostico/seleccion-activos', requirePermissions(["Obtener diagnósticos"]), guardarSeleccionActivos);

// PATCH /api/activo
//router.patch('/:id', requirePermissions(["Editar activo"]), updateActivo);

// DELETE /api/activo
//router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen activo"]), deleteImagenActivo);

module.exports = router;