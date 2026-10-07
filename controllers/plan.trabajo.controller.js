const pool = require('../db');
const { requireMipymeAccess } = require('../utils/accessControl');

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateTasks(tareas, fechaPlan) {
  if (!Array.isArray(tareas)) {
    return 'tareas debe ser una lista';
  }

  for (const tarea of tareas) {
    if (!String(tarea?.nombre_tarea ?? '').trim()) {
      return 'Cada tarea debe tener nombre_tarea';
    }

    if (tarea?.fecha_fin != null && tarea.fecha_fin !== '') {
      const fechaTarea = String(tarea.fecha_fin);

      if (!isValidDateOnly(fechaTarea)) {
        return `La fecha de la tarea "${String(tarea.nombre_tarea).trim()}" no es válida`;
      }

      if (fechaPlan && fechaTarea > fechaPlan) {
        return `La fecha de la tarea "${String(tarea.nombre_tarea).trim()}" no puede superar la fecha límite del plan`;
      }
    }
  }

  return null;
}

async function createPlanTrabajo(req, res) {
  const {
    nombre_plan_trabajo,
    descripcion,
    fecha_fin,
    id_mipyme,
    estado,
    tareas = [],
  } = req.body;

  const actorId = Number(req.user?.id_usuario);
  const idMipyme = Number(id_mipyme);
  const nombre = String(nombre_plan_trabajo ?? '').trim();

  if (!Number.isInteger(actorId) || actorId <= 0) {
    return res.status(401).json({
      error: 'Usuario no autenticado',
    });
  }

  if (!nombre || !Number.isInteger(idMipyme) || idMipyme <= 0) {
    return res.status(400).json({
      error: 'nombre_plan_trabajo e id_mipyme son obligatorios',
    });
  }

  if (!isValidDateOnly(fecha_fin)) {
    return res.status(400).json({
      error: 'fecha_fin es obligatoria y debe tener formato YYYY-MM-DD',
    });
  }

  if (fecha_fin < todayIsoDate()) {
    return res.status(400).json({
      error: 'La fecha límite del plan no puede estar en el pasado',
    });
  }

  const tasksError = validateTasks(tareas, fecha_fin);

  if (tasksError) {
    return res.status(400).json({
      error: tasksError,
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await requireMipymeAccess(client, actorId, idMipyme);

    const planResult = await client.query(
      `
      INSERT INTO plan_trabajo (
        nombre_plan_trabajo,
        descripcion,
        fecha_fin,
        id_mipyme,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NULL, $6, NULL)
      RETURNING *
      `,
      [
        nombre,
        descripcion == null || String(descripcion).trim().isEmpty
          ? null
          : String(descripcion).trim(),
        fecha_fin,
        idMipyme,
        estado ?? 'pendiente',
        actorId,
      ]
    );

    const plan = planResult.rows[0];
    const tareasCreadas = [];

    for (const tarea of tareas) {
      const tareaResult = await client.query(
        `
        INSERT INTO tarea (
          nombre_tarea,
          descripcion,
          fecha_fin,
          estado,
          id_plan_trabajo,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (
          $1, $2, $3, $4, $5,
          NOW(), NULL, $6, NULL
        )
        RETURNING *
        `,
        [
          String(tarea.nombre_tarea).trim(),
          tarea.descripcion ?? null,
          tarea.fecha_fin ?? null,
          tarea.estado ?? 'pendiente',
          plan.id_plan_trabajo,
          actorId,
        ]
      );

      tareasCreadas.push(tareaResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Plan de trabajo y tareas creados correctamente',
      plan_trabajo: plan,
      tareas: tareasCreadas,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    console.error('Error al crear plan de trabajo:', err);

    return res.status(500).json({
      error: err.message || 'Error interno al crear plan de trabajo',
    });
  } finally {
    client.release();
  }
}

async function getPlanesTrabajo(req, res) {
  const idMipyme = Number(req.params.id);
  const actorId = Number(req.user?.id_usuario);

  try {
    if (!Number.isInteger(idMipyme) || idMipyme <= 0) {
      return res.status(400).json({
        error: 'El id_mipyme debe ser numérico',
      });
    }

    await requireMipymeAccess(pool, actorId, idMipyme);

    const result = await pool.query(
      `
      SELECT
        pt.id_plan_trabajo,
        pt.nombre_plan_trabajo,
        pt.fecha_fin,
        pt.descripcion,
        pt.estado,
        pt.created_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id_tarea', t.id_tarea,
              'nombre_tarea', t.nombre_tarea,
              'descripcion', t.descripcion,
              'fecha_fin', t.fecha_fin,
              'estado', t.estado
            )
          ) FILTER (WHERE t.id_tarea IS NOT NULL),
          '[]'
        ) AS tareas,
        COUNT(t.id_tarea) AS total_tareas,
        COUNT(*) FILTER (WHERE t.estado = 'completada') AS tareas_completadas,
        CASE
          WHEN COUNT(t.id_tarea) = 0 THEN 0
          ELSE ROUND(
            (COUNT(*) FILTER (WHERE t.estado = 'completada')::decimal
            / COUNT(t.id_tarea)::decimal) * 100
          )
        END AS porcentaje_completado
      FROM plan_trabajo pt
      LEFT JOIN tarea t
        ON t.id_plan_trabajo = pt.id_plan_trabajo
      WHERE pt.id_mipyme = $1
      GROUP BY pt.id_plan_trabajo
      ORDER BY pt.created_at DESC
      `,
      [idMipyme]
    );

    return res.status(200).json({
      planes_trabajo: result.rows,
    });
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    console.error('Error al obtener planes de trabajo:', err);

    return res.status(500).json({
      error: 'Error interno al obtener planes de trabajo',
    });
  }
}

async function updatePlanTrabajo(req, res) {
  const idPlanTrabajo = Number(req.params.id);
  const actorId = Number(req.user?.id_usuario);

  const {
    nombre_plan_trabajo,
    descripcion,
    fecha_fin,
    estado,
    tareas = [],
  } = req.body;

  if (!Number.isInteger(idPlanTrabajo) || idPlanTrabajo <= 0) {
    return res.status(400).json({
      error: 'El id del plan de trabajo debe ser numérico',
    });
  }

  if (!Number.isInteger(actorId) || actorId <= 0) {
    return res.status(401).json({
      error: 'Usuario no autenticado',
    });
  }

  if (!Array.isArray(tareas)) {
    return res.status(400).json({
      error: 'tareas debe ser una lista',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const planExists = await client.query(
      `
      SELECT
        id_plan_trabajo,
        id_mipyme,
        nombre_plan_trabajo,
        fecha_fin
      FROM plan_trabajo
      WHERE id_plan_trabajo = $1
      FOR UPDATE
      `,
      [idPlanTrabajo]
    );

    if (planExists.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'Plan de trabajo no encontrado',
      });
    }

    const currentPlan = planExists.rows[0];

    await requireMipymeAccess(
      client,
      actorId,
      currentPlan.id_mipyme
    );

    const finalName =
      nombre_plan_trabajo == null
        ? currentPlan.nombre_plan_trabajo
        : String(nombre_plan_trabajo).trim();

    if (!finalName) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        error: 'nombre_plan_trabajo es obligatorio',
      });
    }

    const finalDate =
      fecha_fin == null || fecha_fin === ''
        ? currentPlan.fecha_fin?.toISOString?.().slice(0, 10) ??
          String(currentPlan.fecha_fin ?? '').slice(0, 10)
        : String(fecha_fin);

    if (!isValidDateOnly(finalDate)) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        error: 'fecha_fin es obligatoria y debe tener formato YYYY-MM-DD',
      });
    }

    if (fecha_fin != null && fecha_fin !== '' && finalDate < todayIsoDate()) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        error: 'La nueva fecha límite del plan no puede estar en el pasado',
      });
    }

    const tasksError = validateTasks(tareas, finalDate);

    if (tasksError) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        error: tasksError,
      });
    }

    const planResult = await client.query(
      `
      UPDATE plan_trabajo
      SET
        nombre_plan_trabajo = $1,
        descripcion = $2,
        fecha_fin = $3,
        estado = COALESCE($4, estado),
        updated_at = NOW(),
        updated_by = $5
      WHERE id_plan_trabajo = $6
      RETURNING *
      `,
      [
        finalName,
        descripcion ?? null,
        finalDate,
        estado ?? null,
        actorId,
        idPlanTrabajo,
      ]
    );

    const planActualizado = planResult.rows[0];

    const tareasActualesResult = await client.query(
      `
      SELECT id_tarea
      FROM tarea
      WHERE id_plan_trabajo = $1
      `,
      [idPlanTrabajo]
    );

    const idsActuales = tareasActualesResult.rows.map(
      (tarea) => tarea.id_tarea
    );

    const idsRecibidos = tareas
      .filter((tarea) => tarea.id_tarea != null)
      .map((tarea) => Number(tarea.id_tarea));

    const tareasCreadas = [];
    const tareasActualizadas = [];
    const tareasEliminadas = [];

    for (const tarea of tareas) {
      const idTarea = tarea.id_tarea ? Number(tarea.id_tarea) : null;

      if (idTarea && idsActuales.includes(idTarea)) {
        const updatedTask = await client.query(
          `
          UPDATE tarea
          SET
            nombre_tarea = $1,
            descripcion = $2,
            fecha_fin = $3,
            estado = $4,
            updated_at = NOW(),
            updated_by = $5
          WHERE id_tarea = $6
            AND id_plan_trabajo = $7
          RETURNING *
          `,
          [
            String(tarea.nombre_tarea).trim(),
            tarea.descripcion ?? null,
            tarea.fecha_fin ?? null,
            tarea.estado ?? 'pendiente',
            actorId,
            idTarea,
            idPlanTrabajo,
          ]
        );

        tareasActualizadas.push(updatedTask.rows[0]);
      } else if (!idTarea) {
        const createdTask = await client.query(
          `
          INSERT INTO tarea (
            nombre_tarea,
            descripcion,
            fecha_fin,
            estado,
            id_plan_trabajo,
            created_at,
            updated_at,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, NOW(), NULL, $6, NULL)
          RETURNING *
          `,
          [
            String(tarea.nombre_tarea).trim(),
            tarea.descripcion ?? null,
            tarea.fecha_fin ?? null,
            tarea.estado ?? 'pendiente',
            idPlanTrabajo,
            actorId,
          ]
        );

        tareasCreadas.push(createdTask.rows[0]);
      }
    }

    const idsAEliminar = idsActuales.filter(
      (id) => !idsRecibidos.includes(id)
    );

    if (idsAEliminar.length > 0) {
      const deletedTasks = await client.query(
        `
        DELETE FROM tarea
        WHERE id_plan_trabajo = $1
          AND id_tarea = ANY($2::int[])
        RETURNING *
        `,
        [idPlanTrabajo, idsAEliminar]
      );

      tareasEliminadas.push(...deletedTasks.rows);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Plan de trabajo actualizado correctamente',
      plan_trabajo: planActualizado,
      tareas_creadas: tareasCreadas,
      tareas_actualizadas: tareasActualizadas,
      tareas_eliminadas: tareasEliminadas,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    console.error('Error al actualizar plan de trabajo:', err);

    return res.status(500).json({
      error: err.message || 'Error interno al actualizar plan de trabajo',
    });
  } finally {
    client.release();
  }
}

