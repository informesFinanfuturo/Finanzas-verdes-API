const pool =
  require('../db');

function requirePermissions(
  requiredPermissions = []
) {
  return async (
    req,
    res,
    next
  ) => {
    try {
      const idRol =
        Number(
          req.user?.id_rol
        );

      if (
        !Number.isInteger(idRol) ||
        idRol <= 0
      ) {
        return res.status(401).json({
          error:
            'Usuario no autenticado',
          code:
            'UNAUTHENTICATED_USER',
        });
      }

      if (
        requiredPermissions.length ===
        0
      ) {
        return next();
      }

      const normalizedRequired =
        requiredPermissions.map(
          permission =>
            String(permission)
              .trim()
              .toLowerCase()
        );

      const result =
        await pool.query(
          `
          SELECT
            LOWER(
              TRIM(p.nombre)
            ) AS nombre

          FROM permiso p

          INNER JOIN permiso_rol pr
            ON pr.id_permiso =
              p.id_permiso

          INNER JOIN rol r
            ON r.id_rol =
              pr.id_rol

          WHERE
            pr.id_rol = $1

            AND COALESCE(
              p.estado,
              'activo'
            ) = 'activo'

            AND COALESCE(
              r.estado,
              'activo'
            ) = 'activo'
          `,
          [
            idRol
          ]
        );

      const userPermissions =
        new Set(
          result.rows.map(
            row => row.nombre
          )
        );

      const missingPermissions =
        normalizedRequired.filter(
          permission =>
            !userPermissions.has(
              permission
            )
        );

      if (
        missingPermissions.length > 0
      ) {
        return res.status(403).json({
          error:
            'No tiene permisos suficientes para realizar esta operación',

          code:
            'INSUFFICIENT_PERMISSIONS',

          required:
            requiredPermissions,

          missing:
            missingPermissions,
        });
      }

      return next();

    } catch (err) {
      console.error(
        'Error validando permisos:',
        err
      );

      return res.status(500).json({
        error:
          'Error interno validando permisos',
        code:
          'PERMISSIONS_INTERNAL_ERROR',
      });
    }
  };
}

module.exports =
  requirePermissions;