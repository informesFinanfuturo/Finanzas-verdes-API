'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');

function positiveInt(value, max = 2147483647) {
  const v = Number(value);
  return Number.isSafeInteger(v) && v >= 1 && v <= max ? v : null;
}

function parsePaging(query, defaultLimit = 20) {
  const pagina = positiveInt(query.pagina ?? 1, 1000000);
  const limite = positiveInt(query.limite ?? defaultLimit, 100);
  if (!pagina || !limite) return null;
  return { pagina, limite, offset: (pagina - 1) * limite };
}

function httpError(res, error, context) {
  console.error(context, error);
  return res.status(500).json({ error: 'No fue posible completar la consulta' });
}

const providerFromSql = `
  FROM public.proveedor p
  LEFT JOIN public.usuario u ON u.id_usuario = p.id_usuario
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS total_productos,
           COUNT(*) FILTER (WHERE i.disponible IS TRUE)::int AS productos_disponibles,
           COUNT(*) FILTER (WHERE NULLIF(BTRIM(i.url_origen), '') IS NOT NULL)::int AS crawler_productos,
           COUNT(*) FILTER (WHERE NULLIF(BTRIM(i.url_origen), '') IS NULL)::int AS manual_productos,
           MAX(COALESCE(i.updated_at, i.created_at)) AS ultima_actualizacion_catalogo
    FROM public.item_catalogo i WHERE i.id_proveedor = p.id_proveedor
  ) stats ON TRUE
`;

const providerOriginSql = `CASE
  WHEN stats.total_productos = 0 THEN 'sin_catalogo'
  WHEN stats.crawler_productos > 0 AND stats.manual_productos > 0 THEN 'mixto'
  WHEN stats.crawler_productos > 0 THEN 'crawler'
  ELSE 'manual' END`;

async function getProveedoresAdmin(req, res) {
  const page = parsePaging(req.query);
  const buscar = String(req.query.buscar ?? '').trim();
  const estado = String(req.query.estado ?? '').trim().toLowerCase();
  const origen = String(req.query.origen ?? '').trim().toLowerCase();
  const tipoId = req.query.id_tipo_proveedor === undefined ? null : positiveInt(req.query.id_tipo_proveedor);
  if (!page || buscar.length > 150 || !['', 'activo', 'inactivo'].includes(estado) ||
      !['', 'crawler', 'manual', 'mixto', 'sin_catalogo'].includes(origen) ||
      (req.query.id_tipo_proveedor !== undefined && !tipoId)) {
    return res.status(400).json({ error: 'Filtros de proveedores invalidos' });
  }

  const params = [];
  const conditions = [];
  const push = (value) => { params.push(value); return '$' + params.length; };
  if (buscar) {
    const p = push('%' + buscar + '%');
    conditions.push(`(p.razon_social ILIKE ${p} OR p.nit ILIKE ${p} OR u.nombre_usuario ILIKE ${p} OR u.email ILIKE ${p})`);
  }
  if (estado) conditions.push(`LOWER(p.estado) = ${push(estado)}`);
  if (origen) conditions.push(`${providerOriginSql} = ${push(origen)}`);
  if (tipoId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM public.proveedor_tipo pt
      WHERE pt.id_proveedor = p.id_proveedor AND pt.id_tipo_proveedor = ${push(tipoId)}
    )`);
  }
  const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  try {
    const summaryQuery = `
      SELECT COUNT(*)::int AS total_proveedores,
        COUNT(*) FILTER (WHERE LOWER(p.estado) = 'activo')::int AS proveedores_activos,
        COUNT(*) FILTER (WHERE p.id_usuario IS NULL)::int AS sin_usuario,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM public.item_catalogo i WHERE i.id_proveedor = p.id_proveedor
        ))::int AS sin_productos
      FROM public.proveedor p`;
    const countQuery = `SELECT COUNT(*)::int AS total ${providerFromSql} ${whereSql}`;
    const rowQuery = `
      SELECT p.id_proveedor, p.razon_social, p.nit, p.telefono, p.direccion,
        p.calificacion, p.id_usuario, p.estado AS estado_proveedor,
        p.created_at, p.updated_at, u.nombre_usuario, u.email,
        stats.total_productos, stats.productos_disponibles,
        stats.ultima_actualizacion_catalogo, ${providerOriginSql} AS origen_catalogo,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id_tipo_proveedor', t.id_tipo_proveedor, 'nombre_tipo', t.nombre_tipo
        ) ORDER BY t.nombre_tipo)
        FROM public.proveedor_tipo pt
        JOIN public.tipo_proveedor t ON t.id_tipo_proveedor = pt.id_tipo_proveedor
        WHERE pt.id_proveedor = p.id_proveedor), '[]'::jsonb) AS tipos_proveedor
      ${providerFromSql} ${whereSql}
      ORDER BY p.razon_social ASC, p.id_proveedor ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const [summary, count, rows] = await Promise.all([
      pool.query(summaryQuery),
      pool.query(countQuery, params),
      pool.query(rowQuery, [...params, page.limite, page.offset]),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return res.json({
      proveedores: rows.rows,
      summary: summary.rows[0],
      pagination: { pagina: page.pagina, limite: page.limite, total_registros: total,
        total_paginas: Math.ceil(total / page.limite) },
    });
  } catch (error) { return httpError(res, error, 'Listado administrativo de proveedores:'); }
}

