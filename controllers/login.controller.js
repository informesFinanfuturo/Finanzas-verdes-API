// controllers/roles.controller.js
const jwt = require('jsonwebtoken');
const pool = require('../db');
const bcrypt = require('bcrypt');

async function loginUser(req, res) {
  const { email, password } = req.body;

  try {
    // 1️⃣ Validaciones básicas
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y contraseña son obligatorios',
      });
    }

    // 2️⃣ Buscar usuario activo por email
    const result = await pool.query(
      `
      SELECT
        u.id_usuario,
        u.documento,
        u.nombre_usuario,
        u.email,
        u.telefono,
        u.password_hash,
        u.estado,
        r.id_rol,
        r.nombre_rol
      FROM usuario u
      JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.email = $1
        AND u.estado = 'activo'
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];

    // 3️⃣ Comparar contraseña
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // 4️⃣ Crear TOKEN (JWT)
    const token = jwt.sign(
      {
        id_usuario: user.id_usuario,
        id_rol: user.id_rol,
        nombre_rol: user.nombre_rol,
      },
      process.env.JWT_SECRET,
      { expiresIn: '3h' }
    );

    // 5️⃣ Respuesta (sin password)
    return res.status(200).json({
      message: 'Login exitoso',
      token, // ✅ TOKEN
      user: {
        id_usuario: user.id_usuario,
        documento: user.documento,
        nombre_usuario: user.nombre_usuario,
        email: user.email,
        telefono: user.telefono,
        rol: {
          id_rol: user.id_rol,
          nombre_rol: user.nombre_rol,
        },
      },
    });

  } catch (err) {
    console.error('Error en loginUser:', err);
    return res.status(500).json({
      error: 'Error interno al iniciar sesión',
    });
  }
}

module.exports = {
  loginUser,
};