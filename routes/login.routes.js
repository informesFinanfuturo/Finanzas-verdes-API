// routes/user.routes.js
const express = require('express');
const router = express.Router();
const {
  loginUser,
} = require('../controllers/login.controller');

// POST /api/user
router.post('/login', loginUser);

module.exports = router;