async function getCatalogoAdmin(req, res) {
  const page = parsePaging(req.query, 24);
  const buscar = String(req.query.buscar ?? '').trim();
  const estado = String(req.query.estado ?? '').trim().toLowerCase();
  const tipo = String(req.query.tipo_item ?? '').trim();
  const proveedorId = req.query.id_proveedor === undefined ? null : positiveInt(req.query.id_proveedor);
  const disponible = req.query.disponible;
  if (!page || buscar.length > 150 || tipo.length > 120 || estado.length > 40 ||
      (req.query.id_proveedor !== undefined && !proveedorId) ||
      (disponible !== undefined && !['true', 'false'].includes(String(disponible)))) {
    return res.status(400).json({ error: 'Filtros de catalogo invalidos' });
  }
  const params = [];
  const conditions = [];
  const push = (value) => { params.push(value); return '$' + params.length; };
  if (buscar) {
    const p = push('%' + buscar + '%');
    conditions.push(`(i.nombre ILIKE ${p} OR i.descripcion ILIKE ${p} OR p.razon_social ILIKE ${p})`);
  }
  if (estado) conditions.push(`LOWER(i.estado) = ${push(estado)}`);
  if (tipo) conditions.push(`i.tipo_item = ${push(tipo)}`);
  if (proveedorId) conditions.push(`i.id_proveedor = ${push(proveedorId)}`);
  if (disponible !== undefined) conditions.push(`i.disponible = ${push(disponible === 'true')}`);
  const fromSql = 'FROM public.item_catalogo i LEFT JOIN public.proveedor p ON p.id_proveedor = i.id_proveedor';
  const whereSql = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  try {
    const [summary, count, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_productos,
        COUNT(*) FILTER (WHERE disponible IS TRUE)::int AS disponibles,
        COUNT(*) FILTER (WHERE disponible IS NOT TRUE)::int AS no_disponibles,
        COUNT(DISTINCT id_proveedor)::int AS total_proveedores
        FROM public.item_catalogo`),
      pool.query(`SELECT COUNT(*)::int AS total ${fromSql} ${whereSql}`, params),
      pool.query(`SELECT i.id_item, i.tipo_item, i.nombre, i.descripcion,
        i.especificaciones, i.precio_base, i.disponible, i.id_proveedor,
        i.estado, i.created_at, i.updated_at, i.url_origen,
        p.razon_social AS nombre_proveedor
        ${fromSql} ${whereSql}
        ORDER BY COALESCE(i.updated_at, i.created_at) DESC, i.id_item DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, page.limite, page.offset]),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return res.json({
      productos: rows.rows,
      summary: summary.rows[0],
      pagination: { pagina: page.pagina, limite: page.limite,
        total_registros: total, total_paginas: Math.ceil(total / page.limite) },
    });
  } catch (error) { return httpError(res, error, 'Catalogo administrativo:'); }
}

async function getSyncHistory(req, res) {
  const limite = positiveInt(req.query.limite ?? 20, 100);
  if (!limite) return res.status(400).json({ error: 'Limite invalido' });
  try {
    const r = await pool.query(`SELECT id_sincronizacion, origen, estado,
      solicitado_por, inicio, fin, reporte, error, created_at, updated_at
      FROM public.catalogo_sincronizacion
      ORDER BY created_at DESC, id_sincronizacion DESC LIMIT $1`, [limite]);
    return res.json({ sincronizaciones: r.rows });
  } catch (error) { return httpError(res, error, 'Historial de sincronizaciones:'); }
}

