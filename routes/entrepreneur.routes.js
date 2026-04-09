// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const { getEntrepreneurs, createEntrepreneur, getEntrepreneur, getEntrepreneurByUser, updateEntrepreneur } = require('../controllers/entrepreneur.controller');

// GET /api/entrepreneur
router.get('/', getEntrepreneurs);
router.get('/:id', getEntrepreneur);
router.get('/user/:idUser', getEntrepreneurByUser);

// POST /api/entrepreneur
router.post('/', createEntrepreneur);

// PUT /api/entrepreneur
router.put('/:id', updateEntrepreneur);

module.exports = router;