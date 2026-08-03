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
  deleteImagenConsumo,
  analizarConsumo,
  deleteConsumo,
} = require('../controllers/consumo.controller');

// GET /api/roles
router.get('/:id', getConsumoById);

// POST /api/roles
router.post('/', requirePermissions(["Crear consumo"]), createConsumo);
router.post('/upload', upload.single('image'), uploadImagenConsumo);
router.post('/analizar/:id', requirePermissions(["Analizar consumo"]) , analizarConsumo);


// PATCH /api/roles
router.patch('/:id', requirePermissions(["Editar consumo"]), updateConsumo);

// DELETE /api/activo
router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen consumo"]), deleteImagenConsumo);
router.delete('/:id', requirePermissions(["Eliminar consumo"]), deleteConsumo);

module.exports = router;