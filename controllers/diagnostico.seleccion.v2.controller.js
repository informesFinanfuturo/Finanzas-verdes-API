'use strict';
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');
const v = require('../services/fveSeleccionValidaciones');

function crearGuardado({ db=pool, acceso=accesoMipyme }={}) {
  return async function guardarSeleccionActivosV2(req,res) {
    const idDiagnostico = v.id(req.params.idDiagnostico);
    const usuario = v.id(req.user?.id_usuario);
    if (!usuario) return res.status(401).json({error:'Usuario no autenticado'});
    if (!idDiagnostico) return res.status(400).json({error:'Diagnostico invalido'});
    let ids, alternativas, resumen;
    try {
      ids = v.validarIds(req.body?.activos_seleccionados);
      alternativas = v.validarAlternativas(req.body?.alternativas_seleccionadas, ids);
      resumen = v.validarResumen(req.body?.resumen_seleccionado);
    } catch (e) { return res.status(400).json({error:e.message}); }
    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const r = await client.query(`SELECT id_mipyme, metricas, estado FROM public.diagnostico
        WHERE id_diagnostico=$1 FOR UPDATE`,[idDiagnostico]);
      if (!r.rowCount || r.rows[0].estado === 'eliminado') {
        await client.query('ROLLBACK'); return res.status(404).json({error:'Diagnostico no encontrado'});
      }
      const d = r.rows[0];
      if (!await acceso(client,d.id_mipyme,usuario)) {
        await client.query('ROLLBACK'); return res.status(403).json({error:'Sin acceso a este diagnostico'});
      }
      const permitidos = new Set(v.lista(d.metricas?.activos).map(a=>v.id(a?.id_activo)));
      if (ids.some(a=>!permitidos.has(a))) {
        await client.query('ROLLBACK'); return res.status(422).json({error:'La seleccion incluye activos fuera de este diagnostico'});
      }
      const activos = await client.query(`SELECT id_activo,nombre,tipo FROM public.activo
        WHERE id_mipyme=$1 AND id_activo=ANY($2::int[]) AND estado IS DISTINCT FROM 'eliminado'`, [d.id_mipyme,ids]);
      if (activos.rowCount !== ids.length) {
        await client.query('ROLLBACK'); return res.status(422).json({error:'Un activo no pertenece a la empresa o ya no esta disponible'});
      }
      const items = await client.query(`SELECT i.id_item,i.nombre,i.tipo_item,i.disponible,i.estado,
        p.estado AS estado_proveedor FROM public.item_catalogo i
        JOIN public.proveedor p ON p.id_proveedor=i.id_proveedor
        WHERE i.id_item=ANY($1::int[])`,[alternativas.map(x=>x.id_item)]);
      const productos = new Map(items.rows.map(x=>[Number(x.id_item),x]));
      const porActivo = new Map(activos.rows.map(x=>[Number(x.id_activo),x]));
      for (const a of alternativas) {
        const item = productos.get(a.id_item);
        if (!item || !item.disponible || item.estado!=='activo' || item.estado_proveedor!=='activo' ||
          !v.verificarCompatibilidad(porActivo.get(a.id_activo),item)) {
          await client.query('ROLLBACK'); return res.status(422).json({error:'La alternativa no esta disponible o no es compatible con el activo '+a.id_activo});
        }
      }
      const guardar = await client.query(`UPDATE public.diagnostico SET
        metricas=(COALESCE(metricas::jsonb,'{}'::jsonb) || jsonb_build_object(
          'activos_seleccionados',$2::jsonb,'alternativas_seleccionadas',$3::jsonb,
          'resumen_seleccionado',$4::jsonb))::json,
        updated_at=now(),updated_by=$5
        WHERE id_diagnostico=$1 RETURNING *`,[
          idDiagnostico,JSON.stringify(ids),JSON.stringify(alternativas),JSON.stringify(resumen),usuario]);
      await client.query('COMMIT');
      return res.json({diagnostico:guardar.rows[0],message:'Seleccion guardada correctamente'});
    } catch(e) {
      if(client) { try {await client.query('ROLLBACK');} catch (_){} }
      console.error('Guardar seleccion diagnostico FVE:',e);
      return res.status(500).json({error:'No se pudo guardar la seleccion'});
    } finally {if(client) client.release();}
  };
}
module.exports = {crearGuardado,guardarSeleccionActivosV2:crearGuardado()};
