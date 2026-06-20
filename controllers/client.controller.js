// controllers/roles.controller.js
const jwt = require('jsonwebtoken');
const pool = require('../db');
const bcrypt = require('bcrypt');

// GET /api/client
async function getClients(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT
        u.id_usuario,
        u.nombre_usuario,
        u.email,
        u.documento,
        u.telefono,
        r.nombre_rol,
        r.id_rol,
        u.estado,
        u.created_at
      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      WHERE r.nombre_rol = 'Cliente'
      ORDER BY u.created_at DESC
      `
    );

    return res.status(200).json({
      clients: result.rows,
    });

  } catch (err) {
    console.error('Error al listar clientes:', err);
    return res.status(500).json({
      error: 'Error interno al listar clientes',
    });
  }
}



// POST /api/user

async function createClient(req, res) {
  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    password,
    created_by
  } = req.body;

  try {
    // 1️⃣ Validaciones
    if (!documento || !nombre_usuario || !email || !password) {
      return res.status(400).json({
        error: 'documento, nombre_usuario, email y password son obligatorios',
      });
    }

    if (!created_by) {
      return res.status(400).json({
        error: 'created_by es obligatorio',
      });
    }

    // 2️⃣ Obtener el id_rol del rol "Cliente"
    const rolResult = await pool.query(
      `SELECT id_rol FROM rol WHERE nombre_rol = $1 AND estado = 'activo'`,
      ['Cliente']
    );

    if (rolResult.rows.length === 0) {
      return res.status(500).json({
        error: 'El rol "Cliente" no existe o está inactivo',
      });
    }

    const id_rol = rolResult.rows[0].id_rol;

    // 3️⃣ Verificar email duplicado
    const existing = await pool.query(
      'SELECT id_usuario FROM usuario WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese email',
      });
    }

    // 4️⃣ Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5️⃣ Insertar usuario con rol "Cliente"
    const result = await pool.query(
      `
      INSERT INTO usuario (
        documento,
        nombre_usuario,
        email,
        telefono,
        password_hash,
        id_rol,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'activo', NOW(), NULL, $7, NULL)
      RETURNING
        id_usuario,
        documento,
        nombre_usuario,
        email,
        telefono,
        id_rol,
        estado,
        created_at,
        created_by
      `,
      [
        documento.trim(),
        nombre_usuario.trim(),
        email.trim(),
        telefono ?? null,
        hashedPassword,
        id_rol,          // ✅ rol "Cliente" automático
        created_by
      ]
    );

    return res.status(201).json({
      message: 'Cliente creado correctamente',
      user: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear cliente:', err);
    return res.status(500).json({
      error: 'Error interno al crear cliente',
    });
  }
}


// PUT /apiclient/:id
async function updateClient(req, res) {
  const idUsuario = Number(req.params.id);

  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    estado,
    updated_by, // ✅ obligatorio
  } = req.body;

  try {
    // 1️⃣ Validaciones
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id del cliente debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // 2️⃣ Verificar que el usuario exista y SEA CLIENTE
    const current = await pool.query(
      `
      SELECT u.id_usuario, u.email
      FROM usuario u
      JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1
        AND r.nombre_rol = 'Cliente'
      `,
      [idUsuario]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Cliente no encontrado',
      });
    }

    // 3️⃣ Validar email duplicado (si cambia)
    if (email && email !== current.rows[0].email) {
      const existing = await pool.query(
        `
        SELECT id_usuario
        FROM usuario
        WHERE email = $1 AND id_usuario != $2
        `,
        [email, idUsuario]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'Ya existe un usuario con ese email',
        });
      }
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

    if (documento) add('documento', documento.trim());
    if (nombre_usuario) add('nombre_usuario', nombre_usuario.trim());
    if (email) add('email', email.trim());
    if (telefono !== undefined) add('telefono', telefono);
    if (estado !== undefined) add('estado', estado);

    // ✅ Auditoría SIEMPRE
    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    if (fields.length === 0) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await pool.query(
      `
      UPDATE usuario
      SET ${fields.join(', ')}
      WHERE id_usuario = $${index}
      RETURNING
        id_usuario,
        documento,
        nombre_usuario,
        email,
        telefono,
        estado,
        updated_at,
        updated_by
      `,
      [...values, idUsuario]
    );

    return res.status(200).json({
      message: 'Cliente actualizado correctamente',
      client: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar cliente:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar cliente',
    });
  }
}

async function getClienteFull(req, res) {
  const idUsuario = Number(req.params.id);

  try {
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    const result = await pool.query(
      `
      SELECT
  -- ✅ USUARIO
  u.id_usuario,
  u.documento,
  u.nombre_usuario,
  u.email,
  u.telefono,
  u.estado,
  u.created_at,

  -- ✅ MIPYME
  m.id_mipyme,
  m.nombre_mipyme,
  m.nit,
  m.sector_economico,
  m.direccion,
  m.municipio,
  m.descripcion_empresa,
  m.cantidad_empleados,
  m.ingresos,
  m.egresos,
  m.codigo_ciiu,
  m.estado AS estado_mipyme,

  -- ✅ ACTIVOS
  json_agg(
    DISTINCT jsonb_build_object(
      'id_activo', a.id_activo,
      'nombre', a.nombre,
      'tipo', a.tipo,
      'descripcion', a.descripcion,
      'datos', a.datos,
      'estado', a.estado
    )
  ) FILTER (WHERE a.id_activo IS NOT NULL) AS activos,

  -- ✅ FACTURAS (SIN ARCHIVOS)
  json_agg(
    DISTINCT jsonb_build_object(
      'id_consumo', c.id_consumo,
      'tipo', c.tipo,
      'periodo', c.periodo,
      'valor', c.valor,
      'consumo', c.consumo,
      'unidad', c.unidad
    )
  ) FILTER (WHERE c.id_consumo IS NOT NULL) AS facturas

FROM usuario u

LEFT JOIN mipyme_usuario mu 
  ON mu.id_usuario = u.id_usuario

LEFT JOIN mipyme m 
  ON m.id_mipyme = mu.id_mipyme

LEFT JOIN activo a 
  ON a.id_mipyme = m.id_mipyme

LEFT JOIN consumo c 
  ON c.id_mipyme = m.id_mipyme

WHERE u.id_usuario = $1

GROUP BY 
  u.id_usuario,
  m.id_mipyme;
      `,
      [idUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    const row = result.rows[0];

    return res.status(200).json({
      user: {
        id_usuario: row.id_usuario,
        documento: row.documento,
        nombre_usuario: row.nombre_usuario,
        email: row.email,
        telefono: row.telefono,
        estado: row.estado,
        created_at: row.created_at,
      },

      cliente: {
        id_cliente: row.id_usuario,
      },

      mipyme: row.id_mipyme
        ? {
            id_mipyme: row.id_mipyme,
            nombre_mipyme: row.nombre_mipyme,
            nit: row.nit,
            sector_economico: row.sector_economico,
            direccion: row.direccion,
            municipio: row.municipio,
            descripcion_empresa: row.descripcion_empresa,
            cantidad_empleados: row.cantidad_empleados,
            ingresos: row.ingresos,
            egresos: row.egresos,
            codigo_ciiu: row.codigo_ciiu,
            estado: row.estado_mipyme,
          }
        : null,

      // 🔥 NUEVO
      activos: row.activos ?? [],
      facturas: row.facturas ?? [],
    });

  } catch (err) {
    console.error('Error al obtener cliente completo:', err);
    return res.status(500).json({
      error: 'Error interno',
    });
  }
}


async function createMipyme(req, res) {
  const {
    id_usuario,
    tipo_relacion,

    nombre_mipyme,
    nit,
    sector_economico,
    direccion,
    municipio,
    descripcion_empresa,
    cantidad_empleados,
    ingresos,
    egresos,
    codigo_ciiu,

    created_by,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ VALIDACIONES
    if (!id_usuario || !created_by) {
      return res.status(400).json({
        error: 'id_usuario y created_by son obligatorios'
      });
    }

    const exists = await client.query(
      `SELECT id_usuario FROM usuario WHERE id_usuario = $1`,
      [id_usuario]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    // ✅ CREAR MIPYME
    const result = await client.query(
      `
      INSERT INTO mipyme (
        nombre_mipyme,
        nit,
        sector_economico,
        direccion,
        municipio,
        descripcion_empresa,
        cantidad_empleados,
        ingresos,
        egresos,
        codigo_ciiu,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        'activo',
        NOW(),
        NULL,
        $11,
        NULL
      )
      RETURNING id_mipyme
      `,
      [
        nombre_mipyme ?? null,
        nit ?? null,
        sector_economico ?? null,
        direccion ?? null,
        municipio ?? null,
        descripcion_empresa ?? null,
        cantidad_empleados ?? null,
        ingresos ?? null,
        egresos ?? null,
        codigo_ciiu ?? null,
        created_by
      ]
    );

    const idMipyme = result.rows[0].id_mipyme;

    // ✅ RELACIÓN CORRECTA (SIN id_cliente)
    await client.query(
      `
      INSERT INTO mipyme_usuario (
        id_usuario,
        id_mipyme,
        tipo_relacion
      )
      VALUES ($1, $2, $3)
      `,
      [
        id_usuario,                 // ✅ usuario cliente
        idMipyme,                  // ✅ mipyme creada
        tipo_relacion ?? 'propietario'
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Mipyme creada correctamente',
      id_mipyme: idMipyme
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear mipyme:', err);

    return res.status(500).json({
      error: err.message || 'Error interno',
    });

  } finally {
    client.release();
  }
}

async function updateMipyme(req, res) {
  const idMipyme = Number(req.params.id);

  const {
    nombre_mipyme,
    nit,
    sector_economico,
    direccion,
    municipio,
    descripcion_empresa,
    cantidad_empleados,
    ingresos,
    egresos,
    codigo_ciiu,
    estado,
    updated_by,
  } = req.body;

  try {
    // ✅ Validaciones mínimas
    if (Number.isNaN(idMipyme)) {
      return res.status(400).json({
        error: 'El id de la mipyme debe ser numérico'
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio'
      });
    }

    // ✅ Verificar existencia
    const exists = await pool.query(
      'SELECT id_mipyme FROM mipyme WHERE id_mipyme = $1',
      [idMipyme]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada'
      });
    }

    // ✅ Construcción dinámica
    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    if (nombre_mipyme !== undefined) add('nombre_mipyme', nombre_mipyme);
    if (nit !== undefined) add('nit', nit);
    if (sector_economico !== undefined) add('sector_economico', sector_economico);
    if (direccion !== undefined) add('direccion', direccion);
    if (municipio !== undefined) add('municipio', municipio);
    if (descripcion_empresa !== undefined) add('descripcion_empresa', descripcion_empresa);
    if (cantidad_empleados !== undefined) add('cantidad_empleados', cantidad_empleados);
    if (ingresos !== undefined) add('ingresos', ingresos);
    if (egresos !== undefined) add('egresos', egresos);
    if (codigo_ciiu !== undefined) add('codigo_ciiu', codigo_ciiu);
    if (estado !== undefined) add('estado', estado);

    // ✅ auditoría SIEMPRE
    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    if (fields.length === 1) {
      return res.status(400).json({
        error: 'No hay campos para actualizar'
      });
    }

    const result = await pool.query(
      `
      UPDATE mipyme
      SET ${fields.join(', ')}
      WHERE id_mipyme = $${index}
      RETURNING *
      `,
      [...values, idMipyme]
    );

    return res.status(200).json({
      message: 'Mipyme actualizada correctamente',
      mipyme: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar mipyme:', err);

    return res.status(500).json({
      error: 'Error interno al actualizar mipyme'
    });
  }
}


module.exports = {
  getClients,
  createClient,
  updateClient,
  getClienteFull,
  createMipyme,
  updateMipyme,
};