async function toggleEstadoTarea(req, res) {
  const idTarea = Number(req.params.idTarea);
  const actorId = Number(req.user?.id_usuario);

  try {
    if (!Number.isInteger(idTarea) || idTarea <= 0) {
      return res.status(400).json({
        error: 'El id de la tarea debe ser numérico',
      });
    }

    if (!Number.isInteger(actorId) || actorId <= 0) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const tareaResult = await pool.query(
      `
      SELECT
        t.id_tarea,
        t.estado,
        t.id_plan_trabajo,
        pt.id_mipyme
      FROM tarea t
      INNER JOIN plan_trabajo pt
        ON pt.id_plan_trabajo = t.id_plan_trabajo
      WHERE t.id_tarea = $1
      `,
      [idTarea]
    );

    if (tareaResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Tarea no encontrada',
      });
    }

    const tarea = tareaResult.rows[0];

    await requireMipymeAccess(
      pool,
      actorId,
      tarea.id_mipyme
    );

    const nuevoEstado =
      tarea.estado === 'completada' ? 'pendiente' : 'completada';

    await pool.query(
      `
      UPDATE tarea
      SET
        estado = $1,
        updated_at = NOW(),
        updated_by = $2
      WHERE id_tarea = $3
      `,
      [nuevoEstado, actorId, idTarea]
    );

    const idPlan = tarea.id_plan_trabajo;

    const planResult = await pool.query(
      `
      SELECT
        pt.id_plan_trabajo,
        pt.nombre_plan_trabajo,
        pt.fecha_fin,
        pt.descripcion,
        pt.estado,
        pt.created_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id_tarea', t.id_tarea,
              'nombre_tarea', t.nombre_tarea,
              'fecha_fin', t.fecha_fin,
              'descripcion', t.descripcion,
              'estado', t.estado
            )
          ) FILTER (WHERE t.id_tarea IS NOT NULL),
          '[]'
        ) AS tareas,
        COUNT(t.id_tarea) AS total_tareas,
        COUNT(*) FILTER (WHERE t.estado = 'completada') AS tareas_completadas,
        CASE
          WHEN COUNT(t.id_tarea) = 0 THEN 0
          ELSE ROUND(
            (COUNT(*) FILTER (WHERE t.estado = 'completada')::decimal
            / COUNT(t.id_tarea)::decimal) * 100
          )
        END AS porcentaje_completado
      FROM plan_trabajo pt
      LEFT JOIN tarea t
        ON t.id_plan_trabajo = pt.id_plan_trabajo
      WHERE pt.id_plan_trabajo = $1
      GROUP BY pt.id_plan_trabajo
      `,
      [idPlan]
    );

    return res.status(200).json({
      message: `Tarea marcada como ${nuevoEstado}`,
      plan_trabajo: planResult.rows[0],
    });
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    console.error('Error toggleEstadoTarea:', err);

    return res.status(500).json({
      error: 'Error interno al cambiar estado de tarea',
    });
  }
}

