// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const {
  getAnswers,
  createAnswers,
  editAnswer,
} = require('../controllers/answer.controller');

// GET /api/roles
router.get('/', getAnswers);

// POST /api/roles
router.post('/', createAnswers);

// PUT /api/answer
router.put('/:id', editAnswer);

module.exports = router;