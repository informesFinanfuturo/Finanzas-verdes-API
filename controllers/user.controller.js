// controllers/roles.controller.js
const jwt = require('jsonwebtoken');
const pool = require('../db');
const bcrypt = require('bcrypt');

// GET /api/user
async function getUsers(req, res) {
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
        u.created_at,

        CASE
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NOT NULL THEN true
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NULL THEN false
          ELSE true
        END AS "usuarioCompleto"

      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      LEFT JOIN asesor a ON a.id_usuario = u.id_usuario
      WHERE u.estado != 'inactivo'
      ORDER BY u.created_at DESC
      `
    );

    return res.status(200).json({
      users: result.rows,
    });

  } catch (err) {
    console.error('Error al listar usuarios:', err);
    return res.status(500).json({
      error: 'Error interno al listar usuarios',
    });
  }
}

async function getUsersByRol(req, res) {
  const idRol = Number(req.params.id);

  try {
    if (Number.isNaN(idRol)) {
      return res.status(400).json({
        error: 'El id del rol debe ser numérico',
      });
    }

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
        u.created_at,

        -- ✅ mantener lógica de asesor
        CASE
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NOT NULL THEN true
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NULL THEN false
          ELSE true
        END AS "usuarioCompleto"

      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      LEFT JOIN asesor a ON a.id_usuario = u.id_usuario
      WHERE u.id_rol = $1
      ORDER BY u.created_at DESC
      `,
      [idRol]
    );

    return res.status(200).json({
      users: result.rows,
    });

  } catch (err) {
    console.error('Error al obtener usuarios por rol:', err);
    return res.status(500).json({
      error: 'Error interno al obtener usuarios',
    });
  }
}

// POST /api/user

async function createUser(req, res) {
  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    password,
    id_rol,
    created_by,

    // ✅ DATOS ASESOR
    nombre_cargo,
    sede,

    // ✅ DATOS PROVEEDOR
    razon_social,
    nit,
    direccion,
    calificacion,
    tipos_proveedor
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1️⃣ Validaciones
    if (!documento || !nombre_usuario || !email || !password || !id_rol) {
      return res.status(400).json({
        error: 'documento, nombre_usuario, email, password e id_rol son obligatorios',
      });
    }

    if (!created_by) {
      return res.status(400).json({
        error: 'created_by es obligatorio',
      });
    }

    // 2️⃣ Validar email duplicado
    const existing = await client.query(
      'SELECT id_usuario FROM usuario WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese email',
      });
    }

    // 3️⃣ Hash
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Crear usuario
    const userResult = await client.query(
      `
      INSERT INTO usuario (
        documento, nombre_usuario, email, telefono,
        password_hash, id_rol, estado,
        created_at, updated_at, created_by, updated_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,'activo',NOW(),NULL,$7,NULL)
      RETURNING id_usuario
      `,
      [
        documento.trim(),
        nombre_usuario.trim(),
        email.trim(),
        telefono ?? null,
        hashedPassword,
        id_rol,
        created_by
      ]
    );

    const idUsuario = userResult.rows[0].id_usuario;

    // 🔥 5️⃣ Detectar tipo de rol
    const rolResult = await client.query(
      'SELECT nombre_rol FROM rol WHERE id_rol = $1',
      [id_rol]
    );

    const rol = rolResult.rows[0]?.nombre_rol;

    // ✅ 6️⃣ Crear asesor
    if (rol === 'Asesor') {
      if (!nombre_cargo || !sede) {
        throw new Error('nombre_cargo y sede son obligatorios para asesor');
      }

      await client.query(
        `
        INSERT INTO asesor (
          nombre_cargo,
          sede,
          id_usuario,
          estado,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES ($1,$2,$3,'activo',NOW(),NULL,$4,NULL)
        `,
        [nombre_cargo, sede, idUsuario, created_by]
      );
    }

    // ✅ 7️⃣ Crear proveedor
    if (rol === 'Proveedor') {
  if (!razon_social || !nit || !direccion) {
    throw new Error('razon_social, nit y direccion son obligatorios para proveedor');
  }

  const proveedorResult = await client.query(
    `
    INSERT INTO proveedor (
      razon_social,
      nit,
      direccion,
      calificacion,
      id_usuario,
      estado,
      created_at,
      updated_at,
      created_by,
      updated_by
    )
    VALUES ($1,$2,$3,$4,$5,'activo',NOW(),NULL,$6,NULL)
    RETURNING id_proveedor
    `,
    [
      razon_social,
      nit,
      direccion,
      calificacion ?? 0,
      idUsuario,
      created_by
    ]
  );

  const idProveedor = proveedorResult.rows[0].id_proveedor;

  // 🔥 NUEVO: insertar tipos (si vienen)
  if (Array.isArray(tipos_proveedor) && tipos_proveedor.length > 0) {

    for (const idTipo of tipos_proveedor) {
      await client.query(
        `
        INSERT INTO proveedor_tipo (
          id_proveedor,
          id_tipo_proveedor
        )
        VALUES ($1, $2)
        `,
        [idProveedor, idTipo]
      );
    }
  }
}

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Usuario creado correctamente',
      id_usuario: idUsuario,
      rol
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear usuario:', err);

    return res.status(500).json({
      error: err.message || 'Error interno al crear usuario',
    });
  } finally {
    client.release();
  }
}


