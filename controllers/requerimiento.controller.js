const jwt = require('jsonwebtoken');
const pool = require('../db');
const path = require('path');
const fs = require('fs');

async function createRequerimiento(req, res) {
  const {
    tipo_requerimiento,
    nombre,
    descripcion,
    especificaciones,
    presupuesto_estimado,
    fecha_limite,
    estado_requerimiento,
    created_by,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /// ✅ VALIDACIONES
    if (
      !tipo_requerimiento ||
      !nombre ||
      !created_by
    ) {
      return res.status(400).json({
        error: 'tipo_requerimiento, nombre y created_by son obligatorios',
      });
    }

    /// ✅ VALIDAR JSON
    let specsParsed = null;

    if (especificaciones) {
      try {
        specsParsed =
          typeof especificaciones === 'string'
            ? JSON.parse(especificaciones)
            : especificaciones;
      } catch (e) {
        return res.status(400).json({
          error: 'especificaciones debe ser un JSON válido',
        });
      }
    }

    /// ✅ INSERT
    const result = await client.query(
      `
      INSERT INTO requerimiento (
        tipo_requerimiento,
        nombre,
        descripcion,
        especificaciones,
        presupuesto_estimado,
        fecha_limite,
        estado_requerimiento,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        NOW(),
        NULL,
        $8,
        NULL
      )
      RETURNING *
      `,
      [
        tipo_requerimiento,
        nombre,
        descripcion ?? null,
        specsParsed,
        presupuesto_estimado ?? null,
        fecha_limite ?? null,
        estado_requerimiento ?? 'abierto',
        created_by,
      ]
    );

    const requerimiento = result.rows[0];

    await client.query('COMMIT');

    /// ✅ DISPARAR CORREOS
    try {
      await sendEmailProveedores(requerimiento);
    } catch (emailError) {
      console.error(
        'Error enviando notificaciones a proveedores:',
        emailError
      );
    }

    return res.status(201).json({
      message: 'Requerimiento creado correctamente',
      requerimiento,
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('Error createRequerimiento:', err);

    return res.status(500).json({
      error: 'Error al crear requerimiento',
    });

  } finally {
    client.release();
  }
}

async function sendEmailProveedores(requerimiento) {
  // Enviará correo a los proveedores

  return true;
}

module.exports = {
    createRequerimiento,
}