// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');
const { generarYSyncDiagnosticos, getMisDiagnosticos } = require('../controllers/diagnostico.controller');

// POST /api/activo
router.post('/generar', requirePermissions(["Generar diagnóstico"]), generarYSyncDiagnosticos);
//router.post('/upload', upload.single('image'), uploadImagenActivo);

// GET /api/activo
router.get('/', requirePermissions(["Obtener diagnósticos"]), getMisDiagnosticos);

// PATCH /api/activo
//router.patch('/:id', requirePermissions(["Editar activo"]), updateActivo);

// DELETE /api/activo
//router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen activo"]), deleteImagenActivo);

module.exports = router;