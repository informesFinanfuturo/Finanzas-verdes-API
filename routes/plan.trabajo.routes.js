// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const requirePermissions = require('../middleware/requirePermissions');
const { createPlanTrabajo, getPlanesTrabajo, updatePlanTrabajo, completarTarea, toggleEstadoTarea, getMisPlanesTrabajo } = require('../controllers/plan.trabajo.controller');

// GET /api/plantrabajo
router.get('/mipyme/:id', requirePermissions(["Obtener planes de trabajo"]), getPlanesTrabajo);
router.get('/', requirePermissions(["Obtener planes de trabajo"]), getMisPlanesTrabajo);

// POST /api/plantrabajo
router.post('/', requirePermissions(["Crear plan de trabajo"]), createPlanTrabajo);

// PATCH /api/plantrabajo
router.patch('/tarea/:idTarea/toggle', requirePermissions(["Completar tarea"]), toggleEstadoTarea);
router.patch('/:id', requirePermissions(["Editar plan de trabajo"]), updatePlanTrabajo);

module.exports = router;