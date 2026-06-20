// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const {
  changeUserPassword,
  getClients,
  createClient,
  updateClient,
  getClienteFull,
  createMipyme,
  updateMipyme,
} = require('../controllers/client.controller');

// GET /api/client
router.get('/', requirePermissions(["Obtener clientes"]), getClients);
router.get('/:id', requirePermissions(["Obtener cliente"]), getClienteFull);

// POST /api/client
router.post('/', requirePermissions(["Crear cliente"]), createClient);
router.post('/mipyme', requirePermissions(["Crear mipyme"]), createMipyme);

// PUT /api/user
router.patch('/:id', requirePermissions(["Editar cliente"]), updateClient);
router.patch('/mipyme/:id', requirePermissions(["Editar mipyme"]), updateMipyme);

module.exports = router;