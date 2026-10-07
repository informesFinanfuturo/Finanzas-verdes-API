// controllers/roles.controller.js
const jwt = require('jsonwebtoken');
const pool = require('../db');
const bcrypt = require('bcrypt');

function normalizeEmail(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(
      /[\u200B-\u200D\u2060\uFEFF]/g,
      ''
    )
    .replace(/\s+/g, '')
    .toLowerCase();
}

async function loginUser(
  req,
  res
) {
  const {
    email,
    password,
  } = req.body;

  const normalizedEmail = normalizeEmail(email);

  console.log('LOGIN REQUEST RECEIVED:', {
    normalizedEmail,
    passwordReceived: typeof password === 'string',
    passwordLength:
      typeof password === 'string'
        ? password.length
        : null,
    processId: process.pid,
    database: process.env.DB_NAME,
  });

  if (
    !normalizedEmail ||
    !password
  ) {
    return res.status(400).json({
      error:
        'Email y contraseña son obligatorios',
      code:
        'REQUIRED_CREDENTIALS',
    });
  }

  try {
    /*
     * Buscamos el usuario sin filtrar
     * inicialmente por estado para poder
     * responder correctamente ante:
     *
     * - Cuenta inactiva.
     * - Cuenta bloqueada.
     * - Rol inactivo.
     * - Bloqueo temporal.
     */

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
        u.estado_acceso,
        u.failed_login_attempts,
        u.locked_until,
        u.must_change_password,
        u.token_version,
        r.id_rol,
        r.nombre_rol,
        r.estado AS estado_rol
      FROM public.usuario u
      INNER JOIN public.rol r
        ON r.id_rol = u.id_rol
      WHERE LOWER(TRIM(u.email)) = $1
      `,
      [normalizedEmail]
    );

console.log('LOGIN DATABASE RESULT:', {
  normalizedEmail,
  matches: result.rows.length,
  users: result.rows.map((row) => ({
    id_usuario: row.id_usuario,
    email: row.email,
    estado: row.estado,
    estado_acceso: row.estado_acceso,
  })),
});

if (result.rows.length === 0) {
  return res.status(401).json({
    error: 'Credenciales inválidas',
    code: 'INVALID_CREDENTIALS',
  });
}

    console.log('LOGIN DATABASE RESULT:', {
      normalizedEmail,
      matches: result.rows.length,
      users: result.rows.map((row) => ({
        id_usuario: row.id_usuario,
        email: row.email,
        estado: row.estado,
        estado_acceso: row.estado_acceso,
      })),
    });
    /*
     * Mantenemos respuesta genérica si
     * el correo no existe.
     */
    if (
      result.rows.length === 0
    ) {
      return res.status(401).json({
        error:
          'Credenciales inválidas',
        code:
          'INVALID_CREDENTIALS',
      });
    }

    const user = result.rows[0];

    console.log('LOGIN USER LOOKUP:', {
      normalizedEmail,
      matches: result.rows.map((row) => ({
        id_usuario: row.id_usuario,
        email: row.email,
        estado: row.estado,
        estado_acceso: row.estado_acceso,
      })),
    });

    const accessStatus =
      String(
        user.estado_acceso ??
        'activo'
      )
        .trim()
        .toLowerCase();

    if (
      accessStatus ===
      'inactivo'
    ) {
      return res.status(403).json({
        error:
          'La cuenta se encuentra inactiva. Contacte al administrador',
        code:
          'USER_INACTIVE',
      });
    }

    if (
      accessStatus ===
      'bloqueado'
    ) {
      return res.status(423).json({
        error:
          'La cuenta se encuentra bloqueada. Contacte al administrador',
        code:
          'USER_BLOCKED',
      });
    }

    const roleStatus =
      String(
        user.estado_rol ??
        'activo'
      )
        .trim()
        .toLowerCase();

    if (
      roleStatus !== 'activo'
    ) {
      return res.status(403).json({
        error:
          'El rol asignado se encuentra inactivo',
        code:
          'ROLE_INACTIVE',
      });
    }

    const normalizedRole =
      String(
        user.nombre_rol ?? ''
      )
        .trim()
        .toLowerCase();

    const processStatus =
      String(
        user.estado ?? ''
      )
        .trim()
        .toLowerCase();

    /*
     * Conserva la regla existente:
     * un cliente nuevo o pospuesto no
     * ingresa hasta estar activo.
     */
    if (
      normalizedRole ===
        'cliente' &&
      processStatus !==
        'activo'
    ) {
      return res.status(403).json({
        error:
          'El proceso del cliente todavía no se encuentra activo',
        code:
          'CLIENT_PROCESS_INACTIVE',
        estado:
          processStatus,
      });
    }

    /*
     * Si el bloqueo temporal ya expiró,
     * reiniciamos los intentos antes de
     * validar nuevamente.
     */
    if (
      user.locked_until
    ) {
      const lockedUntil =
        new Date(
          user.locked_until
        );

      if (
        lockedUntil >
        new Date()
      ) {
        return res.status(423).json({
          error:
            'Demasiados intentos fallidos. Intente nuevamente más tarde',
          code:
            'USER_TEMPORARILY_LOCKED',
          locked_until:
            user.locked_until,
        });
      }

      await pool.query(
        `
        UPDATE usuario

        SET
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()

        WHERE id_usuario = $1
        `,
        [
          user.id_usuario
        ]
      );

      user.failed_login_attempts =
        0;

      user.locked_until =
        null;
    }

    const isMatch =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    console.log('LOGIN PASSWORD CHECK:', {
      idUsuario: user.id_usuario,
      email: user.email,
      isMatch,
    });

    if (!isMatch) {
      const currentAttempts =
        Number(
          user
            .failed_login_attempts ??
          0
        );

      const nextAttempts =
        currentAttempts + 1;

      const mustLock =
        nextAttempts >= 5;

      const attemptResult =
        await pool.query(
          `
          UPDATE usuario

          SET
            failed_login_attempts =
              $1,

            locked_until =
              CASE
                WHEN $2
                THEN
                  NOW() +
                  INTERVAL '15 minutes'
                ELSE
                  NULL
              END,

            updated_at =
              NOW()

          WHERE id_usuario =
            $3

          RETURNING
            failed_login_attempts,
            locked_until
          `,
          [
            nextAttempts,
            mustLock,
            user.id_usuario,
          ]
        );

      if (mustLock) {
        return res.status(423).json({
          error:
            'La cuenta fue bloqueada temporalmente durante 15 minutos por múltiples intentos fallidos',
          code:
            'USER_TEMPORARILY_LOCKED',
          locked_until:
            attemptResult
              .rows[0]
              ?.locked_until,
        });
      }

      const remainingAttempts =
        Math.max(
          0,
          5 - nextAttempts
        );

      return res.status(401).json({
        error:
          'Credenciales inválidas',
        code:
          'INVALID_CREDENTIALS',
        remaining_attempts:
          remainingAttempts,
      });
    }

    /*
     * Inicio exitoso:
     * - Reinicia intentos.
     * - Elimina bloqueo temporal.
     * - Registra último acceso.
     */
    const loginResult =
      await pool.query(
        `
        UPDATE usuario

        SET
          failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = NOW(),
          updated_at = NOW()

        WHERE id_usuario = $1

        RETURNING
          last_login_at,
          token_version,
          must_change_password
        `,
        [
          user.id_usuario
        ]
      );

    const loginData =
      loginResult.rows[0];

    const currentTokenVersion =
      Number(
        loginData
          ?.token_version ??
        user.token_version ??
        0
      );

    const token =
      jwt.sign(
        {
          id_usuario:
            user.id_usuario,

          id_rol:
            user.id_rol,

          nombre_rol:
            user.nombre_rol,

          token_version:
            currentTokenVersion,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '3h',
        }
      );

    return res.status(200).json({
      message:
        'Login exitoso',

      token,

      must_change_password:
        loginData
          ?.must_change_password ===
        true,

      user: {
        id_usuario:
          user.id_usuario,

        documento:
          user.documento,

        nombre_usuario:
          user.nombre_usuario,

        email:
          user.email,

        telefono:
          user.telefono,

        estado:
          user.estado,

        estado_acceso:
          user.estado_acceso,

        last_login_at:
          loginData
            ?.last_login_at,

        rol: {
          id_rol:
            user.id_rol,

          nombre_rol:
            user.nombre_rol,
        },
      },
    });

  } catch (err) {
    console.error(
      'Error en loginUser:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al iniciar sesión',
      code:
        'LOGIN_INTERNAL_ERROR',
    });
  }
}

module.exports = {
  loginUser,
};