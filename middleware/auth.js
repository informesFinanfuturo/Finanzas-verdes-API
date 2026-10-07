const jwt = require('jsonwebtoken');

const pool = require('../db');

async function auth(
  req,
  res,
  next
) {
  const authHeader =
    req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error:
        'Token requerido',
      code:
        'TOKEN_REQUIRED',
    });
  }

  const [
    scheme,
    token,
  ] = authHeader.split(' ');

  if (
    scheme !== 'Bearer' ||
    !token
  ) {
    return res.status(401).json({
      error:
        'Token mal formado',
      code:
        'MALFORMED_TOKEN',
    });
  }

  try {
    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const idUsuario =
      Number(
        decoded.id_usuario
      );

    if (
      !Number.isInteger(
        idUsuario
      ) ||
      idUsuario <= 0
    ) {
      return res.status(401).json({
        error:
          'Token inválido',
        code:
          'INVALID_TOKEN',
      });
    }

    /*
     * Consultamos el estado real del
     * usuario en cada petición.
     *
     * Esto aplica inmediatamente:
     * - Desactivaciones.
     * - Bloqueos.
     * - Cambios de rol.
     * - Invalidación de sesiones.
     */
    const result =
      await pool.query(
        `
        SELECT
          u.id_usuario,
          u.nombre_usuario,
          u.email,

          u.estado,
          u.estado_acceso,
          u.locked_until,
          u.must_change_password,
          u.token_version,

          r.id_rol,
          r.nombre_rol,
          r.estado AS estado_rol

        FROM usuario u

        INNER JOIN rol r
          ON r.id_rol =
            u.id_rol

        WHERE u.id_usuario = $1
        `,
        [
          idUsuario
        ]
      );

    if (
      result.rows.length === 0
    ) {
      return res.status(401).json({
        error:
          'Usuario no encontrado',
        code:
          'USER_NOT_FOUND',
      });
    }

    const user =
      result.rows[0];

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
          'La cuenta se encuentra inactiva',
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
          'La cuenta se encuentra bloqueada',
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

    /*
     * Conservamos el comportamiento del
     * flujo actual:
     *
     * Los clientes solamente pueden
     * ingresar cuando su proceso se
     * encuentre activo.
     */
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
     * Bloqueo temporal por intentos
     * fallidos.
     */
    if (
      user.locked_until &&
      new Date(
        user.locked_until
      ) > new Date()
    ) {
      return res.status(423).json({
        error:
          'La cuenta se encuentra bloqueada temporalmente',
        code:
          'USER_TEMPORARILY_LOCKED',
        locked_until:
          user.locked_until,
      });
    }

    /*
     * Valida que el token corresponda a
     * la versión vigente.
     *
     * Los tokens antiguos que no tengan
     * token_version también se invalidan.
     */
    const tokenVersion =
      Number(
        decoded.token_version
      );

    const currentVersion =
      Number(
        user.token_version ?? 0
      );

    if (
      !Number.isInteger(
        tokenVersion
      ) ||
      tokenVersion !==
        currentVersion
    ) {
      return res.status(401).json({
        error:
          'La sesión ya no es válida. Inicie sesión nuevamente',
        code:
          'SESSION_INVALIDATED',
      });
    }

    /*
     * req.user queda construido con la
     * información vigente de la base de
     * datos, no con el rol antiguo del
     * token.
     */
    req.user = {
      id_usuario:
        user.id_usuario,

      id_rol:
        user.id_rol,

      nombre_rol:
        user.nombre_rol,

      nombre_usuario:
        user.nombre_usuario,

      email:
        user.email,

      token_version:
        currentVersion,

      must_change_password:
        user.must_change_password ===
        true,
    };

    const requestPath =
      req.originalUrl
        .split('?')[0];

    const isPasswordChangeRoute =
      req.method === 'PUT' &&
      requestPath.endsWith(
        '/api/user/me/password'
      );

    if (
      req.user
        .must_change_password &&
      !isPasswordChangeRoute
    ) {
      return res.status(403).json({
        error:
          'Debe cambiar la contraseña temporal antes de continuar',
        code:
          'PASSWORD_CHANGE_REQUIRED',
      });
    }

    return next();

  } catch (err) {
    if (
      err.name ===
      'TokenExpiredError'
    ) {
      return res.status(401).json({
        error:
          'La sesión expiró',
        code:
          'TOKEN_EXPIRED',
      });
    }

    if (
      err.name ===
      'JsonWebTokenError'
    ) {
      return res.status(401).json({
        error:
          'Token inválido',
        code:
          'INVALID_TOKEN',
      });
    }

    console.error(
      'Error validando autenticación:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno validando la sesión',
      code:
        'AUTH_INTERNAL_ERROR',
    });
  }
}

module.exports = auth;