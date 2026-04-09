// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles
async function getEntrepreneurs(req, res) {
  try {
    const result = await pool.query(`
        SELECT e.*, u.name, u."idRol"
        FROM entrepreneur e
        INNER JOIN "user" u ON u.id = e."idUser"
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener emprendedores:', err);
    res.status(500).json({ error: 'Error al obtener emprendedores' });
  }
}

// POST /api/roles
async function createEntrepreneur (req, res) {
  const { municipality, entrepreneurshipName, sector, idUser } = req.body;

  if (!municipality || !entrepreneurshipName || !sector || !idUser) {
    return res.status(400).json({ error: 'El municipio, nombre del emprendimiento, sector económico y idUser es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO entrepreneur (municipality, "entrepreneurshipName", sector, "idUser") VALUES ($1, $2, $3, $4) RETURNING *',
      [municipality, entrepreneurshipName, sector, idUser]
    );

    const newId = result.rows[0].id;

    // 2. Consultar la Mipyme recién creada con el mismo formato de getMypime
    const query = `
      SELECT 
        e.id,
        e.municipality,
        e."entrepreneurshipName",
        e.sector,

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM entrepreneur e
      JOIN "user" u ON u.id = e."idUser"
      WHERE e.id = $1
      ORDER BY e.id;
    `;

    const resultWithUser = await pool.query(query, [newId]);

    return res.status(201).json(resultWithUser.rows[0]);
  } catch (err) {
    console.error('Error al crear emprendedor:', err);
    res.status(500).json({ error: 'Error al crear emprendedor' });
  }
}

async function updateEntrepreneur (req, res) {
  const { id } = req.params;
  const { municipality, entrepreneurshipName, sector, idUser } = req.body;

  if (!id || !municipality || !entrepreneurshipName || !sector || !idUser) {
    return res.status(400).json({ error: 'El municipio, nombre del emprendimiento, sector económico y idUser y id es obligatorio' });
  }

  try {
    const result = await pool.query(
      'UPDATE entrepreneur SET municipality = $1, "entrepreneurshipName" = $2, sector = $3, "idUser" = $4 WHERE id = $5 RETURNING *',
      [municipality, entrepreneurshipName, sector, idUser, id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al editar el emprendedor:', err);
    res.status(500).json({ error: 'Error al editar emprendedor' });
  }
}

async function getEntrepreneur(req, res) {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        e.id,
        e.municipality,
        e."entrepreneurshipName",
        e.sector,

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM entrepreneur e
      JOIN "user" u ON u.id = m."iduser"
      WHERE e.id = $1
      ORDER BY e.id;
    `;

    const result = await pool.query(query, [id]);

    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Emprendedor no encontrado" });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Error al obtener emprendedor:', err);
    res.status(500).json({ error: 'Error al obtener emprendedor' });
  }
}

async function getEntrepreneurByUser(req, res) {
  try {
    const { idUser } = req.params;

    const query = `
      SELECT 
        e.id,
        e.municipality,
        e."entrepreneurshipName",
        e.sector,

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user

      FROM entrepreneur e
      JOIN "user" u ON u.id = e."idUser"
      WHERE u.id = $1
      ORDER BY e.id;
    `;

    const result = await pool.query(query, [idUser]);

    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Emprendedor no encontrado" });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error('Error al obtener emprendedor:', err);
    res.status(500).json({ error: 'Error al obtener emprendedor' });
  }
}

module.exports = {
  getEntrepreneurs,
  createEntrepreneur,
  getEntrepreneur,
  getEntrepreneurByUser,
  updateEntrepreneur
};