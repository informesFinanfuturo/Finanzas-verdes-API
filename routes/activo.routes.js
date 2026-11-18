// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');
const {
  createActivo,
  getActivoById,
  updateActivo,
  uploadImagenActivo,
  deleteImagenActivo,
  analizarActivo,
  deleteActivo,
} = require('../controllers/activo.controller');
const estimacionesIA = require('../controllers/activo.estimaciones.controller');

// POST /api/activo
router.post('/', requirePermissions(["Crear activo"]), createActivo);
router.post('/upload', upload.single('image'), uploadImagenActivo);
router.post('/analizar/:id', requirePermissions(["Analizar activo"]), analizarActivo);

// Consulta y busqueda web voluntaria del asesor.
router.get('/:id/estimaciones', requirePermissions(["Obtener activo"]), estimacionesIA.estado);
router.post('/:id/estimaciones/investigar', requirePermissions(["Analizar activo"]), estimacionesIA.investigarActivo);

// GET /api/activo
router.get('/:id', requirePermissions(["Obtener activo"]), getActivoById);

// PATCH /api/activo
router.patch('/:id', requirePermissions(["Editar activo"]), updateActivo);

// DELETE /api/activo
router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen activo"]), deleteImagenActivo);
router.delete('/:id', requirePermissions(["Eliminar activo"]), deleteActivo);

module.exports = router;