// PUT /api/user/:id
async function updateUser(req, res) {
  const idUsuario = Number(req.params.id);

  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    id_rol,
    estado,
    updated_by,

    // ✅ ASESOR
    nombre_cargo,
    sede,

    // ✅ PROVEEDOR
    razon_social,
    nit,
    direccion,
    tipos_proveedor = [],
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // ✅ Verificar usuario
    const current = await client.query(
      'SELECT id_usuario, email FROM usuario WHERE id_usuario = $1',
      [idUsuario]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // ✅ Email duplicado
    if (email && email !== current.rows[0].email) {
      const existing = await client.query(
        'SELECT id_usuario FROM usuario WHERE email = $1 AND id_usuario != $2',
        [email, idUsuario]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email ya existe' });
      }
    }

    // ✅ UPDATE USUARIO
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
    if (id_rol) add('id_rol', id_rol);
    if (estado) add('estado', estado);

    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    await client.query(
      `
      UPDATE usuario
      SET ${fields.join(', ')}
      WHERE id_usuario = $${index}
      `,
      [...values, idUsuario]
    );

    // ✅ OBTENER ROL
    const rolResult = await client.query(
      'SELECT nombre_rol FROM rol WHERE id_rol = $1',
      [id_rol]
    );

    const rol = rolResult.rows[0]?.nombre_rol;

    // ========================
    // ✅ ASESOR (UPSERT)
    // ========================
    if (rol === 'Asesor') {
      const existe = await client.query(
        'SELECT id_asesor FROM asesor WHERE id_usuario = $1',
        [idUsuario]
      );

      if (existe.rows.length === 0) {
        // 🔥 CREAR
        if (!nombre_cargo || !sede) {
          throw new Error('Datos de asesor incompletos');
        }

        await client.query(
          `
          INSERT INTO asesor (
            nombre_cargo, sede, id_usuario,
            estado, created_at, updated_at,
            created_by, updated_by
          )
          VALUES ($1,$2,$3,'activo',NOW(),NULL,$4,NULL)
          `,
          [nombre_cargo, sede, idUsuario, updated_by]
        );
      } else {
        // 🔥 ACTUALIZAR
        const fieldsA = [];
        const valuesA = [];
        let i = 1;

        const addA = (f, v) => {
          fieldsA.push(`${f} = $${i}`);
          valuesA.push(v);
          i++;
        };

        if (nombre_cargo) addA('nombre_cargo', nombre_cargo);
        if (sede) addA('sede', sede);

        fieldsA.push('updated_at = NOW()');
        addA('updated_by', updated_by);

        await client.query(
          `
          UPDATE asesor
          SET ${fieldsA.join(', ')}
          WHERE id_usuario = $${i}
          `,
          [...valuesA, idUsuario]
        );
      }
    }

    // ========================
    // ✅ TIPOS PROVEEDOR (SYNC 🔥)
    // ========================
    if (rol === 'Proveedor') {

      // ✅ obtener id_proveedor
      const proveedorResult = await client.query(
        `SELECT id_proveedor FROM proveedor WHERE id_usuario = $1`,
        [idUsuario]
      );

      const idProveedor = proveedorResult.rows[0]?.id_proveedor;

      if (!idProveedor) {
        throw new Error('Proveedor no encontrado para asignar tipos');
      }

      // ✅ obtener actuales
      const currentTiposResult = await client.query(
        `
        SELECT id_tipo_proveedor
        FROM proveedor_tipo
        WHERE id_proveedor = $1
        `,
        [idProveedor]
      );

      const actuales = currentTiposResult.rows.map(r => r.id_tipo_proveedor);

      // ✅ normalizar input
      const nuevos = (tipos_proveedor || []).map(Number);

      // ✅ calcular diferencias
      const toDelete = actuales.filter(id => !nuevos.includes(id));
      const toInsert = nuevos.filter(id => !actuales.includes(id));

      // ✅ DELETE
      if (toDelete.length > 0) {
        await client.query(
          `
          DELETE FROM proveedor_tipo
          WHERE id_proveedor = $1
            AND id_tipo_proveedor = ANY($2::int[])
          `,
          [idProveedor, toDelete]
        );
      }

      // ✅ INSERT
      for (const idTipo of toInsert) {
        await client.query(
          `
          INSERT INTO proveedor_tipo (
            id_proveedor,
            id_tipo_proveedor
          )
          VALUES ($1, $2)
          `,
          [idProveedor, idTipo]
        );
      }
    }


    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Usuario actualizado correctamente',
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);

    return res.status(500).json({
      error: err.message || 'Error interno',
    });
  } finally {
    client.release();
  }
}

