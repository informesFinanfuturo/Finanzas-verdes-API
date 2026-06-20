// controllers/roles.controller.js
const pool = require('../db');
const jwt = require('jsonwebtoken');

// GET /api/roles
async function getRols(req, res) {
  try {
    const result = await pool.query(`
      SELECT
        r.id_rol,
        r.nombre_rol,
        r.estado,
        r.created_at,
        json_agg(
          json_build_object(
            'id_permiso', p.id_permiso,
            'nombre_permiso', p.nombre,
            'enabled', pr.id_permiso IS NOT NULL
          )
          ORDER BY p.id_permiso
        ) AS permisos
      FROM rol r
      CROSS JOIN permiso p
      LEFT JOIN permiso_rol pr
        ON pr.id_rol = r.id_rol
       AND pr.id_permiso = p.id_permiso
      GROUP BY r.id_rol
      ORDER BY r.created_at DESC
    `);

    return res.status(200).json({
      rols: result.rows,
    });

  } catch (err) {
    console.error('Error al listar roles con permisos:', err);
    return res.status(500).json({
      error: 'Error interno al listar roles',
    });
  }
}

// POST /api/roles

async function createRole(req, res) {
  const {
    nombre_rol,
  } = req.body;

  try {

    if (!nombre_rol) {
      return res.status(400).json({
        error: 'nombre es obligatorio',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO "rol" (
        nombre_rol,
        estado,
        created_at,
        updated_at
      )
      VALUES ($1, 'activo', NOW(), NULL)
      RETURNING
       nombre_rol,
        estado,
        created_at,
        updated_at
      `,
      [
        nombre_rol
      ]
    );

    // 5️⃣ Respuesta
    return res.status(201).json({
      message: 'Rol creado correctamente',
      rol: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear rol:', err);
    return res.status(500).json({
      error: 'Error interno al crear rol',
    });
  }
}

async function updateRol(req, res) {
  const { id } = req.params;

  const {
    nombre_rol,
    estado,
  } = req.body;

  try {
    // 1️⃣ Validaciones básicas
    if (!id) {
      return res.status(400).json({
        error: 'El id del rol es obligatorio',
      });
    }

    // 2️⃣ Verificar que el usuario exista
    const current = await pool.query(
      'SELECT id_rol FROM rol WHERE id_rol = $1',
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Rol no encontrado',
      });
    }

    // 4️⃣ Construir UPDATE dinámico
    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    if (nombre_rol) add('nombre_rol', nombre_rol);
    if (estado) add('estado', estado);

    // ✅ Auditoría (SIEMPRE)
    fields.push('updated_at = NOW()');

    if (fields.length === 0) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await pool.query(
      `
      UPDATE rol
      SET ${fields.join(', ')}
      WHERE id_rol = $${index}
      RETURNING
        id_rol,
        nombre_rol,
        estado,
        created_at,
        updated_at
      `,
      [...values, id]
    );

    return res.status(200).json({
      message: 'Rol actualizado correctamente',
      rol: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar rol:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar rol',
    });
  }
}

async function togglePermisoRol(req, res) {
  const { id_rol, id_permiso } = req.body;

  try {
    if (!id_rol || !id_permiso) {
      return res.status(400).json({
        error: 'id_rol e id_permiso son obligatorios',
      });
    }

    // 1️⃣ Verificar si ya existe la relación
    const exists = await pool.query(
      `
      SELECT 1
      FROM permiso_rol
      WHERE id_rol = $1 AND id_permiso = $2
      `,
      [id_rol, id_permiso]
    );

    // 2️⃣ Si existe → eliminar
    if (exists.rows.length > 0) {
      await pool.query(
        `
        DELETE FROM permiso_rol
        WHERE id_rol = $1 AND id_permiso = $2
        `,
        [id_rol, id_permiso]
      );

      return res.status(200).json({
        message: 'Permiso desconectado del rol',
        enabled: false,
      });
    }

    // 3️⃣ Si NO existe → insertar
    await pool.query(
      `
      INSERT INTO permiso_rol (id_rol, id_permiso)
      VALUES ($1, $2)
      `,
      [id_rol, id_permiso]
    );

    return res.status(200).json({
      message: 'Permiso conectado al rol',
      enabled: true,
    });

  } catch (err) {
    console.error('Error al conectar/desconectar permiso:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar permiso del rol',
    });
  }
}

async function getRolById(req, res) {
  const { id } = req.params;

  try {
    if (!id) {
      return res.status(400).json({
        error: 'id_rol es obligatorio',
      });
    }

    const result = await pool.query(
      `
      SELECT
        r.id_rol,
        r.nombre_rol,
        r.estado,
        r.created_at,
        json_agg(
          json_build_object(
            'id_permiso', p.id_permiso,
            'nombre_permiso', p.nombre,
            'enabled', pr.id_permiso IS NOT NULL
          )
          ORDER BY p.id_permiso
        ) AS permisos
      FROM rol r
      CROSS JOIN permiso p
      LEFT JOIN permiso_rol pr
        ON pr.id_rol = r.id_rol
       AND pr.id_permiso = p.id_permiso
      WHERE r.id_rol = $1
      GROUP BY r.id_rol
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Rol no encontrado',
      });
    }

    return res.status(200).json({
      rol: result.rows[0],
    });

  } catch (err) {
    console.error('Error al obtener rol con permisos:', err);
    return res.status(500).json({
      error: 'Error interno al obtener el rol',
    });
  }
}

module.exports = {
  getRols,
  createRole,
  updateRol,
  togglePermisoRol,
  getRolById,
};