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
} = require('../controllers/activo.controller');

// POST /api/activo
router.post('/', requirePermissions(["Crear activo"]), createActivo);
router.post('/upload', upload.single('image'), uploadImagenActivo);

// GET /api/activo
router.get('/:id', requirePermissions(["Obtener activo"]), getActivoById);

// PATCH /api/activo
router.patch('/:id', requirePermissions(["Editar activo"]), updateActivo);

// DELETE /api/activo
router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen activo"]), deleteImagenActivo);

module.exports = router;