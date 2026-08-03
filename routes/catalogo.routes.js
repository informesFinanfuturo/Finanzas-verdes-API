// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const { createItem, getItemsMyCatalog, getItemById, updateItem, uploadImagenItem, deleteImagenItem } = require('../controllers/catalogo.controller');
const requirePermissions = require('../middleware/requirePermissions');
const upload = require('../upload');

// GET /api/roles
//router.get('/', getRols);
router.get('/', requirePermissions(["Obtener catálogo"]), getItemsMyCatalog);
router.get('/:id', requirePermissions(["Obtener item catálogo"]), getItemById);

// POST /api/roles
router.post('/', requirePermissions(["Crear item catálogo"]), createItem);
router.post('/upload', upload.single('image'), uploadImagenItem);

// PATCH /api/roles
router.patch('/:id', requirePermissions(["Editar item catálogo"]), updateItem);

// DELETE /api/catalogo
router.delete('/image/:id_archivo', requirePermissions(["Eliminar imagen catálogo"]), deleteImagenItem);


module.exports = router;