'use strict';
const { accesoMipyme } = require('../services/accesoMipyme');
const { clasificarActivo } = require('../services/fveClasificacionActivo');
const { evaluarActivo, CATEGORIAS } = require('../services/fveMotorElegibilidad');
const idPositivo = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;

function errorHttp(status, mensaje) {
  const e = new Error(mensaje); e.httpStatus = status; return e;
}
function datosNuevosValidos(codigo, datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return false;
  const campos = codigo === 'LUMINARIAS'
    ? ['tecnologia_nueva', 'potencia_nueva_w']
    : codigo === 'GRIFERIA'
      ? ['caudal_nuevo_l_min', 'dias_operacion_anio']
      : ['caudal_nuevo_l_min', 'dias_operacion_anio', 'dispositivo_sobre_griferia_existente'];
  return Object.keys(datos).every(k => campos.includes(k));
}
function crearHandlers(database, acceso = accesoMipyme) {
  async function evaluar(req, res) {
    const usuario = idPositivo(req.user?.id_usuario);
    const idProceso = idPositivo(req.body?.id_proceso);
    const idActivo = idPositivo(req.body?.id_activo);
    const idItem = req.body?.id_item === undefined || req.body?.id_item === null
      ? null : idPositivo(req.body.id_item);
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    if (!idProceso || !idActivo || (req.body?.id_item != null && !idItem)) {
      return res.status(400).json({ error: 'Identificadores invalidos' });
    }
    const ruta = req.body?.ruta_intervencion;
    if (!['reemplazo', 'adquisicion_nueva'].includes(ruta)) {
      return res.status(400).json({ error: 'Selecciona ruta_intervencion: reemplazo o adquisicion_nueva' });
    }
    const fuente = req.body?.fuente_producto || null;
    if (fuente !== null && (typeof fuente !== 'object' || Array.isArray(fuente) ||
      JSON.stringify(fuente).length > 2500)) {
      return res.status(400).json({ error: 'Formato de evidencia invalido' });
    }
    let client;
    try {
      client = await database.connect();
      await client.query('BEGIN');
      const origen = await client.query(`
        SELECT p.id_proceso, p.id_mipyme, a.id_activo, a.tipo, a.nombre,
               to_jsonb(c) AS caracterizacion
        FROM public.fve_proceso p
        JOIN public.activo a ON a.id_mipyme = p.id_mipyme
        LEFT JOIN public.fve_activo_caracterizacion c ON c.id_activo = a.id_activo
        WHERE p.id_proceso = $1 AND a.id_activo = $2
          AND a.estado IS DISTINCT FROM 'eliminado'
      `, [idProceso, idActivo]);
      if (!origen.rowCount) throw errorHttp(404, 'Proceso o activo no encontrado en esta empresa');
      const a = origen.rows[0];
      if (!(await acceso(client, a.id_mipyme, usuario))) {
        throw errorHttp(403, 'No autorizado para esta empresa');
      }
      const codigo = clasificarActivo(a.tipo, a.nombre);
      if (!CATEGORIAS.has(codigo)) {
        throw errorHttp(422, 'El motor FVE 03 aun no implementa esta categoria');
      }
      if (!datosNuevosValidos(codigo, req.body?.datos_nuevos)) {
        throw errorHttp(400, 'Campos nuevos no admitidos para la categoria');
      }
      const caracterizacion = a.caracterizacion;
      if (!caracterizacion || caracterizacion.codigo_taxonomia !== codigo) {
        throw errorHttp(422, 'Primero guarda la ficha tecnica del activo existente (Entrega 02)');
      }
      if (caracterizacion.tipo_intervencion === 'adquisicion_nueva' && ruta === 'reemplazo') {
        throw errorHttp(422, 'La ficha existente registra adquisicion nueva; no puede evaluarse como reemplazo');
      }
      const tax = await client.query(`
        SELECT codigo, nombre, criterio, version_regla, fuente, habilitada, alcance
        FROM public.fve_taxonomia_activo
        WHERE codigo = $1
      `, [codigo]);
      if (!tax.rowCount || tax.rows[0].habilitada !== true || tax.rows[0].alcance !== 'MVP') {
        throw errorHttp(422, 'Categoria no habilitada para el MVP');
      }
      const params = await client.query(`
        SELECT umbral_ahorro, banda_incertidumbre, dias_operacion_default,
               version_parametro, estado_aprobacion
        FROM public.fve_motor_parametro WHERE codigo_taxonomia = $1
      `, [codigo]);
      if (!params.rowCount) throw errorHttp(422, 'Parametros tecnicos pendientes de configurar');
      let producto = null;
      if (idItem) {
        const item = await client.query(`
          SELECT id_item, tipo_item, nombre, precio_base, disponible, estado,
                 especificaciones, url_origen
          FROM public.item_catalogo WHERE id_item = $1
        `, [idItem]);
        if (!item.rowCount || item.rows[0].disponible !== true || item.rows[0].estado === 'eliminado') {
          throw errorHttp(422, 'Producto inexistente o no disponible en catalogo');
        }
        producto = item.rows[0];
      }
      const entrada = {
        codigo_taxonomia: codigo,
        tipo_intervencion: ruta,
        datos_anteriores: caracterizacion.datos_tecnicos || {},
        datos_nuevos: req.body.datos_nuevos,
        fuente_producto: fuente,
        fuente_activo: { id_activo: idActivo,
          version_taxonomia_caracterizacion: caracterizacion.version_taxonomia,
          ruta_registrada_en_inventario: caracterizacion.tipo_intervencion,
          fecha_caracterizacion: caracterizacion.updated_at || caracterizacion.created_at || null },
        producto_catalogo: producto,
      };
      const resultado = evaluarActivo({
        categoria: codigo,
        anterior: entrada.datos_anteriores,
        nuevo: entrada.datos_nuevos,
        fuenteProducto: fuente,
        parametros: params.rows[0],
        intervencion: entrada.tipo_intervencion,
      });
      resultado.observaciones.push('Esta evaluacion no confirma compra, disposicion DNSH ni aprobacion de credito.');
      if (!idItem) resultado.observaciones.push('Producto del catalogo sin vincular: evaluacion exploratoria.');
      // En Entrega 03 NINGUNA evaluacion se habilita automaticamente para propuesta comercial.
      const grabar = await client.query(`
        INSERT INTO public.fve_evaluacion_activo (
          id_proceso, id_mipyme, id_activo, id_item, codigo_taxonomia,
          version_taxonomia, version_parametros, version_motor, estado,
          cumplimiento_producto, cumplimiento_ahorro,
          consumo_anterior_anual, consumo_nuevo_anual, ahorro_anual_estimado,
          ahorro_porcentual_central, ahorro_porcentual_minimo, unidad,
          datos_entrada, resultado, snapshot_taxonomia, apto_para_propuesta, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
          $18::jsonb,$19::jsonb,$20::jsonb,FALSE,$21
        ) RETURNING id_evaluacion, created_at
      `, [idProceso, a.id_mipyme, idActivo, idItem, codigo,
        tax.rows[0].version_regla, resultado.version_parametros,
        resultado.version_motor, resultado.estado,
        resultado.cumple_criterio_producto, resultado.cumple_umbral_ahorro,
        resultado.consumo_anterior_anual, resultado.consumo_nuevo_anual,
        resultado.ahorro_anual_estimado, resultado.ahorro_porcentual_central,
        resultado.ahorro_porcentual_minimo, resultado.unidad,
        JSON.stringify(entrada), JSON.stringify(resultado), JSON.stringify(tax.rows[0]), usuario]);
      const idEvaluacion = grabar.rows[0].id_evaluacion;
      await client.query(`
        INSERT INTO public.audit_log (
          id_usuario_actor, accion, entidad, id_entidad,
          datos_nuevos, motivo, ip, user_agent
        ) VALUES ($1,'FVE_ACTIVO_EVALUADO','fve_evaluacion_activo',
          CASE WHEN $2::bigint BETWEEN 1 AND 2147483647 THEN $2::integer ELSE NULL END,
          $3::jsonb,'Evaluacion preliminar FVE 03', $4, $5)
      `, [usuario, idEvaluacion,
        JSON.stringify({ id_proceso: idProceso, id_activo: idActivo,
          codigo_taxonomia: codigo, estado: resultado.estado }),
        req.ip || null, req.get?.('user-agent') || null]);
      await client.query('COMMIT');
      return res.status(201).json({ id_evaluacion: idEvaluacion,
        created_at: grabar.rows[0].created_at, resultado,
        apto_para_propuesta: false });
    } catch (e) {
      if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
      if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.message });
      console.error('FVE 03 evaluar:', e);
      return res.status(500).json({ error: 'No se pudo evaluar el activo' });
    } finally { if (client) client.release(); }
  }

  async function listado(req, res) {
    const usuario = idPositivo(req.user?.id_usuario);
    const idProceso = idPositivo(req.params.idProceso);
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    if (!idProceso) return res.status(400).json({ error: 'Proceso invalido' });
    try {
      const p = await database.query('SELECT id_mipyme FROM public.fve_proceso WHERE id_proceso = $1', [idProceso]);
      if (!p.rowCount) return res.status(404).json({ error: 'Proceso inexistente' });
      if (!(await acceso(database, p.rows[0].id_mipyme, usuario))) {
        return res.status(403).json({ error: 'No autorizado para esta empresa' });
      }
      const e = await database.query(`
        SELECT id_evaluacion, id_proceso, id_activo, id_item, codigo_taxonomia,
               estado, ahorro_anual_estimado, ahorro_porcentual_minimo,
               unidad, resultado, apto_para_propuesta, created_at
        FROM public.fve_evaluacion_activo WHERE id_proceso = $1
        ORDER BY created_at DESC, id_evaluacion DESC LIMIT 200
      `, [idProceso]);
      return res.json({ evaluaciones: e.rows });
    } catch (e) {
      console.error('FVE 03 listado:', e);
      return res.status(500).json({ error: 'No se pudieron consultar las evaluaciones' });
    }
  }

  async function detalle(req, res) {
    const usuario = idPositivo(req.user?.id_usuario);
    const idEvaluacion = idPositivo(req.params.idEvaluacion);
    if (!usuario) return res.status(401).json({ error: 'Usuario no autenticado' });
    if (!idEvaluacion) return res.status(400).json({ error: 'Evaluacion invalida' });
    try {
      const e = await database.query('SELECT * FROM public.fve_evaluacion_activo WHERE id_evaluacion = $1', [idEvaluacion]);
      if (!e.rowCount) return res.status(404).json({ error: 'Evaluacion inexistente' });
      if (!(await acceso(database, e.rows[0].id_mipyme, usuario))) {
        return res.status(403).json({ error: 'No autorizado para esta empresa' });
      }
      return res.json({ evaluacion: e.rows[0] });
    } catch (e) {
      console.error('FVE 03 detalle:', e);
      return res.status(500).json({ error: 'No se pudo consultar la evaluacion' });
    }
  }
  return { evaluar, listado, detalle };
}
module.exports = { crearHandlers };
