// controllers/roles.controller.js
const pool = require('../db');

// GET /api/roles
async function getPermissions(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT
        p.id_permiso,
        p.nombre,
        p.estado,
        p.created_at
      FROM permiso p
      ORDER BY p.created_at DESC
      `
    );

    return res.status(200).json({
      permissions: result.rows,
    });

  } catch (err) {
    console.error('Error al listar permisos:', err);
    return res.status(500).json({
      error: 'Error interno al listar permisos',
    });
  }
}

async function createPermission(req, res) {
  const {
    nombre,
  } = req.body;

  try {

    if (!nombre) {
      return res.status(400).json({
        error: 'nombre es obligatorio',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO "permiso" (
        nombre,
        estado,
        created_at,
        updated_at
      )
      VALUES ($1, 'activo', NOW(), NULL)
      RETURNING
       nombre,
        estado,
        created_at,
        updated_at
      `,
      [
        nombre
      ]
    );

    // 5️⃣ Respuesta
    return res.status(201).json({
      message: 'Permiso creado correctamente',
      user: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear permiso:', err);
    return res.status(500).json({
      error: 'Error interno al crear permiso',
    });
  }
}

async function updatePermission(req, res) {
  const { id } = req.params;

  const {
    nombre,
    estado,
  } = req.body;

  try {
    // 1️⃣ Validaciones básicas
    if (!id) {
      return res.status(400).json({
        error: 'El id del permiso es obligatorio',
      });
    }

    // 2️⃣ Verificar que el usuario exista
    const current = await pool.query(
      'SELECT id_permiso FROM permiso WHERE id_permiso = $1',
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Permiso no encontrado',
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

    if (nombre) add('nombre', nombre);
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
      UPDATE permiso
      SET ${fields.join(', ')}
      WHERE id_permiso = $${index}
      RETURNING
        id_permiso,
        nombre,
        estado,
        created_at,
        updated_at
      `,
      [...values, id]
    );

    return res.status(200).json({
      message: 'Permiso actualizado correctamente',
      user: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar permiso:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar permiso',
    });
  }
}

module.exports = {
  getPermissions,
  createPermission,
  updatePermission,
};