// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const {
  createItem,
  getItemsMyCatalog,
  getItemById,
  getCatalogoAdmin,
  updateItem,
  uploadImagenItem,
  deleteImagenItem,
  iniciarSincronizacionManual,
  getSincronizacionById,
  getHistorialSincronizaciones,
  getSincronizacionLogsById,
} = require(
  '../controllers/catalogo.controller'
);
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');

// GET /api/roles
//router.get('/', getRols);
router.get('/', requirePermissions(["Obtener catálogo"]), getItemsMyCatalog);
router.get(
  '/admin',
  requirePermissions([
    'Obtener catálogo',
  ]),
  getCatalogoAdmin,
);
router.post(
  '/sync',
  requirePermissions([
    'Sincronizar catálogo',
  ]),
  iniciarSincronizacionManual,
);

router.get(
  '/sync/history',
  requirePermissions([
    'Sincronizar catálogo',
  ]),
  getHistorialSincronizaciones,
);

router.get(
  '/sync/:id/logs',
  requirePermissions([
    'Sincronizar catálogo',
  ]),
  getSincronizacionLogsById,
);

router.get(
  '/sync/:id',
  requirePermissions([
    'Sincronizar catálogo',
  ]),
  getSincronizacionById,
);
router.get('/:id', requirePermissions(["Obtener item catálogo"]), getItemById);

// POST /api/roles
router.post('/', requirePermissions(["Crear item catálogo"]), createItem);
router.post('/upload', upload.single('image'), uploadImagenItem);
// PATCH /api/roles
router.patch('/:id', requirePermissions(["Editar item catálogo"]), updateItem);

// DELETE /api/catalogo
router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen catálogo"]), deleteImagenItem);


module.exports = router;