async function getUserFullDetail(req, res) {
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
        u.id_usuario,
        u.documento,
        u.nombre_usuario,
        u.email,
        u.telefono,
        u.estado,
        u.created_at,
        u.updated_at,
        r.id_rol,
        r.nombre_rol,

        a.id_asesor,
        a.nombre_cargo,
        a.sede,

        p.id_proveedor,
        p.razon_social,
        p.nit,
        p.direccion,
        p.calificacion,

        COALESCE(
          json_agg(DISTINCT tp.id_tipo_proveedor)
          FILTER (WHERE tp.id_tipo_proveedor IS NOT NULL),
          '[]'
        ) AS tipos_proveedor

      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      LEFT JOIN asesor a ON a.id_usuario = u.id_usuario
      LEFT JOIN proveedor p ON p.id_usuario = u.id_usuario

      LEFT JOIN proveedor_tipo pt ON pt.id_proveedor = p.id_proveedor
      LEFT JOIN tipo_proveedor tp ON tp.id_tipo_proveedor = pt.id_tipo_proveedor

      WHERE u.id_usuario = $1

      GROUP BY
        u.id_usuario,
        r.id_rol,
        a.id_asesor,
  p.id_proveedor;
      `,
      [idUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    const row = result.rows[0];

    // ✅ Construcción dinámica del objeto
    let extraData = null;

    if (row.nombre_rol === 'Asesor') {
      extraData = {
        id_asesor: row.id_asesor,
        nombre_cargo: row.nombre_cargo,
        sede: row.sede,
      };
    }

    if (row.nombre_rol === 'Proveedor') {
      
      extraData = {
        id_proveedor: row.id_proveedor,
        razon_social: row.razon_social,
        nit: row.nit,
        direccion: row.direccion,
        calificacion: row.calificacion,
        tipos_proveedor: row.tipos_proveedor
      };

    }

    return res.status(200).json({
      user: {
        id_usuario: row.id_usuario,
        documento: row.documento,
        nombre_usuario: row.nombre_usuario,
        email: row.email,
        telefono: row.telefono,
        estado: row.estado,
        created_at: row.created_at,

        rol: {
          id_rol: row.id_rol,
          nombre_rol: row.nombre_rol,
        },

        // ✅ SOLO si aplica (asesor o proveedor)
        extra: extraData,
      }
    });

  } catch (err) {
    console.error('Error al obtener usuario:', err);
    return res.status(500).json({
      error: 'Error interno al obtener usuario',
    });
  }
}




async function changeUserPassword(req, res) {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!id || !newPassword) {
    return res.status(400).json({ error: "id y newPassword son obligatorios" });
  }

  try {
    // 1) Hashear la nueva contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // 2) Reemplazar en BD
    const result = await pool.query(
      `UPDATE "user"
       SET "password" = $1
       WHERE id = $2
       RETURNING id, name, email`,
      [passwordHash, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(200).json({
      ok: true,
      message: "Contraseña actualizada correctamente",
      user: result.rows[0],
    });

  } catch (err) {
    console.error("Error cambiando contraseña:", err);
    return res.status(500).json({ error: "Error al cambiar la contraseña" });
  }
}



module.exports = {
  getUsers,
  createUser,
  updateUser,
  changeUserPassword,
  getUsersByRol,
  getUserFullDetail,
};