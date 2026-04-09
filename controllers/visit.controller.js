// controllers/visit.controller.js
const pool = require('../db');

// GET /api/visists
async function getVisits(req, res) {
  try {
    const query = `
    SELECT
  v.id,
  v.date,
  json_build_object(
    'id', u_mypime.id,
    'name', u_mypime.name,
    'email', u_mypime.email,
    'idRol', u_mypime."idRol"
  ) AS mypime,
  json_build_object(
    'id', u_mentor.id,
    'name', u_mentor.name,
    'email', u_mentor.email,
    'idRol', u_mentor."idRol"
  ) AS mentor,
  json_build_object(
    'id', p.id,
    'diagnosis', p.diagnosis,
    'idMipyme', p."idMipyme",
    'questions', p."questions"
  ) AS process
FROM visit v
JOIN "user" u_mypime ON u_mypime.id = v."idMypime"
JOIN "user" u_mentor ON u_mentor.id = v."idMentor"
LEFT JOIN "process" p ON p.id = v."idProcess"
ORDER BY v.date DESC;
    `;

    const result = await pool.query(query);

    // rows ya viene con mypime y mentor como objetos JSON
    return res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener visitas:', err);
    return res.status(500).json({ error: 'Error al obtener visitas' });
  }
}

// POST /api/roles
async function createVisit(req, res) {
  const { date, idMypime, idMentor } = req.body;

  if (!date || !idMypime || !idMentor) {
    return res.status(400).json({
      error: 'date, idMypime e idMentor son obligatorios'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const insertVisitQuery = `
      INSERT INTO visit (date, "idProcess", "idMypime", "idMentor")
      VALUES (
        $1,
        (SELECT p.id
           FROM process p
          WHERE p."idMipyme" = $2
          ORDER BY p.id DESC
          LIMIT 1),
        $2,
        $3
      )
      RETURNING *
    `;

    const insert = await client.query(insertVisitQuery, [date, idMypime, idMentor]);
    const visit = insert.rows[0];

    const queryUsers = `
      SELECT 
        json_build_object(
          'id', u_m.id,
          'name', u_m.name,
          'email', u_m.email,
          'idRol', u_m."idRol"
        ) AS mypime,
        json_build_object(
          'id', u_t.id,
          'name', u_t.name,
          'email', u_t.email,
          'idRol', u_t."idRol"
        ) AS mentor
      FROM "user" u_m
      JOIN "user" u_t ON u_t.id = $2
      WHERE u_m.id = $1
    `;

    const users = await client.query(queryUsers, [visit.idMypime, visit.idMentor]);
    const { mypime, mentor } = users.rows[0];

    await client.query('COMMIT');

    return res.status(201).json({
      visit: {
        id: visit.id,
        date: visit.date,
        idProcess: visit.idProcess,
        mypime,
        mentor
      }
    });

  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Error al crear visita:', err);
    return res.status(500).json({ error: 'Error al crear visita' });
  } finally {
    client.release();
  }
}

module.exports = {
  getVisits,
  createVisit,
};