const jwt = require('jsonwebtoken');
const pool = require('../db');
const path = require('path');
const fs = require('fs');

async function createPlanTrabajo(req, res) {
  const {
    nombre_plan_trabajo,
    descripcion,
    fecha_fin,
    id_mipyme,
    estado,
    created_by,
    tareas = [], // ✅ lista de maps
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ 1. Validaciones base
    if (!nombre_plan_trabajo || !id_mipyme || !created_by) {
      return res.status(400).json({
        error: 'nombre_plan_trabajo, id_mipyme y created_by son obligatorios',
      });
    }

    if (!Array.isArray(tareas)) {
      return res.status(400).json({
        error: 'tareas debe ser una lista',
      });
    }

    // ✅ 2. Verificar que exista la mipyme
    const mipymeExists = await client.query(
      `SELECT id_mipyme FROM mipyme WHERE id_mipyme = $1`,
      [id_mipyme]
    );

    if (mipymeExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada',
      });
    }

    // ✅ 3. Crear plan_trabajo
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
        nombre_plan_trabajo.trim(),
        descripcion ?? null,
        fecha_fin ?? null,
        id_mipyme,
        estado ?? 'pendiente',
        created_by
      ]
    );

    const plan = planResult.rows[0];
    const tareasCreadas = [];

    // ✅ 4. Crear tareas
    for (const tarea of tareas) {
      if (!tarea.nombre_tarea) {
        throw new Error('Cada tarea debe tener nombre_tarea');
      }

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
          created_by
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          NOW(),
          NULL,
          $6
        )
        RETURNING *
        `,
        [
          tarea.nombre_tarea.trim(),
          tarea.descripcion ?? null,
          tarea.fecha_fin ?? null,
          tarea.estado ?? 'pendiente',
          plan.id_plan_trabajo,
          created_by
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
    console.error('Error al crear plan de trabajo con tareas:', err);

    return res.status(500).json({
      error: err.message || 'Error interno al crear plan de trabajo',
    });
  } finally {
    client.release();
  }
}

async function getPlanesTrabajo(req, res) {
  const idMipyme = Number(req.params.id);

  try {
    if (Number.isNaN(idMipyme)) {
      return res.status(400).json({
        error: 'El id_mipyme debe ser numérico',
      });
    }

    const result = await pool.query(
      `
      SELECT
        pt.id_plan_trabajo,
        pt.nombre_plan_trabajo,
        pt.fecha_fin,
        pt.descripcion,
        pt.estado,
        pt.created_at,

        -- TAREAS
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

        -- MÉTRICAS
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
    console.error('Error al obtener planes de trabajo:', err);

    return res.status(500).json({
      error: 'Error interno al obtener planes de trabajo',
    });
  }
}

