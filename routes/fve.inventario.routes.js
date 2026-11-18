'use strict';
const router = require('express').Router();
const requirePermissions = require('../middleware/requirePermissions');
const pool = require('../db');
const c = require('../controllers/fve.inventario.controller').createInventarioHandlers(pool);

router.get('/taxonomia', requirePermissions(['Obtener diagnósticos']), c.taxonomia);
router.get('/inventario/clasificar', requirePermissions(['Obtener activo']), c.clasificar);
router.get('/inventario/mipyme/:idMipyme', requirePermissions(['Obtener diagnósticos']), c.listar);
router.get('/inventario/activos/:idActivo', requirePermissions(['Obtener activo']), c.consultarActivo);
router.get('/inventario/activos/:idActivo/reemplazo', requirePermissions(['Obtener diagnósticos']), c.validarReemplazo);
router.put('/inventario/activos/:idActivo', requirePermissions(['Editar activo']), c.guardar);
module.exports = router;
