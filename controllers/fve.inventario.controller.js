'use strict';
const { accesoMipyme } = require('../services/accesoMipyme');
const {
  clasificarActivo, camposExistentes, sugerenciasDesdeDatos, sugerenciasIAConfirmablesDesdeDatos, validarDatosExistentes,
} = require('../services/fveClasificacionActivo');

const { referenciasSinVerificar } = require('../services/fveReferenciasAnalisisIA');

const idPositivo = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;

function createInventarioHandlers(database, acceso = accesoMipyme) {
  async function categoriaPorCodigo(db, codigo) {
    if (!codigo) return null;
    const r = await db.query(`
      SELECT codigo, nombre, criterio, campos_tecnicos, habilitada, version_regla
      FROM public.fve_taxonomia_activo
      WHERE codigo = $1 AND habilitada = true AND alcance = 'MVP'
    `, [codigo]);
    return r.rows[0] || null;
  }
  function fichaDeActivo(a, categoria, caracterizacion = null) {
    const campos = camposExistentes(categoria?.codigo);
    const info = caracterizacion && caracterizacion.codigo_taxonomia === categoria?.codigo
      ? caracterizacion : null;
    const datos = info?.datos_tecnicos || {};
    return {
      id_activo: a.id_activo,
      codigo_taxonomia: categoria?.codigo || null,
      taxonomia: categoria ? {
        codigo: categoria.codigo, nombre: categoria.nombre, criterio: categoria.criterio,
        version_regla: categoria.version_regla,
      } : null,
      campos_existentes: campos,
      datos_tecnicos: Object.fromEntries(campos.filter(c => datos[c.codigo] !== undefined)
        .map(c => [c.codigo, datos[c.codigo]])),
      campos_pendientes: campos.filter(c => c.requerido && (datos[c.codigo] === undefined || datos[c.codigo] === null))
        .map(c => ({ codigo: c.codigo, etiqueta: c.etiqueta, tipo: c.tipo })),
      // Valores con evidencia explicita: aptos para precarga confirmable.
      sugerencias: sugerenciasIAConfirmablesDesdeDatos(a.datos, campos),
      sugerencias_ia: sugerenciasIAConfirmablesDesdeDatos(a.datos, campos),
      // Referencias del informe: NO son mediciones y requieren revision del asesor.
      referencias_ia: referenciasSinVerificar(
        a.datos, campos, sugerenciasIAConfirmablesDesdeDatos(a.datos, campos)),
      tiene_caracterizacion: Boolean(info),
    };
  }

  async function taxonomia(req, res) {
    if (!idPositivo(req.user?.id_usuario)) return res.status(401).json({ error: 'Usuario no autenticado' });
    try {
      const r = await database.query(`
        SELECT codigo, nombre, categoria, subsector, criterio, indicador, dato_fuente,
               version_regla, fuente
        FROM public.fve_taxonomia_activo
        WHERE habilitada = true AND alcance = 'MVP'
        ORDER BY categoria, nombre
      `);
      return res.json({ taxonomia: r.rows });
    } catch (e) {
      console.error('FVE taxonomia:', e);
      return res.status(500).json({ error: 'No fue posible consultar las categorias' });
    }
  }

  async function clasificar(req, res) {
    if (!idPositivo(req.user?.id_usuario)) return res.status(401).json({ error: 'Usuario no autenticado' });
    const tipo = String(req.query?.tipo || '').slice(0, 100);
    const nombre = String(req.query?.nombre || '').slice(0, 200);
    try {
      const categoria = await categoriaPorCodigo(database, clasificarActivo(tipo, nombre));
      return res.json({ ficha: fichaDeActivo({ id_activo: null, datos: null }, categoria) });
    } catch (e) {
      console.error('FVE clasificar:', e);
      return res.status(500).json({ error: 'No fue posible clasificar el activo' });
    }
  }

  async function consultarActivo(req, res) {
    const id = idPositivo(req.params.idActivo);
    const usuario = idPositivo(req.user?.id_usuario);
    if (!id) return res.status(400).json({ error: 'Activo invalido' });
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    try {
      const r = await database.query(`
        SELECT a.id_activo, a.id_mipyme, a.nombre, a.tipo, a.datos,
               to_jsonb(c) AS caracterizacion
        FROM public.activo a
        LEFT JOIN public.fve_activo_caracterizacion c ON c.id_activo = a.id_activo
        WHERE a.id_activo = $1 AND a.estado IS DISTINCT FROM 'eliminado'
      `, [id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Activo no encontrado' });
      const a = r.rows[0];
      if (!(await acceso(database, a.id_mipyme, usuario))) {
        return res.status(403).json({ error: 'No autorizado para la empresa' });
      }
      const categoria = await categoriaPorCodigo(database, clasificarActivo(a.tipo, a.nombre));
      return res.json({ ficha: fichaDeActivo(a, categoria, a.caracterizacion) });
    } catch (e) {
      console.error('FVE consultar ficha:', e);
      return res.status(500).json({ error: 'No fue posible consultar la ficha' });
    }
  }

  async function listar(req, res) {
    const id = idPositivo(req.params.idMipyme);
    const usuario = idPositivo(req.user?.id_usuario);
    if (!id) return res.status(400).json({ error: 'Empresa invalida' });
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    try {
      if (!(await acceso(database, id, usuario))) return res.status(403).json({ error: 'No autorizado para la empresa' });
      const r = await database.query(`
        SELECT a.id_activo, a.id_mipyme, a.nombre, a.tipo, a.marca, a.modelo,
               a.estado, a.datos, to_jsonb(c) AS caracterizacion
        FROM public.activo a
        LEFT JOIN public.fve_activo_caracterizacion c ON c.id_activo = a.id_activo
        WHERE a.id_mipyme = $1 AND a.estado IS DISTINCT FROM 'eliminado'
        ORDER BY a.nombre, a.id_activo
      `, [id]);
      // Solo las ocho categorias habilitadas; sin exponer otras tecnologias.
      const cats = await database.query(`
        SELECT codigo, nombre, criterio, habilitada, version_regla
        FROM public.fve_taxonomia_activo
        WHERE habilitada = true AND alcance = 'MVP'
      `);
      const porCodigo = new Map(cats.rows.map(c => [c.codigo, c]));
      const activos = r.rows.flatMap(a => {
        const codigo = clasificarActivo(a.tipo, a.nombre);
        const cat = porCodigo.get(codigo);
        if (!cat) return [];
        const ficha = fichaDeActivo(a, cat, a.caracterizacion);
        const { datos, ...seguro } = a;
        return [{ ...seguro, caracterizacion: ficha.tiene_caracterizacion ? a.caracterizacion : null,
          taxonomia: ficha.taxonomia, campos_existentes: ficha.campos_existentes,
          campos_pendientes: ficha.campos_pendientes }];
      });
      return res.json({ activos });
    } catch (e) {
      console.error('FVE inventario listar:', e);
      return res.status(500).json({ error: 'No fue posible cargar el inventario' });
    }
  }

  async function guardar(req, res) {
    const id = idPositivo(req.params.idActivo);
    const usuario = idPositivo(req.user?.id_usuario);
    if (!id) return res.status(400).json({ error: 'Activo invalido' });
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    const observaciones = req.body?.observaciones ?? '';
    if (typeof observaciones !== 'string' || observaciones.length > 1500) {
      return res.status(400).json({ error: 'Observaciones invalidas' });
    }
    let db;
    try {
      db = await database.connect();
      await db.query('BEGIN');
      const r = await db.query(`
        SELECT id_activo, id_mipyme, tipo, nombre FROM public.activo
        WHERE id_activo = $1 AND estado IS DISTINCT FROM 'eliminado' FOR UPDATE
      `, [id]);
      if (!r.rowCount) {
        await db.query('ROLLBACK'); return res.status(404).json({ error: 'Activo no encontrado' });
      }
      const a = r.rows[0];
      if (!(await acceso(db, a.id_mipyme, usuario))) {
        await db.query('ROLLBACK'); return res.status(403).json({ error: 'No autorizado para la empresa' });
      }
      const categoria = await categoriaPorCodigo(db, clasificarActivo(a.tipo, a.nombre));
      if (!categoria) {
        await db.query('ROLLBACK');
        return res.status(422).json({ error: 'Este tipo de activo no tiene una categoria automatica compatible' });
      }
      // No se admiten datos de la Tecnologia Verde futura en el activo existente.
      const campos = camposExistentes(categoria.codigo);
      const v = validarDatosExistentes(req.body?.datos_tecnicos ?? {}, campos);
      if (v.error) {
        await db.query('ROLLBACK'); return res.status(400).json({ error: v.error });
      }
      const previa = await db.query(`
        SELECT codigo_taxonomia, datos_tecnicos FROM public.fve_activo_caracterizacion
        WHERE id_activo = $1 FOR UPDATE
      `, [id]);
      // Preservar claves de tecnologia nueva de fichas antiguas, pero sin reutilizarlas
      // para evaluar al equipo actual ni mostrarlas en su formulario.
      const anterior = previa.rows[0];
      const datosConservados = anterior?.codigo_taxonomia === categoria.codigo
        ? Object.fromEntries(Object.entries(anterior.datos_tecnicos || {})
          .filter(([key]) => !campos.some(c => c.codigo === key))) : {};
      const datos = { ...datosConservados, ...v.normalizados };
      const estado = v.pendientes.length ? 'pendiente_datos' : 'completa';
      const up = await db.query(`
        INSERT INTO public.fve_activo_caracterizacion (
          id_activo, id_mipyme, codigo_taxonomia, tipo_intervencion, datos_tecnicos,
          observaciones, estado_datos, campos_pendientes, version_taxonomia,
          criterio_snapshot, created_by, updated_by
        ) VALUES ($1,$2,$3,'reemplazo',$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10,$10)
        ON CONFLICT (id_activo) DO UPDATE SET
          codigo_taxonomia = EXCLUDED.codigo_taxonomia,
          tipo_intervencion = EXCLUDED.tipo_intervencion,
          datos_tecnicos = EXCLUDED.datos_tecnicos,
          observaciones = EXCLUDED.observaciones,
          estado_datos = EXCLUDED.estado_datos,
          campos_pendientes = EXCLUDED.campos_pendientes,
          version_taxonomia = EXCLUDED.version_taxonomia,
          criterio_snapshot = EXCLUDED.criterio_snapshot,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING *
      `, [id, a.id_mipyme, categoria.codigo, JSON.stringify(datos), observaciones.trim(),
        estado, JSON.stringify(v.pendientes), categoria.version_regla, categoria.criterio, usuario]);
      await db.query(`
        INSERT INTO public.audit_log (
          id_usuario_actor, accion, entidad, id_entidad,
          datos_nuevos, motivo, ip, user_agent
        ) VALUES ($1, 'FVE_ACTIVO_CARACTERIZADO', 'fve_activo_caracterizacion',
                  $2, $3::jsonb, 'Ficha del activo existente', $4, $5)
      `, [usuario, id, JSON.stringify({ codigo_taxonomia: categoria.codigo, estado_datos: estado }),
        req.ip || null, req.get?.('user-agent') || null]);
      await db.query('COMMIT');
      return res.json({ caracterizacion: up.rows[0],
        aviso: 'Datos del activo guardados. No constituyen elegibilidad de la inversion.' });
    } catch (e) {
      if (db) { try { await db.query('ROLLBACK'); } catch (_) {} }
      console.error('FVE guardar ficha:', e);
      return res.status(500).json({ error: 'No fue posible guardar la ficha tecnica' });
    } finally { if (db) db.release(); }
  }

  async function validarReemplazo(req, res) {
    const id = idPositivo(req.params.idActivo);
    const usuario = idPositivo(req.user?.id_usuario);
    if (!id) return res.status(400).json({ error: 'Activo invalido' });
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    try {
      const r = await database.query(`
        SELECT a.id_activo, a.id_mipyme, a.tipo, a.nombre, a.datos,
               to_jsonb(c) AS caracterizacion
        FROM public.activo a
        LEFT JOIN public.fve_activo_caracterizacion c ON c.id_activo = a.id_activo
        WHERE a.id_activo = $1 AND a.estado IS DISTINCT FROM 'eliminado'
      `, [id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Activo no encontrado' });
      const a = r.rows[0];
      if (!(await acceso(database, a.id_mipyme, usuario))) return res.status(403).json({ error: 'No autorizado para la empresa' });
      const categoria = await categoriaPorCodigo(database, clasificarActivo(a.tipo, a.nombre));
      if (!categoria) return res.status(422).json({ error: 'El activo no pertenece a las categorias disponibles' });
      const ficha = fichaDeActivo(a, categoria, a.caracterizacion);
      return res.json({ puede_continuar: ficha.campos_pendientes.length === 0,
        campos_pendientes: ficha.campos_pendientes,
        mensaje: ficha.campos_pendientes.length === 0
          ? 'Datos del activo existente completos; falta evaluar la Tecnologia Verde propuesta.'
          : 'Completa los datos indicados en la ficha de Activos antes del reemplazo.',
      });
    } catch (e) {
      console.error('FVE validar reemplazo:', e);
      return res.status(500).json({ error: 'No fue posible comprobar el reemplazo' });
    }
  }

  return { taxonomia, clasificar, consultarActivo, listar, guardar, validarReemplazo };
}
module.exports = { createInventarioHandlers };
