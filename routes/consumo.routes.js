// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');
const { 
  createConsumo,
  updateConsumo,
  getConsumoById,
  uploadImagenConsumo,
  deleteArchivoConsumo,
  analizarConsumo,
  deleteConsumo,
  uploadDocumentoConsumo,
} = require('../controllers/consumo.controller');

// GET /api/roles
router.get('/:id', requirePermissions(["Obtener consumos"]), getConsumoById);

// POST /api/roles
router.post('/', requirePermissions(["Crear consumo"]), createConsumo);
router.post('/upload', requirePermissions(["Editar consumo"]), upload.single('image'), uploadImagenConsumo);
router.post('/documento/upload', requirePermissions(["Editar consumo"]), upload.single('documento'), uploadDocumentoConsumo);
router.post('/analizar/:id', requirePermissions(["Analizar consumo"]) , analizarConsumo);


// PATCH /api/roles
router.patch('/:id', requirePermissions(["Editar consumo"]), updateConsumo);

// DELETE /api/activo
router.delete('/archivo/:id_archivo', requirePermissions(["Eliminar archivo consumo"]), deleteArchivoConsumo);
router.delete('/:id', requirePermissions(["Eliminar consumo"]), deleteConsumo);

module.exports = router;