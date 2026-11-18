'use strict';
const pool = require('../db');
const { isAdministrator } = require('../services/adminPolicy');

function requirePermissions(requiredPermissions = []) {
  return async (req, res, next) => {
    if (!req.user?.id_usuario || !req.user?.id_rol) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }
    // Regla de esta etapa: Administrador y Super Administrador son IDENTICOS
    // y tienen acceso a los mismos endpoints funcionales y administrativos.
    // auth.js ya consulto el estado y rol actuales desde PostgreSQL.
    if (isAdministrator(req.user.nombre_rol)) return next();
    if (!requiredPermissions.length) return next();
    try {
      const result = await pool.query(`
        SELECT p.nombre
        FROM public.permiso p
        JOIN public.permiso_rol pr ON pr.id_permiso = p.id_permiso
        WHERE pr.id_rol = $1 AND lower(p.estado) = 'activo'
      `, [req.user.id_rol]);
      const names = new Set(result.rows.map(r => r.nombre));
      if (!requiredPermissions.every(x => names.has(x))) {
        return res.status(403).json({ error: 'No tiene permisos suficientes' });
      }
      next();
    } catch (err) {
      console.error('Error validando permisos', err);
      return res.status(503).json({ error: 'No se pudieron validar los permisos' });
    }
  };
}
module.exports = requirePermissions;
