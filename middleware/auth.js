'use strict';
const jwt = require('jsonwebtoken');
const pool = require('../db');

async function auth(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  if (!match) return res.status(401).json({ error: 'Token Bearer requerido' });
  let decoded;
  try { decoded = jwt.verify(match[1], process.env.JWT_SECRET); }
  catch (_) { return res.status(401).json({ error: 'Token invalido o expirado' }); }
  const id = Number(decoded?.id_usuario);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(401).json({ error: 'Identidad invalida' });
  }
  try {
    // Los claims de rol del JWT pueden estar desactualizados. Solo se confia
    // en los atributos del usuario/rol actuales en PostgreSQL.
    const r = await pool.query(`
      SELECT u.id_usuario, u.id_rol, u.estado, u.estado_acceso,
             u.token_version, u.must_change_password,
             u.locked_until, ro.nombre_rol, ro.estado AS estado_rol
      FROM public.usuario u JOIN public.rol ro ON ro.id_rol = u.id_rol
      WHERE u.id_usuario = $1
    `, [id]);
    const u = r.rows[0];
    if (!u || String(u.estado).toLowerCase() !== 'activo' ||
        String(u.estado_acceso).toLowerCase() !== 'activo' ||
        String(u.estado_rol).toLowerCase() !== 'activo' ||
        (u.locked_until && new Date(u.locked_until).getTime() > Date.now())) {
      return res.status(401).json({ error: 'Cuenta sin acceso vigente' });
    }
    if (Number(decoded.token_version ?? 0) !== Number(u.token_version ?? 0)) {
      return res.status(401).json({ error: 'La sesion fue revocada' });
    }
    const isOwnPasswordChange = req.method === 'PUT' &&
      req.originalUrl.split('?')[0] === '/api/user/me/password';
    if (u.must_change_password && !isOwnPasswordChange) {
      return res.status(403).json({ error: 'Debe actualizar su contrasena' });
    }
    req.user = { ...decoded, id_usuario: u.id_usuario,
      id_rol: u.id_rol, nombre_rol: u.nombre_rol };
    next();
  } catch (err) {
    console.error('Error comprobando estado de la sesion', err);
    return res.status(503).json({ error: 'No se pudo validar la sesion' });
  }
}
module.exports = auth;

