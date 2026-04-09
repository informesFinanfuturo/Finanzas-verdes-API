// controllers/roles.controller.js
const pool = require('../db');

// GET /api/question
async function getQuestions(req, res) {
  try {
    const result = await pool.query('SELECT * FROM question ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener las preguntas:', err);
    res.status(500).json({ error: 'Error al obtener preguntas' });
  }
}

// POST /api/question
async function createQuestion(req, res) {
  const { question, description, idSection } = req.body;

  if (!question || !idSection) {
    return res.status(400).json({ error: 'La pregunta y idSection es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO question (question, description, "idSection") VALUES ($1, $2, $3) RETURNING *',
      [question, description || null, idSection]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear pregunta:', err);
    res.status(500).json({ error: 'Error al crear pregunta' });
  }
}

// PUT /api/question

async function updateQuestion(req, res) {
  const { id } = req.params;
  const { question, description, idSection } = req.body;

  try {
    // Validaciones básicas
    if (!question || !idSection) {
      return res.status(400).json({
        error: "la pregunta y idSection son obligatorios",
      });
    }

    const query = `
      UPDATE question
      SET "question" = $1,
          "description" = $2,
          "idSection" = $3
      WHERE id = $4
      RETURNING id, question, "description", "idSection";
    `;

    const values = [question, description, idSection, id];

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      // No se encontró la pregunta con ese id
      return res.status(404).json({ error: "Pregunta no encontrada" });
    }

    // Éxito: devolvemos la pregunta actualizada
    return res.json({
      message: "Pregunta actualizada correctamente",
      question: rows[0],
    });
  } catch (err) {
    console.error("Error al actualizar la pregunta:", err);
    return res
      .status(500)
      .json({ error: "Error al actualizar la pregunta" });
  }
}


module.exports = {
  getQuestions,
  createQuestion,
  updateQuestion
};