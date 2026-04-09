// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const { getSections, createSection, getSectionsComplete } = require('../controllers/section.controller');

// GET /api/roles
router.get('/', getSections);
router.get('/question', getSectionsComplete);

// POST /api/roles
router.post('/', createSection);

module.exports = router;