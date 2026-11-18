'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');

function idValido(valor) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function texto(valor, maximo) {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  return v.length > 0 && v.length <= maximo ? v : null;
}
function respuestaError(res, codigo, mensaje) {
  return res.status(codigo).json({ error: mensaje });
}

// Se inyectan las dependencias para permitir pruebas sin PostgreSQL real.
function crearControlador({ database = pool, hash = bcrypt.hash, randomBytes = crypto.randomBytes } = {}) {
  async function convertir(req, res) {
    const actor = idValido(req.user?.id_usuario);
    const idProspecto = idValido(req.params?.idProspecto);
    const negocio = texto(req.body?.nombre_mipyme, 180);
    const departamentoIngresado = req.body?.departamento == null || req.body.departamento === ''
      ? null : texto(req.body.departamento, 120);
    const correoIngresado = req.body?.correo == null || req.body.correo === ''
      ? null : texto(req.body.correo, 150);
    // undefined conserva el municipio anterior; '' lo limpia si cambia departamento.
    const municipioIngresado = req.body?.municipio === undefined
      ? undefined
      : (req.body.municipio === '' || req.body.municipio === null
          ? null : texto(req.body.municipio, 120));

    if (!actor) return respuestaError(res, 401, 'Sesion no valida');
    if (!idProspecto) return respuestaError(res, 400, 'Prospecto invalido');
    if (!negocio) return respuestaError(res, 400, 'El nombre del negocio es obligatorio (maximo 180 caracteres)');
    if (req.body?.departamento != null && req.body.departamento !== '' && !departamentoIngresado) {
      return respuestaError(res, 400, 'Departamento invalido');
    }
    if (req.body?.correo != null && req.body.correo !== '' && !correoIngresado) {
      return respuestaError(res, 400, 'Correo invalido');
    }
    if (correoIngresado && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoIngresado)) {
      return respuestaError(res, 400, 'Correo invalido');
    }
    if (req.body?.municipio != null && req.body.municipio !== '' && !municipioIngresado) {
      return respuestaError(res, 400, 'Municipio invalido');
    }

    let db;
    try {
      db = await database.connect();
      await db.query('BEGIN');
      const original = await db.query(`
        SELECT id_prospecto, id_asesor_usuario, documento, nombres, apellidos,
          telefono, correo, nombre_negocio, departamento, municipio, direccion_negocio,
          estado, id_mipyme
        FROM public.prospecto
        WHERE id_prospecto = $1 FOR UPDATE
      `, [idProspecto]);
      const p = original.rows[0];
      // Nunca descubrir ni convertir prospectos asignados a otros asesores.
      if (!p || Number(p.id_asesor_usuario) !== actor) {
        await db.query('ROLLBACK');
        return respuestaError(res, 404, 'Prospecto no encontrado para este asesor');
      }
      if (p.estado === 'convertido') {
        // Respuesta idempotente tras doble clic o reintento por timeout.
        if (!idValido(p.id_mipyme)) {
          await db.query('ROLLBACK');
          return respuestaError(res, 409, 'Prospecto convertido sin enlace a empresa: requiere revision');
        }
        const existente = await db.query(`
          SELECT u.id_usuario, u.nombre_usuario, u.documento, u.email,
                 m.id_mipyme, m.nombre_mipyme
          FROM public.usuario u
          JOIN public.mipyme_usuario mu ON mu.id_usuario = u.id_usuario
          JOIN public.mipyme m ON m.id_mipyme = mu.id_mipyme
          WHERE m.id_mipyme = $1 AND u.documento = $2 LIMIT 1
        `, [p.id_mipyme, p.documento]);
        await db.query('COMMIT');
        if (!existente.rowCount) {
          return respuestaError(res, 409, 'Enlace anterior no encontrado; requiere revision administrativa');
        }
        const u = existente.rows[0];
        return res.status(200).json({
          ya_convertido: true,
          id_usuario: u.id_usuario,
          id_mipyme: u.id_mipyme,
          usuario: { id_usuario: u.id_usuario, nombre_usuario: u.nombre_usuario,
            documento: u.documento, email: u.email },
          mipyme: { id_mipyme: u.id_mipyme, nombre_mipyme: u.nombre_mipyme },
          prospecto: { id_prospecto: idProspecto, estado: 'convertido' }
        });
      }
      if (!['en_gestion', 'agendado'].includes(p.estado)) {
        await db.query('ROLLBACK');
        return respuestaError(res, 409, 'Inicia la gestion comercial del prospecto antes de convertirlo');
      }
      const correo = (correoIngresado || texto(p.correo, 150) || '').toLowerCase();
      const departamento = departamentoIngresado || texto(p.departamento, 120) || null;
      const municipio = municipioIngresado === undefined
        ? (texto(p.municipio, 120) || null) : municipioIngresado;
      if (municipio && !departamento) {
        await db.query('ROLLBACK');
        return respuestaError(res, 422, 'Selecciona el departamento del municipio');
      }
      if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        await db.query('ROLLBACK');
        return respuestaError(res, 422, 'Se necesita un correo valido para crear la ficha de cliente');
      }
      if (!/^\d{5,15}$/.test(String(p.documento || ''))) {
        await db.query('ROLLBACK');
        return respuestaError(res, 422, 'Documento del prospecto invalido');
      }
      const rol = await db.query(`
        SELECT id_rol FROM public.rol
        WHERE lower(nombre_rol) = 'cliente' AND estado = 'activo'
        ORDER BY id_rol LIMIT 1
      `);
      if (!rol.rowCount) {
        await db.query('ROLLBACK');
        return respuestaError(res, 409, 'El rol Cliente no esta configurado');
      }
      const duplicados = await db.query(`
        SELECT id_usuario FROM public.usuario
        WHERE trim(documento) = $1 OR lower(trim(email)) = $2 LIMIT 1
      `, [p.documento, correo]);
      if (duplicados.rowCount) {
        await db.query('ROLLBACK');
        return respuestaError(res, 409, 'Ya existe un usuario con este documento o correo; no se crearon duplicados');
      }
      const asesor = await db.query(`
        SELECT id_asesor FROM public.asesor
        WHERE id_usuario = $1 AND estado = 'activo'
        ORDER BY id_asesor LIMIT 1
      `, [actor]);
      const esAdmin = ['administrador', 'super administrador'].includes(
        String(req.user?.nombre_rol || '').toLowerCase());
      if (!asesor.rowCount && !esAdmin) {
        await db.query('ROLLBACK');
        return respuestaError(res, 409, 'El usuario no tiene un registro de asesor activo para asignar la empresa');
      }

      // No se entrega ninguna clave basada en el documento. Esta cuenta
      // necesita un proceso posterior de activacion/recuperacion de acceso.
      const claveAleatoria = randomBytes(32).toString('hex');
      const passwordHash = await hash(claveAleatoria, 12);
      const nombreCompleto = [p.nombres, p.apellidos].filter(Boolean).join(' ').trim();
      const usuario = await db.query(`
        INSERT INTO public.usuario
          (documento, nombre_usuario, email, telefono, password_hash, id_rol,
           estado, created_at, created_by, must_change_password)
        VALUES ($1,$2,$3,$4,$5,$6,'activo',NOW(),$7,TRUE)
        RETURNING id_usuario, documento, nombre_usuario, email, telefono, estado
      `, [p.documento, nombreCompleto, correo, p.telefono || null,
        passwordHash, rol.rows[0].id_rol, actor]);
      const u = usuario.rows[0];
      const empresa = await db.query(`
        INSERT INTO public.mipyme
          (nombre_mipyme, departamento, municipio, direccion, tipo_persona, estado, created_at, created_by)
        VALUES ($1,$2,$3,$4,'Natural','activo',NOW(),$5)
        RETURNING id_mipyme, nombre_mipyme, estado
      `, [negocio, departamento, municipio, p.direccion_negocio || null, actor]);
      const m = empresa.rows[0];
      await db.query(`
        INSERT INTO public.mipyme_usuario (id_usuario, id_mipyme, tipo_relacion)
        VALUES ($1,$2,'propietario')
      `, [u.id_usuario, m.id_mipyme]);
      if (asesor.rowCount) {
        await db.query(`
          INSERT INTO public.asesor_mipyme (id_asesor, id_mipyme)
          SELECT $1, $2 WHERE NOT EXISTS
            (SELECT 1 FROM public.asesor_mipyme WHERE id_asesor=$1 AND id_mipyme=$2)
        `, [asesor.rows[0].id_asesor, m.id_mipyme]);
      }
      await db.query(`
        UPDATE public.prospecto
        SET estado='convertido', id_mipyme=$2,
            departamento=$3, municipio=$4, updated_at=NOW()
        WHERE id_prospecto=$1
      `, [idProspecto, m.id_mipyme, departamento, municipio]);
      await db.query(`
        INSERT INTO public.prospecto_evento (id_prospecto, tipo_evento, detalle, id_usuario)
        VALUES ($1,'conversion_cliente',$2::jsonb,$3)
      `, [idProspecto, JSON.stringify({ id_usuario: u.id_usuario,
        id_mipyme: m.id_mipyme, nombre_mipyme: m.nombre_mipyme,
        departamento, municipio,
        direccion: p.direccion_negocio || null,
        estado_anterior: p.estado, estado_nuevo: 'convertido' }), actor]);
      await db.query(`
        INSERT INTO public.audit_log
          (id_usuario_actor, accion, entidad, id_entidad, datos_nuevos, motivo, ip, user_agent)
        VALUES ($1,'PROSPECTO_CONVERTIDO','prospecto',$2,$3::jsonb,
                'Conversion confirmada por asesor', $4,$5)
      `, [actor, idProspecto, JSON.stringify({ id_usuario: u.id_usuario, id_mipyme: m.id_mipyme }),
        req.ip || null, req.get?.('user-agent') || null]);
      await db.query('COMMIT');
      return res.status(201).json({
        ya_convertido: false,
        message: 'Prospecto convertido en cliente correctamente',
        id_usuario: u.id_usuario,
        id_mipyme: m.id_mipyme,
        usuario: u,
        mipyme: m,
        prospecto: { id_prospecto: idProspecto, estado: 'convertido' }
      });
    } catch (e) {
      if (db) { try { await db.query('ROLLBACK'); } catch (_) {} }
      if (e.code === '23505') {
        return respuestaError(res, 409, 'El documento o correo ya esta registrado; no se crearon duplicados');
      }
      if (e.code === '42501') {
        return respuestaError(res, 503, 'Faltan permisos de PostgreSQL para completar la conversion');
      }
      console.error('Convertir prospecto:', e);
      return respuestaError(res, 500, 'No fue posible convertir el prospecto');
    } finally { if (db) db.release(); }
  }
  return { convertir };
}

module.exports = { crearControlador };
