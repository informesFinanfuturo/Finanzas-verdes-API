const pool = require('../db');

async function createTipoProveedor(req, res) {
  const {
    nombre_tipo,
    descripcion,
  } = req.body;

  try {
    // ✅ validación básica
    if (!nombre_tipo) {
      return res.status(400).json({
        error: 'nombre_tipo es obligatorio',
      });
    }

    // ✅ insertar
    const result = await pool.query(
      `
      INSERT INTO tipo_proveedor (
        nombre_tipo,
        descripcion,
        estado
      )
      VALUES ($1, $2, 'activo')
      RETURNING *
      `,
      [
        nombre_tipo.trim(),
        descripcion ?? null,
      ]
    );

    return res.status(201).json({
      message: 'Tipo de proveedor creado correctamente',
      tipo_proveedor: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear tipo_proveedor:', err);

    return res.status(500).json({
      error: 'Error interno al crear tipo_proveedor',
    });
  }
}

async function getTipoProveedores(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT
        id_tipo_proveedor,
        nombre_tipo,
        descripcion
      FROM tipo_proveedor
      ORDER BY nombre_tipo ASC
      `
    );

    return res.status(200).json({
      tipos_proveedor: result.rows,
    });

  } catch (err) {
    console.error('Error al obtener tipos de proveedor:', err);

    return res.status(500).json({
      error: 'Error interno al obtener tipos de proveedor',
    });
  }
}


module.exports = {
  createTipoProveedor,
  getTipoProveedores,
};