// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles

async function getDiagnosisForProcess(req, res) {
  const { idProcess } = req.params;

  if (!idProcess) {
    return res.status(400).json({
      error: 'idProcess es obligatorio en los parámetros de la ruta',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        d.id,
        d.score,
        d.diagnosis,
        d."idProcess",
        d."idSection",

        json_build_object(
          'id', s.id,
          'name', s.name,
          'order', s.order
        ) AS section,

        (
          SELECT json_agg(
            json_build_object(
              'idAnswerProcess', ap.id,
              'observations', ap.observations,
              'answer',
                json_build_object(
                  'id', a.id,
                  'answer', a.answer,
                  'description', a.description,
                  'score', a.score,
                  'idQuestion', a."idQuestion"
                ),
              'question',
                json_build_object(
                  'id', q.id,
                  'question', q.question,
                  'description', q.description,
                  'idSection', q."idSection"
                )
            )
          )
          FROM "answerProcess" ap
          JOIN answer a ON a.id = ap."idAnswer"
          JOIN question q ON q.id = a."idQuestion"
          WHERE ap."idProcess" = d."idProcess"
          AND q."idSection" = d."idSection"
        ) AS answers

      FROM diagnosis d
      JOIN section s ON s.id = d."idSection"
      WHERE d."idProcess" = $1
      ORDER BY s."order"
      `,
      [idProcess]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'No hay diagnosis registrados para este proceso',
      });
    }

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('Error al obtener diagnosis:', err);
    return res.status(500).json({
      error: 'Error interno al obtener diagnosis',
    });
  }
}


// POST /api/diagnosis


async function generateDiagnosis(req, res) {
  const { idProcess } = req.params;

  if (!idProcess) {
    return res.status(400).json({
      error: 'idProcess es obligatorio en los parámetros de la ruta',
    });
  }

  try {
    const diagnosisRows = await calculateDiagnosisForProcess(idProcess);

    return res.status(201).json({
      message: 'Diagnosis generado correctamente',
      diagnosis: diagnosisRows,
    });
  } catch (err) {
    console.error('Error al generar diagnosis:', err);
    return res.status(500).json({
      error: 'Error interno al generar diagnosis',
    });
  }
}


async function calculateDiagnosisForProcess(idProcess) {
  if (!idProcess) {
    throw new Error('idProcess es obligatorio para calcular diagnosis');
  }

  try {
    await pool.query('BEGIN');

    // 1) Borrar diagnosis anteriores de este proceso (para no duplicar)
    await pool.query(
      `DELETE FROM diagnosis WHERE "idProcess" = $1`,
      [idProcess]
    );

    // 2) Insertar nuevos diagnosis calculando por sección
    const insertResult = await pool.query(
      `
      WITH inserted AS (
        INSERT INTO diagnosis (score, diagnosis, "idProcess", "idSection")
        SELECT
            CASE 
            WHEN (COUNT(DISTINCT q.id) * 3) = 0 THEN 0
            ELSE ROUND(
                (
                SUM(
                    CASE 
                    WHEN ap.id IS NOT NULL THEN a.score 
                    ELSE 0 
                    END
                )::numeric
                / (COUNT(DISTINCT q.id) * 3)::numeric
                ) * 100,
                2
            )
            END AS score,
            NULL::text AS diagnosis,
            $1 AS "idProcess",
            s.id AS "idSection"
        FROM section s
        JOIN question q ON q."idSection" = s.id
        LEFT JOIN answer a ON a."idQuestion" = q.id
        LEFT JOIN "answerProcess" ap
            ON ap."idAnswer" = a.id
        AND ap."idProcess" = $1
        GROUP BY s.id
        RETURNING *
        )
        SELECT * FROM inserted;
      `,
      [idProcess]
    );

    await pool.query('COMMIT');

    // Devuelvo los diagnosis creados por si los quieres mostrar/loggear
    return insertResult.rows;
  } catch (err) {
    console.error('Error al calcular diagnosis:', err);
    try {
      await pool.query('ROLLBACK');
    } catch (_) {}
    throw err;
  }
}


module.exports = {
  generateDiagnosis,
  getDiagnosisForProcess
};