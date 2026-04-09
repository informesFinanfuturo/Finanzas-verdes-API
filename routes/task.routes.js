// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const { getTasks, createTask, editTaskCompleted, editTask, removeTask } = require('../controllers/task.controller');

// GET /api/roles
router.get('/', getTasks);

// POST /api/roles
router.post('/', createTask);

// PUT /api/roles
router.put('/completed/:id', editTaskCompleted);
router.put('/:id', editTask);

// DELETE /api/task
router.delete('/:id', removeTask);

module.exports = router;