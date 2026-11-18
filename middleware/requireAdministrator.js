'use strict';
const pool = require('../db');
const { isAdministrator } = require('../services/adminPolicy');

async function requireAdministrator(req, res, next) {
  const id = Number(req.user?.id_usuario);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }
  try {
    // Validacion fresca incluso cuando el JWT conserve claims antiguos.
    const r = await pool.query(`
      SELECT u.id_rol, r.nombre_rol FROM public.usuario u
      JOIN public.rol r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1
        AND lower(u.estado) = 'activo'
        AND lower(u.estado_acceso) = 'activo'
        AND lower(r.estado) = 'activo'
    `, [id]);
    if (!r.rowCount || !isAdministrator(r.rows[0].nombre_rol)) {
      return res.status(403).json({ error: 'Solo Administrador y Super Administrador' });
    }
    req.user.id_rol = r.rows[0].id_rol;
    req.user.nombre_rol = r.rows[0].nombre_rol;
    next();
  } catch (err) {
    console.error('Error validando administrador', err);
    return res.status(503).json({ error: 'No se pudo validar la autorizacion' });
  }
}
module.exports = requireAdministrator;
