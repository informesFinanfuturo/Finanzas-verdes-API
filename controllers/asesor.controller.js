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

        -- ✅ campo solicitado
        CASE
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NOT NULL THEN true
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NULL THEN false
          ELSE true
        END AS "usuarioCompleto"

      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      LEFT JOIN asesor a ON a.id_usuario = u.id_usuario
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

// POST /api/user

async function createUser(req, res) {
  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    password,
    id_rol,        // ✅ NUEVO
    created_by     // 🔹 por ahora opcional
  } = req.body;

  try {
    // 1️⃣ Validaciones obligatorias ACTUALES
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
    

    // 2️⃣ Verificar email duplicado
    const existing = await pool.query(
      'SELECT id_usuario FROM "usuario" WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese email',
      });
    }

    // 3️⃣ Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Insertar usuario
    const result = await pool.query(
      `
      INSERT INTO "usuario" (
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
        id_rol,
        created_by ?? null
      ]
    );

    // 5️⃣ Respuesta
    return res.status(201).json({
      message: 'Usuario creado correctamente',
      user: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear usuario:', err);
    return res.status(500).json({
      error: 'Error interno al crear usuario',
    });
  }
}

// PUT /api/user/:id
async function updateAsesor(req, res) {
  const idUsuario = Number(req.params.id);

  const {
    // datos de usuario (opcionales)
    documento,
    nombre_usuario,
    email,
    telefono,
    estado,

    // ✅ datos del asesor (OBLIGATORIOS si no existe)
    nombre_cargo,
    sede,

    // auditoría
    updated_by,
  } = req.body;

  try {
    // 1️⃣ Validaciones básicas
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id del usuario debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // 2️⃣ Verificar que el usuario exista y sea ASESOR
    const userResult = await pool.query(
      `
      SELECT u.id_usuario
      FROM usuario u
      JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1
        AND r.nombre_rol = 'Asesor'
      `,
      [idUsuario]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario asesor no encontrado',
      });
    }

    // 3️⃣ Actualizar datos del USUARIO (si vienen)
    const userFields = [];
    const userValues = [];
    let uIndex = 1;

    const addUser = (field, value) => {
      userFields.push(`${field} = $${uIndex}`);
      userValues.push(value);
      uIndex++;
    };

    if (documento) addUser('documento', documento.trim());
    if (nombre_usuario) addUser('nombre_usuario', nombre_usuario.trim());
    if (email) addUser('email', email.trim());
    if (telefono !== undefined) addUser('telefono', telefono);
    if (estado !== undefined) addUser('estado', estado);

    if (userFields.length > 0) {
      userFields.push('updated_at = NOW()');
      addUser('updated_by', updated_by);

      await pool.query(
        `
        UPDATE usuario
        SET ${userFields.join(', ')}
        WHERE id_usuario = $${uIndex}
        `,
        [...userValues, idUsuario]
      );
    }

    // 4️⃣ Verificar si el ASESOR ya existe
    const asesorResult = await pool.query(
      'SELECT id_asesor FROM asesor WHERE id_usuario = $1',
      [idUsuario]
    );

    // 5️⃣ Si NO existe → CREAR asesor
    if (asesorResult.rows.length === 0) {
      if (!nombre_cargo || !sede) {
        return res.status(400).json({
          error: 'nombre_cargo y sede son obligatorios para crear el asesor',
        });
      }

      const insertResult = await pool.query(
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
        VALUES ($1, $2, $3, 'activo', NOW(), NULL, $4, NULL)
        RETURNING *
        `,
        [nombre_cargo, sede, idUsuario, updated_by]
      );

      return res.status(200).json({
        message: 'Asesor creado y usuario actualizado correctamente',
        asesor: insertResult.rows[0],
      });
    }

    // 6️⃣ Si YA existe → ACTUALIZAR asesor
    const asesorFields = [];
    const asesorValues = [];
    let aIndex = 1;

    const addAsesor = (field, value) => {
      asesorFields.push(`${field} = $${aIndex}`);
      asesorValues.push(value);
      aIndex++;
    };

    if (nombre_cargo) addAsesor('nombre_cargo', nombre_cargo);
    if (sede) addAsesor('sede', sede);
    if (estado !== undefined) addAsesor('estado', estado);

    asesorFields.push('updated_at = NOW()');
    addAsesor('updated_by', updated_by);

    const updateResult = await pool.query(
      `
      UPDATE asesor
      SET ${asesorFields.join(', ')}
      WHERE id_usuario = $${aIndex}
      RETURNING *
      `,
      [...asesorValues, idUsuario]
    );

    return res.status(200).json({
      message: 'Asesor actualizado correctamente',
      asesor: updateResult.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar asesor:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar asesor',
    });
  }
}



module.exports = {
  getUsers,
  createUser,
  updateAsesor,
};