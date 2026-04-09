// controllers/roles.controller.js
const pool = require('../db');

// GET /api/task
async function getTasks(req, res) {
  try {
    const result = await pool.query(`
        SELECT
        t.*,
        m.name AS "nameUser",
        m.id AS "idUser",
        m.email AS "emailUser",
        r.id AS "idRol",
        r.name AS "nameRol"
        FROM task t
        JOIN user m ON m.id = t."idUser"
        JOIN rol r ON r.id = m."idRol"
    `);
    const tasks = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        responsible: row.responsible,
        deadline: row.deadline,
        idWorkPlan: row.idWorkPlan,
        mentor: {
            id: row.idUser,
            name: row.nameUser,
            email: row.emailUser,
            rol: {
                name: row.nameRol,
                id: row.idRol
            }
        }
    }))
    return res.status(200).json({
        tasks
    })
  } catch (err) {
    console.error('Error al obtener tareas:', err);
    res.status(500).json({ error: 'Error al obtener tareas' });
  }
}

// POST /api/task
async function createTask (req, res) {
  const { name, responsible, deadline, idWorkPlan } = req.body;

  if (!name || !responsible || !deadline || !idWorkPlan) {
    return res.status(400).json({ error: 'El nombre, responsable, plazo y idWorkPlan es obligatorio' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO task (name, responsible, deadline, "idWorkPlan") VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), responsible, deadline, idWorkPlan]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear tarea:', err);
    res.status(500).json({ error: 'Error al crear tarea' });
  }
}

async function editTaskCompleted (req, res) {
  const { id } = req.params;
  const { completed, idMentor } = req.body;

  if (!completed, !id) {
    return res.status(400).json({ error: 'El estado, mentor y id es obligatorio' });
  }

  try {
    const result = await pool.query(
      'UPDATE task SET completed = $1, "idMentor" = $2 WHERE id = $3 RETURNING *',
      [!completed, idMentor, id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al editar el estado de la tarea:', err);
    res.status(500).json({ error: 'Error al editar el estado de la tarea' });
  }
}

async function editTask (req, res) {
  const { id } = req.params;
  const { name, responsible, deadline, completed, idMentor } = req.body;

  if (!name, !responsible, !deadline, !completed, !id) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    const result = await pool.query(
      'UPDATE task SET completed = $1, "idMentor" = $2, name = $3, responsible = $4, deadline = $5 WHERE id = $6 RETURNING *',
      [completed, idMentor, name, responsible, deadline, id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error al editar la tarea:', err);
    res.status(500).json({ error: 'Error al editar la tarea' });
  }
}

async function removeTask (req, res) {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM task WHERE id = $1',
      [id]
    );

    res.status(200).json({
      message: "Eliminado correctamente"
    });
  } catch (err) {
    console.error('Error al eliminar la tarea:', err);
    res.status(500).json({ error: 'Error al eliminar la tarea' });
  }
}

module.exports = {
  getTasks,
  createTask,
  editTaskCompleted,
  editTask,
  removeTask,
};