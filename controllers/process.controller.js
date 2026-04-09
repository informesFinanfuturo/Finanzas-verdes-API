// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles
async function getProcesses(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT 
        p.id,
        p.diagnosis,
        p."idMipyme",
        p.questions,

        json_build_object(
          'id', u.id,
          'name', u.name,
          'email', u.email,
          'idRol', u."idRol"
        ) AS user,
        
        json_build_object(
          'id', m.id,
          'name', m.name,
          'email', m.email,
          'idRol', m."idRol"
        ) AS mentor

      FROM "process" p
      JOIN "user" u ON u.id = p."idMipyme"
      JOIN "user" m ON m.id = p."idMentor"
      ORDER BY p.id;
      `
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los procesos:', err);
    res.status(500).json({ error: 'Error al obtener procesos' });
  }
}

// GET /api/process/answer/:idProcess
async function getAnswersByProcess(req, res) {
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
        ap.id AS "id",
        ap.observations,
        ap."idAnswer",
        ap."idProcess",

        json_build_object(
          'id', a.id,
          'answer', a.answer,
          'description', a.description,
          'score', a.score,
          'idQuestion', a."idQuestion"
        ) AS answer,

        json_build_object(
          'id', q.id,
          'question', q.question,
          'description', q.description,
          'idSection', q."idSection"
        ) AS question

      FROM "answerProcess" ap
      JOIN answer a ON a.id = ap."idAnswer"
      JOIN question q ON q.id = a."idQuestion"
      WHERE ap."idProcess" = $1
      ORDER BY q.order DESC;
      `,
      [idProcess]
    );

    // Devuelves una lista de registros
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error al obtener respuestas por proceso:', err);
    return res.status(500).json({
      error: 'Error interno al obtener respuestas por proceso',
    });
  }
}

// DELETE /api/process/answer/:id

async function deleteAnswerProcess(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      error: 'id es obligatorio en los parámetros de la ruta',
    });
  }

  try {
    await pool.query('BEGIN');

    // 1. Eliminar el registro y obtener idProcess antes de borrarlo
    const result = await pool.query(
      `
      DELETE FROM "answerProcess"
      WHERE id = $1
      RETURNING *, "idProcess";
      `,
      [id]
    );

    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({
        error: 'No se encontró un registro con el id especificado',
      });
    }

    const idProcess = result.rows[0].idProcess;

    // 2. Actualizar el proceso → questions = false SIEMPRE
    await pool.query(
      `
      UPDATE process
      SET questions = FALSE
      WHERE id = $1
      `,
      [idProcess]
    );

    await pool.query('COMMIT');

    return res.status(200).json({
      message: 'Registro eliminado correctamente. Se actualizó process.questions = false.',
      deleted: result.rows[0],
    });
  } catch (err) {
    console.error('Error al eliminar registro:', err);
    try {
      await pool.query('ROLLBACK');
    } catch (_) {}

    return res.status(500).json({
      error: 'Error interno al eliminar el registro',
    });
  }
}



// POST /api/process

async function createProcess(req, res) {
  const { diagnosis, idVisit, idMipyme, idMentor } = req.body;

  // idVisit SÍ es obligatorio para poder enlazar el proceso con la visita
  if (!idVisit) {
    return res.status(400).json({
      error: 'idVisit es obligatorio',
    });
  }

  try {
    // Opcional pero recomendado: transacción para mantener consistencia
    await pool.query('BEGIN');

    // 1. Crear el proceso (diagnosis es opcional, puede ir null)
    const processResult = await pool.query(
      `INSERT INTO process (diagnosis, "idMipyme", "idMentor")
       VALUES ($1, $2, $3)
       RETURNING id, diagnosis, "idMipyme", questions`,
      [diagnosis || null, idMipyme, idMentor]
    );

    const process = processResult.rows[0];

    // 2. Asociar el proceso a la visita
    const visitResult = await pool.query(
      `UPDATE visit
       SET "idProcess" = $1
       WHERE id = $2
       RETURNING *`,
      [process.id, idVisit]
    );

    // Si no existe la visita, revertimos
    if (visitResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({
        error: 'Visita no encontrada para el idVisit proporcionado',
      });
    }

    const visit = visitResult.rows[0];

    // 3. Confirmar la transacción
    await pool.query('COMMIT');

    // 4. Respuesta
    return res.status(201).json({
      message: 'Proceso creado y asociado a la visita',
      process,
      visit,
    });
  } catch (err) {
    console.error('Error al crear proceso:', err);
    // Si algo falla dentro de la transacción, revertimos
    try {
      await pool.query('ROLLBACK');
    } catch (_) {}
    return res.status(500).json({
      error: 'Error interno al crear proceso',
    });
  }
}