async function getMisPlanesTrabajo(req, res) {
  const idUsuario = Number(req.user?.id_usuario);

  try {
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const mipymeResult = await pool.query(
      `
      SELECT id_mipyme
      FROM mipyme_usuario
      WHERE id_usuario = $1
      `,
      [idUsuario]
    );

    if (mipymeResult.rows.length === 0) {
      return res.status(404).json({
        error: 'El usuario no tiene mipymes asociadas',
      });
    }

    const idsMipyme = mipymeResult.rows.map((mipyme) => mipyme.id_mipyme);

    const result = await pool.query(
      `
      SELECT
        pt.id_plan_trabajo,
        pt.nombre_plan_trabajo,
        pt.fecha_fin,
        pt.descripcion,
        pt.estado,
        pt.created_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id_tarea', t.id_tarea,
              'nombre_tarea', t.nombre_tarea,
              'descripcion', t.descripcion,
              'fecha_fin', t.fecha_fin,
              'estado', t.estado
            )
          ) FILTER (WHERE t.id_tarea IS NOT NULL),
          '[]'
        ) AS tareas,
        COUNT(t.id_tarea) AS total_tareas,
        COUNT(*) FILTER (WHERE t.estado = 'completada') AS tareas_completadas,
        CASE
          WHEN COUNT(t.id_tarea) = 0 THEN 0
          ELSE ROUND(
            (COUNT(*) FILTER (WHERE t.estado = 'completada')::decimal
            / COUNT(t.id_tarea)::decimal) * 100
          )
        END AS porcentaje_completado
      FROM plan_trabajo pt
      LEFT JOIN tarea t
        ON t.id_plan_trabajo = pt.id_plan_trabajo
      WHERE pt.id_mipyme = ANY($1::int[])
      GROUP BY pt.id_plan_trabajo
      ORDER BY pt.created_at DESC
      `,
      [idsMipyme]
    );

    return res.status(200).json({
      planes_trabajo: result.rows,
    });
  } catch (err) {
    console.error('Error getMisPlanesTrabajo:', err);

    return res.status(500).json({
      error: 'Error interno al obtener planes de trabajo',
    });
  }
}

module.exports = {
  createPlanTrabajo,
  getPlanesTrabajo,
  updatePlanTrabajo,
  toggleEstadoTarea,
  getMisPlanesTrabajo,
};
