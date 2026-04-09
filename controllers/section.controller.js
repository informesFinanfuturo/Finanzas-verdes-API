// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles
async function getSections(req, res) {
  try {
    const result = await pool.query('SELECT * FROM section ORDER BY "order"');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener las secciones:', err);
    res.status(500).json({ error: 'Error al obtener secciones' });
  }
}

// GET /api/section/question
async function getSectionsComplete(req, res) {
  try {
    const query = `
      SELECT
        s.id AS section_id,
        s.name AS section_name,

        q.id AS question_id,
        q.question AS question_text,
        q."description" AS question_description,

        a.id AS answer_id,
        a.answer AS answer_text,
        a."description" AS answer_description,
        a.score AS answer_score

      FROM section s
      LEFT JOIN question q ON q."idSection" = s.id
      LEFT JOIN answer a ON a."idQuestion" = q.id
      ORDER BY q.order, a.score;
    `;

    const { rows } = await pool.query(query);

    const sectionsMap = new Map();

    for (const row of rows) {

      // 1️⃣ SECCIÓN
      let section = sectionsMap.get(row.section_id);
      if (!section) {
        section = {
          id: row.section_id,
          name: row.section_name,
          questions: [],
          _questionsMap: new Map()
        };
        sectionsMap.set(row.section_id, section);
      }

      // Si no hay pregunta (sección sin preguntas)
      if (!row.question_id) continue;

      // 2️⃣ PREGUNTA
      let question = section._questionsMap.get(row.question_id);
      if (!question) {
        question = {
          id: row.question_id,
          question: row.question_text,
          description: row.question_description,
          answers: []
        };
        section._questionsMap.set(row.question_id, question);
        section.questions.push(question);
      }

      // 3️⃣ RESPUESTA
      if (row.answer_id) {
        question.answers.push({
          id: row.answer_id,
          answer: row.answer_text,
          description: row.answer_description,
          score: row.answer_score
        });
      }
    }

    // Limpieza del _questionsMap antes de enviar
    const sections = Array.from(sectionsMap.values()).map(section => {
      const { _questionsMap, ...cleanSection } = section;
      return cleanSection;
    });

    res.json(sections);
  } catch (err) {
    console.error("Error al obtener las secciones:", err);
    res.status(500).json({ error: "Error al obtener secciones" });
  }
}


// POST /api/roles
async function createSection(req, res) {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO section (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear rol:', err);
    res.status(500).json({ error: 'Error al crear rol' });
  }
}

module.exports = {
  getSections,
  createSection,
  getSectionsComplete
};