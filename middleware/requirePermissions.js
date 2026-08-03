const pool = require('../db'); // ajusta el path a tu pool

function requirePermissions(requiredPermissions = []) {
  return async (req, res, next) => {
    try {
      // 🔐 auth middleware ya debió poner esto
      const { id_rol } = req.user;

      if (!id_rol) {
        return res.status(401).json({
          error: 'Usuario no autenticado',
        });
      }

      if (requiredPermissions.length === 0) {
        return next(); // nada que validar
      }

      // 1️⃣ Obtener permisos del rol desde BD
      const result = await pool.query(
        `
        SELECT p.nombre
        FROM permiso p
        JOIN permiso_rol pr ON pr.id_permiso = p.id_permiso
        WHERE pr.id_rol = $1
        `,
        [id_rol]
      );

      const userPermissions = result.rows.map(
        row => row.nombre
      );

      // 2️⃣ Verificar que tenga TODOS los permisos requeridos
      const hasAllPermissions = requiredPermissions.every(
        perm => userPermissions.includes(perm)
      );

      if (!hasAllPermissions) {
        return res.status(403).json({
          error: 'No tiene permisos suficientes',
          required: requiredPermissions,
        });
      }

      // ✅ Autorizado
      next();

    } catch (err) {
      console.error('Error validando permisos:', err);
      return res.status(500).json({
        error: 'Error interno validando permisos',
      });
    }
  };
}

module.exports = requirePermissions;