// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const {
  getClients,
  createClient,
  updateClient,
  getClienteFull,
  createMipyme,
  updateMipyme,
  getPreviewInfoClient,
  getMipymeByUsuario,
  getActivosByUsuario,
  getConsumosByUsuario,
  createClientWithMipyme,
  inactiveClient,
  searchClientByNitOrDocumento,
} = require('../controllers/client.controller');

// GET /api/client
router.get('/', requirePermissions(["Obtener clientes"]), getClients);
router.get('/images/:id', requirePermissions(["Obtener cliente"]), getPreviewInfoClient);
router.get('/mipyme/:id', requirePermissions(["Obtener mipyme"]), getMipymeByUsuario);
router.get('/activo/:id', requirePermissions(["Obtener activos"]), getActivosByUsuario);
router.get('/consumo/:id', requirePermissions(["Obtener consumos"]), getConsumosByUsuario);
router.get('/search', requirePermissions(["Buscar cliente"]), searchClientByNitOrDocumento);
router.get('/:id', requirePermissions(["Obtener cliente"]), getClienteFull);

// POST /api/client
router.post('/', requirePermissions(["Crear cliente"]), createClient);
router.post('/mipyme', requirePermissions(["Crear mipyme"]), createMipyme);
router.post('/client-mipyme', requirePermissions(["Crear mipyme", "Crear cliente"]), createClientWithMipyme);

// PUT /api/user
router.patch('/:id', requirePermissions(["Editar cliente"]), updateClient);
router.patch('/mipyme/:id', requirePermissions(["Editar mipyme"]), updateMipyme);

// DELETE /api/user
router.delete('/:id', requirePermissions(["Desactivar cliente"]), inactiveClient);

module.exports = router;