async function getSyncById(req, res) {
  const id = positiveInt(req.params.id, Number.MAX_SAFE_INTEGER);
  if (!id) return res.status(400).json({ error: 'ID de sincronizacion invalido' });
  try {
    const r = await pool.query(`SELECT id_sincronizacion, origen, estado,
      solicitado_por, inicio, fin, reporte, error, created_at, updated_at
      FROM public.catalogo_sincronizacion WHERE id_sincronizacion = $1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Sincronizacion no encontrada' });
    return res.json({ sincronizacion: r.rows[0] });
  } catch (error) { return httpError(res, error, 'Consulta de sincronizacion:'); }
}

async function resetUserPassword(req, res) {
  const id = positiveInt(req.params.id);
  const actorId = positiveInt(req.user?.id_usuario);
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  if (!id || !actorId || motivo.length < 5 || motivo.length > 500) {
    return res.status(400).json({ error: 'Usuario o motivo invalido' });
  }
  if (actorId === id) {
    return res.status(409).json({ error: 'Use el cambio de contrasena propia para su cuenta' });
  }
  const temporaryPassword = crypto.randomBytes(24).toString('base64url');
  let client;
  try {
    const hash = await bcrypt.hash(temporaryPassword, 12);
    client = await pool.connect();
    await client.query('BEGIN');
    const target = await client.query(`SELECT id_usuario, estado, estado_acceso
      FROM public.usuario WHERE id_usuario = $1 FOR UPDATE`, [id]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (String(target.rows[0].estado).toLowerCase() !== 'activo' ||
        String(target.rows[0].estado_acceso).toLowerCase() !== 'activo') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El usuario no esta activo' });
    }
    await client.query(`UPDATE public.usuario SET password_hash = $1,
      must_change_password = TRUE, password_changed_at = NULL,
      token_version = token_version + 1, updated_at = now(), updated_by = $2
      WHERE id_usuario = $3`, [hash, actorId, id]);
    await client.query(`INSERT INTO public.audit_log
      (id_usuario_actor, accion, entidad, id_entidad, datos_nuevos, motivo, ip, user_agent)
      VALUES ($1, 'ADMIN_RESET_PASSWORD', 'usuario', $2, $3::jsonb, $4, $5, $6)`,
    [actorId, id, JSON.stringify({ reset: true, must_change_password: true }),
      motivo, String(req.ip || '').slice(0, 100) || null,
      String(req.get?.('user-agent') || '').slice(0, 900) || null]);
    await client.query('COMMIT');
    return res.json({ temporary_password: temporaryPassword });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return httpError(res, error, 'Restablecimiento de contrasena:');
  } finally { if (client) client.release(); }
}

async function changeOwnPassword(req, res) {
  const id = positiveInt(req.user?.id_usuario);
  const currentPassword = req.body?.current_password;
  const newPassword = req.body?.new_password;
  const strongPassword = typeof newPassword === 'string' &&
    /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) && /[!@#$%^&*(),.?":{}|<>_\-]/.test(newPassword);
  if (!id || typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128 ||
      !strongPassword || !currentPassword || newPassword === currentPassword) {
    return res.status(400).json({ error: 'Contrasena nueva invalida o sin cambios' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(`SELECT password_hash FROM public.usuario
      WHERE id_usuario = $1 FOR UPDATE`, [id]);
    if (!result.rowCount || !await bcrypt.compare(currentPassword, result.rows[0].password_hash)) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'La contrasena actual es incorrecta' });
    }
    if (await bcrypt.compare(newPassword, result.rows[0].password_hash)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La contrasena nueva debe ser distinta' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await client.query(`UPDATE public.usuario SET password_hash = $1,
      must_change_password = FALSE, password_changed_at = now(),
      token_version = token_version + 1, updated_at = now(), updated_by = $2
      WHERE id_usuario = $2`, [hash, id]);
    await client.query(`INSERT INTO public.audit_log
      (id_usuario_actor, accion, entidad, id_entidad, datos_nuevos, ip, user_agent)
      VALUES ($1, 'USUARIO_CAMBIA_PASSWORD', 'usuario', $1, $2::jsonb, $3, $4)`,
    [id, JSON.stringify({ change_own_password: true, must_change_password: false }),
      String(req.ip || '').slice(0, 100) || null,
      String(req.get?.('user-agent') || '').slice(0, 900) || null]);
    await client.query('COMMIT');
    return res.json({ ok: true, message: 'Contrasena actualizada' });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    return httpError(res, error, 'Cambio de contrasena propia:');
  } finally { if (client) client.release(); }
}

module.exports = { getProveedoresAdmin, getCatalogoAdmin, getSyncHistory,
  getSyncById, resetUserPassword, changeOwnPassword };