// POST /api/process/answer
async function createAnswerProcess(req, res) {
  const { observations, idAnswer, idProcess } = req.body;

  if (!idAnswer || !idProcess) {
    return res.status(400).json({
      error: 'idAnswer y idProcess son obligatorios',
    });
  }

  try {
    await pool.query('BEGIN');

    // 1. Insertar en answerProcess
    const answerProcessResult = await pool.query(
      `INSERT INTO "answerProcess" (observations, "idAnswer", "idProcess")
       VALUES ($1, $2, $3)
       RETURNING id, observations, "idAnswer", "idProcess"`,
      [observations || null, idAnswer, idProcess]
    );

    const answerProcess = answerProcessResult.rows[0];

    // 2. Obtener answer + question asociados
    const answerQuestionResult = await pool.query(
      `
      SELECT 
        json_build_object(
          'id', a.id,
          'answer', a.answer,
          'description', a.description,
          'score', a.score,
          'idQuestion', a."idQuestion"
        ) AS answer,
        
        json_build_object(
          'id', q.id,
          'question', q.question,
          'description', q.description,
          'idSection', q."idSection"
        ) AS question
      FROM "answerProcess" ap
      JOIN answer a ON a.id = ap."idAnswer"
      JOIN question q ON q.id = a."idQuestion"
      WHERE ap.id = $1
      `,
      [answerProcess.id]
    );

    const { answer, question } = answerQuestionResult.rows[0];

    // 3. Comprobar si el proceso ya tiene TODAS las preguntas respondidas
    const completenessResult = await pool.query(
      `
      SELECT
        -- Total de preguntas del cuestionario
        (SELECT COUNT(*)::int FROM question) AS total_questions,
        
        -- Total de preguntas distintas que ya tienen al menos una respuesta en este proceso
        (
          SELECT COUNT(DISTINCT a."idQuestion")::int
          FROM "answerProcess" ap
          JOIN answer a ON a.id = ap."idAnswer"
          WHERE ap."idProcess" = $1
        ) AS answered_questions
      `,
      [idProcess]
    );

    const { total_questions, answered_questions } = completenessResult.rows[0];

    let processCompleted = false;

    if (total_questions > 0 && answered_questions === total_questions) {
      // 4. Marcar el proceso como completo en la columna "questions"
      await pool.query(
        `
        UPDATE process
        SET questions = TRUE
        WHERE id = $1
        `,
        [idProcess]
      );
      processCompleted = true;
    }

    // 5. Confirmar la transacción
    await pool.query('COMMIT');

    // 6. Respuesta final
    return res.status(201).json({
      message: 'Proceso creado y asociado a la visita',
      answerProcess,      // relación answerProcess
      answer,             // datos de la respuesta
      question,           // datos de la pregunta
      processCompleted,   // true si ya respondió todas las preguntas
      total_questions,
      answered_questions,
    });
  } catch (err) {
    console.error('Error al crear proceso:', err);

    try {
      await pool.query('ROLLBACK');
    } catch (_) {}

    return res.status(500).json({
      error: 'Error interno al crear proceso',
    });
  }
}

