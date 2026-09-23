// routes/user.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const {
  getUsers,
  createUser,
  updateAsesor,
} = require('../controllers/asesor.controller');
const { createCalendario, getClientsWithMyCalendarToday, cancelarCalendario, updateCalendario, getClientsWithMyCalendarRange } = require('../controllers/calendario.controller');

// GET /api/calendario
router.get('/today', requirePermissions(["Obtener agenda de hoy"]), getClientsWithMyCalendarToday);
router.post('/range', requirePermissions(["Obtener calendario"]), getClientsWithMyCalendarRange);

// POST /api/calendario
router.post('/', requirePermissions(["Crear calendario"]), createCalendario);

// PUT /api/calendario
router.put('/:id', requirePermissions(["Editar calendario"]), updateCalendario);

// DELETE /api/calendario
router.delete('/:id', requirePermissions(["Eliminar calendario"]), cancelarCalendario);

module.exports = router;