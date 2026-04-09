// routes/user.routes.js
const express = require('express');
const router = express.Router();
const {
  getUsers,
  loginUser,
  createUser,
  updateUser,
  getUsersMipyme,
  changeUserPassword,
  getUsersEntrepreneur,
} = require('../controllers/user.controller');

// GET /api/user
router.get('/', getUsers);
router.get('/mipyme', getUsersMipyme);
router.get('/entrepreneur', getUsersEntrepreneur);

// POST /api/user
router.post('/login', loginUser);
router.post('/', createUser);

// PUT /api/user
router.put('/:id', updateUser);
router.put('/password/:id', changeUserPassword);

module.exports = router;