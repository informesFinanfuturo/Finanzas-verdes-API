// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const {
  getQuestions,
  createQuestion,
  updateQuestion,
} = require('../controllers/question.controller');

// GET /api/question
router.get('/', getQuestions);

// POST /api/question
router.post('/', createQuestion);

// PUT /api/question
router.put('/:id', updateQuestion);

module.exports = router;