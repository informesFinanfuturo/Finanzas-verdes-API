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
  getClientsByEstado,
} = require('../controllers/client.controller');

// GET /api/client
router.get('/', requirePermissions(["Obtener clientes"]), getClients);
router.get('/estado', requirePermissions(["Obtener clientes"]), getClientsByEstado);
router.get('/images/:id', requirePermissions(["Obtener cliente"]), getPreviewInfoClient);
router.get('/mipyme/:id', requirePermissions(["Obtener mipyme"]), getMipymeByUsuario);
router.get('/activo/:id', requirePermissions(["Obtener activos"]), getActivosByUsuario);
router.get('/consumo/:id', requirePermissions(["Obtener consumos"]), getConsumosByUsuario);
router.get('/search', requirePermissions(["Buscar cliente"]), searchClientByNitOrDocumento);
router.get('/:id', requirePermissions(["Obtener cliente"]), getClienteFull);

// POST /api/client
router.post('/', requirePermissions(["Crear cliente"]), createClient);
router.post('/mipyme', requirePermissions(["Crear mipyme"]), createMipyme);
// PARCHE_PROSPECTO_ALTA_DIRECTA_V1
// El asesor registra un prospecto y lo convierte; el alta directa se reserva a Administracion.
function soloAltaDirectaAdministrativa(req, res, next) {
  const rol = String(req.user?.nombre_rol || '').toLowerCase();
  if (rol !== 'administrador' && rol !== 'super administrador') {
    return res.status(403).json({ error: 'Use el flujo Prospectos -> Convertir en cliente' });
  }
  next();
}
router.post('/client-mipyme', requirePermissions(["Crear mipyme", "Crear cliente"]),
  soloAltaDirectaAdministrativa, createClientWithMipyme);

// PUT /api/user
router.patch('/:id', requirePermissions(["Editar cliente"]), updateClient);
router.patch('/mipyme/:id', requirePermissions(["Editar mipyme"]), updateMipyme);

// DELETE /api/user
router.delete('/:id', requirePermissions(["Desactivar cliente"]), inactiveClient);

module.exports = router;