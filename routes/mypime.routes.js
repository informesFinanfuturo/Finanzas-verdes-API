// routes/roles.routes.js
const express = require('express');
const router = express.Router();
const {
  getMypimes,
  createMypime,
  getMypime,
  getMypimeUser,
  updateMypime,
} = require('../controllers/mypime.controller');

// GET /api/mypime
router.get('/', getMypimes);
router.get('/:id', getMypime);
router.get('/user/:id', getMypimeUser);

// POST /api/mypime
router.post('/', createMypime);

// PUT /api/mypime
router.put('/:id', updateMypime);

module.exports = router;