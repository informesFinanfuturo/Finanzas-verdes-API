// controllers/roles.controller.js
const pool = require('../db');

// GET /api/workPlan
async function getworkPlans(req, res) {
  try {
    const result = await pool.query('SELECT * FROM "workPlan" ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los planes de trabajo:', err);
    res.status(500).json({ error: 'Error al obtener planes de trabajo' });
  }
}

async function getworkPlansProcess(req, res) {
  const { idProcess } = req.params;

  try {
    const query = `
      SELECT 
        w.*,
        s.id   AS "sectionId",
        s.name AS "sectionName",
        t.id         AS "taskId",
        t.name       AS "taskName",
        t.deadline   AS "taskDeadline",
        t.responsible AS "taskResponsible",
        t.completed AS "taskCompleted",
        u.id    AS "userId",
        u.name  AS "userName",
        u.email AS "userEmail",
        r.id   AS "roleId",
        r.name AS "roleName"
      FROM "workPlan" w
      JOIN "section" s ON s.id = w."idSection"
      LEFT JOIN task t ON t."idWorkPlan" = w.id
      LEFT JOIN "user" u ON u.id = t."idMentor"
      LEFT JOIN rol r ON r.id = u."idRol"
      WHERE w."idProcess" = $1
    `;

    const result = await pool.query(query, [idProcess]);

    const workPlansMap = {};

    for (const row of result.rows) {
      const workPlanId = row.id; // id de workPlan

      // 1. Si aún no hemos creado este workPlan en el mapa, lo creamos
      if (!workPlansMap[workPlanId]) {
        const {
          sectionId,
          sectionName,
          taskId,
          taskName,
          taskDeadline,
          taskResponsible,
          taskCompleted,
          userId,
          userName,
          userEmail,
          roleId,
          roleName,
          ...workPlanFields
        } = row;

        workPlansMap[workPlanId] = {
          // Campos propios del workPlan (id, name, description, idProcess, etc.)
          ...workPlanFields,
          section: {
            id: sectionId,
            name: sectionName,
          },
          tasks: [], // aquí vamos a ir acumulando las tareas
        };
      }

      // 2. Si hay una tarea asociada en esta fila, la agregamos al arreglo tasks
      if (row.taskId) {
        workPlansMap[workPlanId].tasks.push({
          id: row.taskId,
          name: row.taskName,
          deadline: row.taskDeadline,
          responsible: row.taskResponsible, // id del usuario responsable
          completed: row.taskCompleted,

          user: row.userId
            ? {
                id: row.userId,
                name: row.userName,
                email: row.userEmail,
                rol: row.roleId
                  ? {
                      id: row.roleId,
                      name: row.roleName,
                    }
                  : null,
              }
            : null,
        });
      }
    }

    // Convertimos el mapa a array
    const workPlans = Object.values(workPlansMap);

    return res.status(200).json(workPlans);
  } catch (err) {
    console.error('Error al obtener los planes de trabajo:', err);
    return res
      .status(500)
      .json({ error: 'Error al obtener planes de trabajo' });
  }
}


// POST /api/workPlan
async function createWorkPlan(req, res) {
  const { name, idProcess, idSection } = req.body;

  if (!name || !name.trim(), !idProcess, !idSection) {
    return res.status(400).json({ error: 'El nombre, idSection y idProcess es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO "workPlan" (name, "idProcess", "idSection") VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), idProcess, idSection]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear el plan de trabajo:', err);
    res.status(500).json({ error: 'Error al crear plan de trabajo' });
  }
}

// PUT api/workPlan/:id

async function updateWorkPlan(req, res) {
  const { id } = req.params;
  const { name, idSection } = req.body;

  try {
    // Validaciones básicas
    if (!name || !idSection) {
      return res.status(400).json({
        error: "El name y idSection son obligatorios",
      });
    }

    const query = `
      UPDATE "workPlan"
      SET "name" = $1,
          "idSection" = $2
      WHERE id = $3
      RETURNING id, name, "idSection";
    `;

    const values = [name, idSection, id];

    const { rows } = await pool.query(query, values);

    if (rows.length === 0) {
      // No se encontró la pregunta con ese id
      return res.status(404).json({ error: "Plan de trabajo no encontrado" });
    }

    // Éxito: devolvemos la pregunta actualizada
    return res.json({
      message: "plan de trabajo actualizado correctamente",
      question: rows[0],
    });
  } catch (err) {
    console.error("Error al actualizar el plan de trabajo:", err);
    return res
      .status(500)
      .json({ error: "Error al actualizar la pregunta" });
  }
}


async function deleteWorkPlan (req, res) {
  const { id } = req.params;

  try {
    const query = `
      DELETE FROM
      "workPlan" WHERE id = $1
    `;

    const values = [id];

    const { rows } = await pool.query(query, values);

    // Éxito: devolvemos la pregunta actualizada
    return res.json({
      message: "plan de trabajo eliminado correctamente",
    });
  } catch (err) {
    console.error("Error al eliminar el plan de trabajo:", err);
    return res
      .status(500)
      .json({ error: "Error al eliminar la pregunta" });
  }
}

module.exports = {
  getworkPlans,
  createWorkPlan,
  getworkPlansProcess,
  updateWorkPlan,
  deleteWorkPlan
};