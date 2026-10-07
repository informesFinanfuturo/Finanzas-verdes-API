const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');

const {
  createTipoProveedor,
  getTipoProveedores,
  getProveedoresAdmin

} = require('../controllers/proveedor.controller');

// POST /api/activo
router.post('/tipo', requirePermissions(["Crear tipo proveedor"]), createTipoProveedor);
//router.post('/upload', upload.single('image'), uploadImagenActivo);

// GET /api/activo
router.get(
  '/admin',
  requirePermissions([
    'Obtener proveedores',
  ]),
  getProveedoresAdmin,
);

router.get('/tipo', requirePermissions(["Obtener tipos proveedores"]), getTipoProveedores);

// PATCH /api/activo
//router.patch('/:id', requirePermissions(["Editar activo"]), updateActivo);

// DELETE /api/activo
//router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen activo"]), deleteImagenActivo);

module.exports = router;