// GET /api/process/:id/full
async function getProcessFull(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'id es obligatorio en la ruta' });

  try {
    const query = `
      WITH proc AS (
        SELECT
          p.id,
          p.diagnosis,
          p.questions,
          p."idMipyme",
          p."idMentor",

          json_build_object(
            'id', mentor.id,
            'name', mentor.name,
            'email', mentor.email,
            'idRol', mentor."idRol"
          ) AS mentor,

          json_build_object(
            'id', client.id,
            'name', client.name,
            'email', client.email,
            'idRol', client."idRol"
          ) AS client,

          to_jsonb(mi) AS mipyme_details,
          to_jsonb(en) AS entrepreneur_details

        FROM "process" p
        JOIN "user" client ON client.id = p."idMipyme"
        JOIN "user" mentor ON mentor.id = p."idMentor"

        LEFT JOIN "mypime" mi ON mi."iduser" = client.id
        LEFT JOIN "entrepreneur" en ON en."idUser" = client.id

        WHERE p.id = $1
      ),

      -- % total del proceso (mismo criterio que tu calculateDiagnosisForProcess)
      total AS (
        SELECT
          CASE
            WHEN (COUNT(DISTINCT q.id) * 3) = 0 THEN 0
            ELSE ROUND(
              (
                SUM(CASE WHEN ap.id IS NOT NULL THEN a.score ELSE 0 END)::numeric
                / (COUNT(DISTINCT q.id) * 3)::numeric
              ) * 100, 2
            )
          END AS total_percent
        FROM question q
        LEFT JOIN answer a ON a."idQuestion" = q.id
        LEFT JOIN "answerProcess" ap
          ON ap."idAnswer" = a.id
         AND ap."idProcess" = $1
      ),

      sections_json AS (
        SELECT json_agg(
          json_build_object(
            'id', s.id,
            'name', s.name,
            'order', s."order",

            -- diagnosis por sección (si existe en tabla diagnosis) + fallback al cálculo al vuelo
            'diagnosis', json_build_object(
              'id', d.id,
              'score', COALESCE(d.score, calc.section_percent),
              'diagnosis', d.diagnosis,
              'idProcess', $1,
              'idSection', s.id
            ),

            'questions', COALESCE(qs.questions, '[]'::json),

            -- workPlan por sección: workPlans[] + percent sección (tareas completadas / total)
            'workPlan', COALESCE(wp.work_plan, json_build_object('percent', 0, 'workPlans', '[]'::json))
          )
          ORDER BY s."order"
        ) AS sections
        FROM section s

        LEFT JOIN diagnosis d
          ON d."idSection" = s.id
         AND d."idProcess" = $1

        -- % por sección al vuelo (si no hay diagnosis guardado)
        LEFT JOIN LATERAL (
          SELECT
            CASE
              WHEN (COUNT(DISTINCT q2.id) * 3) = 0 THEN 0
              ELSE ROUND(
                (
                  SUM(CASE WHEN ap2.id IS NOT NULL THEN a2.score ELSE 0 END)::numeric
                  / (COUNT(DISTINCT q2.id) * 3)::numeric
                ) * 100, 2
              )
            END AS section_percent
          FROM question q2
          LEFT JOIN answer a2 ON a2."idQuestion" = q2.id
          LEFT JOIN "answerProcess" ap2
            ON ap2."idAnswer" = a2.id
           AND ap2."idProcess" = $1
          WHERE q2."idSection" = s.id
        ) calc ON true

        -- preguntas por sección + respuestas + cuál fue seleccionada (answerProcess)
        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'id', q.id,
              'question', q.question,
              'description', q.description,
              'order', q."order",
              'answers', COALESCE(ans.answers, '[]'::json)
            )
            ORDER BY q."order"
          ) AS questions
          FROM question q

          LEFT JOIN LATERAL (
            SELECT json_agg(
              json_build_object(
                'id', a.id,
                'answer', a.answer,
                'description', a.description,
                'score', a.score,
                'selected', (ap.id IS NOT NULL),
                'answerProcess', CASE WHEN ap.id IS NULL THEN NULL ELSE json_build_object(
                  'id', ap.id,
                  'observations', ap.observations,
                  'idAnswer', ap."idAnswer",
                  'idProcess', ap."idProcess"
                ) END
              )
              ORDER BY a.score
            ) AS answers
            FROM answer a
            LEFT JOIN "answerProcess" ap
              ON ap."idAnswer" = a.id
             AND ap."idProcess" = $1
            WHERE a."idQuestion" = q.id
          ) ans ON true

          WHERE q."idSection" = s.id
        ) qs ON true

        -- workPlans por sección + tareas + % por plan + % total sección
        LEFT JOIN LATERAL (
          SELECT json_build_object(
            'percent',
              COALESCE(sec_percent.section_percent, 0),
            'workPlans',
              COALESCE(wps.work_plans, '[]'::json)
          ) AS work_plan
          FROM
          -- % de sección basado en tareas completadas / total (workPlans de esa sección)
          LATERAL (
            SELECT
              CASE WHEN COUNT(t.id) = 0 THEN 0
                   ELSE ROUND(
                     (SUM(CASE WHEN t.completed THEN 1 ELSE 0 END)::numeric / COUNT(t.id)::numeric) * 100,
                     2
                   )
              END AS section_percent
            FROM "workPlan" w2
            LEFT JOIN task t ON t."idWorkPlan" = w2.id
            WHERE w2."idProcess" = $1 AND w2."idSection" = s.id
          ) sec_percent,

          -- lista de workplans + percent por plan + tasks[]
          LATERAL (
            SELECT json_agg(
              json_build_object(
                'id', w.id,
                'name', w.name,
                'idProcess', w."idProcess",
                'idSection', w."idSection",

                -- % por plan (tareas completadas / total de ese plan)
                'percent', COALESCE(wp_percent.plan_percent, 0),

                'section', json_build_object('id', s.id, 'name', s.name),

                'tasks', COALESCE(tasks.tasks, '[]'::json)
              )
              ORDER BY w.id
            ) AS work_plans
            FROM "workPlan" w

            -- % por plan
            LEFT JOIN LATERAL (
              SELECT
                CASE WHEN COUNT(t2.id) = 0 THEN 0
                     ELSE ROUND(
                       (SUM(CASE WHEN t2.completed THEN 1 ELSE 0 END)::numeric / COUNT(t2.id)::numeric) * 100,
                       2
                     )
                END AS plan_percent
              FROM task t2
              WHERE t2."idWorkPlan" = w.id
            ) wp_percent ON true

            -- tareas del plan con mentor+rol (como tu getworkPlansProcess)
            LEFT JOIN LATERAL (
              SELECT json_agg(
                json_build_object(
                  'id', t.id,
                  'name', t.name,
                  'deadline', t.deadline,
                  'responsible', t.responsible,
                  'completed', t.completed,
                  'mentor', CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
                    'id', u.id,
                    'name', u.name,
                    'email', u.email,
                    'rol', CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object(
                      'id', r.id,
                      'name', r.name
                    ) END
                  ) END
                )
                ORDER BY t.id
              ) AS tasks
              FROM task t
              LEFT JOIN "user" u ON u.id = t."idMentor"
              LEFT JOIN rol r ON r.id = u."idRol"
              WHERE t."idWorkPlan" = w.id
            ) tasks ON true

            WHERE w."idProcess" = $1 AND w."idSection" = s.id
          ) wps
        ) wp ON true

      )

      SELECT json_build_object(
        'id', p.id,
        'diagnosis', p.diagnosis,
        'questions', p.questions,

        'mentor', p.mentor,
        'client', p.client,

        'clientType',
          CASE
            WHEN p.mipyme_details IS NOT NULL THEN 'mipyme'
            WHEN p.entrepreneur_details IS NOT NULL THEN 'entrepreneur'
            ELSE 'user'
          END,

        -- detalles completos (fila entera) si existen
        'clientDetails', COALESCE(p.mipyme_details, p.entrepreneur_details),

        'totalPercent', t.total_percent,
        'sections', COALESCE(s.sections, '[]'::json)
      ) AS payload
      FROM proc p
      CROSS JOIN total t
      CROSS JOIN sections_json s;
    `;

    const { rows } = await pool.query(query, [id]);

    if (!rows.length || !rows[0].payload) {
      return res.status(404).json({ error: 'Proceso no encontrado' });
    }

    return res.status(200).json(rows[0].payload);
  } catch (err) {
    console.error('Error al obtener proceso completo:', err);
    return res.status(500).json({ error: 'Error interno al obtener proceso completo' });
  }
}


module.exports = {
  getProcesses,
  createProcess,
  createAnswerProcess,
  getAnswersByProcess,
  deleteAnswerProcess,
  getProcessFull
};