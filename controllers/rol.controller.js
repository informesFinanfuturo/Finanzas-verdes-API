// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles
async function getRoles(req, res) {
  try {
    const result = await pool.query('SELECT * FROM rol ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener roles:', err);
    res.status(500).json({ error: 'Error al obtener roles' });
  }
}

// POST /api/roles
async function createRole(req, res) {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO rol (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear rol:', err);
    res.status(500).json({ error: 'Error al crear rol' });
  }
}

module.exports = {
  getRoles,
  createRole,
};