async function updatePlanTrabajo(req, res) {
  const idPlanTrabajo = Number(req.params.id);

  const {
    nombre_plan_trabajo,
    descripcion,
    fecha_fin,
    estado,
    updated_by,
    tareas = [],
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ 1. Validaciones base
    if (Number.isNaN(idPlanTrabajo)) {
      return res.status(400).json({
        error: 'El id del plan de trabajo debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    if (!Array.isArray(tareas)) {
      return res.status(400).json({
        error: 'tareas debe ser una lista',
      });
    }

    // ✅ 2. Verificar existencia del plan
    const planExists = await client.query(
      `
      SELECT id_plan_trabajo, id_mipyme
      FROM plan_trabajo
      WHERE id_plan_trabajo = $1
      `,
      [idPlanTrabajo]
    );

    if (planExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Plan de trabajo no encontrado',
      });
    }

    // ✅ 3. Actualizar plan_trabajo
    const planResult = await client.query(
      `
      UPDATE plan_trabajo
      SET
        nombre_plan_trabajo = COALESCE($1, nombre_plan_trabajo),
        descripcion = $2,
        fecha_fin = $3,
        estado = COALESCE($4, estado),
        updated_at = NOW(),
        updated_by = $5
      WHERE id_plan_trabajo = $6
      RETURNING *
      `,
      [
        nombre_plan_trabajo ?? null,
        descripcion ?? null,
        fecha_fin ?? null,
        estado ?? null,
        updated_by,
        idPlanTrabajo
      ]
    );

    const planActualizado = planResult.rows[0];

    // ✅ 4. Traer tareas actuales del plan
    const tareasActualesResult = await client.query(
      `
      SELECT id_tarea
      FROM tarea
      WHERE id_plan_trabajo = $1
      `,
      [idPlanTrabajo]
    );

    const tareasActuales = tareasActualesResult.rows;
    const idsActuales = tareasActuales.map(t => t.id_tarea);

    // ✅ ids que vienen desde frontend
    const idsRecibidos = tareas
      .filter(t => t.id_tarea != null)
      .map(t => Number(t.id_tarea));

    const tareasCreadas = [];
    const tareasActualizadas = [];
    const tareasEliminadas = [];

    // ✅ 5. Crear o actualizar tareas
    for (const tarea of tareas) {
      const idTarea = tarea.id_tarea ? Number(tarea.id_tarea) : null;

      if (!tarea.nombre_tarea) {
        throw new Error('Cada tarea debe tener nombre_tarea');
      }

      // 🔹 UPDATE
      if (idTarea && idsActuales.includes(idTarea)) {
        const updatedTask = await client.query(
          `
          UPDATE tarea
          SET
            nombre_tarea = $1,
            descripcion = $2,
            fecha_fin = $3,
            estado = $4,
            updated_at = NOW()
          WHERE id_tarea = $5
            AND id_plan_trabajo = $6
          RETURNING *
          `,
          [
            tarea.nombre_tarea.trim(),
            tarea.descripcion ?? null,
            tarea.fecha_fin ?? null,
            tarea.estado ?? 'pendiente',
            idTarea,
            idPlanTrabajo
          ]
        );

        tareasActualizadas.push(updatedTask.rows[0]);
      }

      // 🔹 CREATE
      else if (!idTarea) {
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
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, NOW(), NULL, $6)
          RETURNING *
          `,
          [
            tarea.nombre_tarea.trim(),
            tarea.descripcion ?? null,
            tarea.fecha_fin ?? null,
            tarea.estado ?? 'pendiente',
            idPlanTrabajo,
            updated_by
          ]
        );

        tareasCreadas.push(createdTask.rows[0]);
      }
    }

    // ✅ 6. Detectar tareas eliminadas
    const idsAEliminar = idsActuales.filter(id => !idsRecibidos.includes(id));

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
  const { updated_by } = req.body;

  try {
    // ✅ validar ID
    if (Number.isNaN(idTarea)) {
      return res.status(400).json({
        error: 'El id de la tarea debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // ✅ obtener tarea actual
    const tareaResult = await pool.query(
      `
      SELECT id_tarea, estado, id_plan_trabajo
      FROM tarea
      WHERE id_tarea = $1
      `,
      [idTarea]
    );

    if (tareaResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Tarea no encontrada',
      });
    }

    const tarea = tareaResult.rows[0];

    // ✅ toggle estado
    const nuevoEstado =
      tarea.estado === 'completada' ? 'pendiente' : 'completada';

    // ✅ actualizar tarea
    await pool.query(
      `
      UPDATE tarea
      SET estado = $1,
          updated_at = NOW(),
          updated_by = $2
      WHERE id_tarea = $3
      `,
      [nuevoEstado, updated_by, idTarea]
    );

    const idPlan = tarea.id_plan_trabajo;

    // ✅ obtener plan completo con métricas
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
    console.error('Error toggleEstadoTarea:', err);

    return res.status(500).json({
      error: 'Error interno al cambiar estado de tarea',
    });
  }
}

async function getMisPlanesTrabajo(req, res) {
  const idUsuario = req.user?.id_usuario;

  try {
    // ✅ validar usuario
    if (!idUsuario) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    // ✅ obtener las mipymes del usuario
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

    const idsMipyme = mipymeResult.rows.map(m => m.id_mipyme);

    // ✅ obtener planes con EXACTAMENTE la misma estructura
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

      WHERE pt.id_mipyme = ANY($1)

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