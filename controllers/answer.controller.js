// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles
async function getAnswers(req, res) {
  try {
    const result = await pool.query('SELECT * FROM answer ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener las respuestas:', err);
    res.status(500).json({ error: 'Error al obtener respuestas' });
  }
}

// POST /api/answer
async function createAnswers(req, res) {
  const { answer, description, score, idQuestion } = req.body;

  if (!answer || !idQuestion) {
    return res.status(400).json({ error: 'La respuesta, puntaje y idQuestion es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO answer (answer, description, score, "idQuestion") VALUES ($1, $2, $3, $4) RETURNING *',
      [answer, description || null, score, idQuestion]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear respuesta:', err);
    res.status(500).json({ error: 'Error al crear respuesta' });
  }
}

// PUT api/answer
async function editAnswer(req, res) {
  const { id } = req.params; // id de la respuesta a actualizar
  const { answer, description, score, idQuestion } = req.body;

  // Validar que se envíe al menos un campo para actualizar
  if (!answer && !description && score === undefined && !idQuestion) {
    return res
      .status(400)
      .json({ error: 'Debe enviar al menos un campo para actualizar' });
  }

  try {
    // Construimos dinámicamente el SET según los campos enviados
    const fields = [];
    const values = [];
    let index = 1;

    if (answer !== undefined) {
      fields.push(`answer = $${index++}`);
      values.push(answer);
    }

    if (description !== undefined) {
      fields.push(`description = $${index++}`);
      values.push(description || null);
    }

    if (score !== undefined) {
      fields.push(`score = $${index++}`);
      values.push(score);
    }

    if (idQuestion !== undefined) {
      fields.push(`"idQuestion" = $${index++}`);
      values.push(idQuestion);
    }

    // Añadimos el id al final para el WHERE
    values.push(id);

    const query = `
      UPDATE answer
      SET ${fields.join(', ')}
      WHERE id = $${index}
      RETURNING *;
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Respuesta no encontrada' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al editar respuesta:', err);
    res.status(500).json({ error: 'Error al editar respuesta' });
  }
}

module.exports = {
  getAnswers,
  createAnswers,
  editAnswer
};