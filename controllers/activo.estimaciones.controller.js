'use strict';
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');
const { pendientesActivo, limpiarIA } = require('../services/fveEstimacionesIA');
const { buscarReferencias } = require('../services/fveBusquedaOrquestadorIA');
const { crearTrazaReferencias } = require('../services/fveTrazaReferenciasIA');
const entero = v => Number.isSafeInteger(Number(v)) && Number(v)>0 ? Number(v):null;
const objeto = x => x && typeof x==='object' && !Array.isArray(x) ? x : {};
const textoSeguro = e => e?.code==='GEMINI_KEY_MISSING' ? 'La API no tiene configurada GEMINI_API_KEY.' :
  'No fue posible completar la busqueda web con IA. Intenta nuevamente y revisa el servidor.';
function createHandlers(db=pool, acceso=accesoMipyme, investigar=buscarReferencias) {
  async function consultarBase(id, usuario) {
    const r=await db.query(`SELECT id_activo,id_mipyme,nombre,tipo,marca,modelo,descripcion,datos,estado
      FROM public.activo WHERE id_activo=$1 AND estado IS DISTINCT FROM 'eliminado'`,[id]);
    if (!r.rowCount) return {status:404,error:'Activo no encontrado'};
    const a=r.rows[0];
    if (!await acceso(db,a.id_mipyme,usuario)) return {status:403,error:'Sin acceso a la empresa'};
    const c=await db.query(`SELECT codigo_taxonomia,datos_tecnicos FROM public.fve_activo_caracterizacion WHERE id_activo=$1`,[id]);
    const evaluacion=pendientesActivo(a,c.rows[0]);
    return {a,evaluacion};
  }
  async function estado(req,res) {
    const id=entero(req.params.id),usuario=entero(req.user?.id_usuario);
    if (!id||!usuario) return res.status(400).json({error:'Identificador invalido'});
    try { const d=await consultarBase(id,usuario);
      if (d.error) return res.status(d.status).json({error:d.error});
      return res.json({id_activo:id,...d.evaluacion,
        estimaciones:objeto(objeto(d.a.datos).fve_estimaciones_ia),
        advertencia:'Las referencias IA no son mediciones ni se incorporan a la ficha tecnica verificada.'});
    } catch(e){ console.error('[FVE ESTIMACIONES] Estado:',e); return res.status(500).json({error:'No se pudo consultar el estado tecnico'}); }
  }
  async function investigarActivo(req,res) {
    const id=entero(req.params.id), usuario=entero(req.user?.id_usuario);
    if(!id||!usuario) return res.status(400).json({error:'Identificador invalido'});
    const traza=crearTrazaReferencias(id,usuario);
    let d;
    try { d=await consultarBase(id,usuario);
      if(d.error) {
        traza('SOLICITUD_RECHAZADA',{estado_http:d.status,razon:d.error});
        return res.status(d.status).json({error:d.error});
      }
      const campos=d.evaluacion.campos_busqueda;
      traza('ESTADO_TECNICO',{
        id_mipyme:d.a.id_mipyme,
        taxonomia:d.evaluacion.codigo_taxonomia,
        campos_pendientes:d.evaluacion.faltantes,
        campos_para_busqueda:campos,
      });
      if(!campos.length) {
        traza('BUSQUEDA_NO_APLICABLE',{motivo:'NO_HAY_CAMPOS_ESTIMABLES_PENDIENTES'});
        return res.status(422).json({error:'No hay campos tecnicos estimables pendientes. Los restantes requieren datos aportados por el usuario.'});
      }
      const raw=await investigar(d.a,campos,traza);
      traza('RESPUESTA_SERVICIO',{
        busqueda_web_verificada:raw?.busqueda_realizada===true,
        referencias_entregadas:Array.isArray(raw?.referencias)?raw.referencias.length:0,
        consultas:Array.isArray(raw?.consultas)?raw.consultas:[],
      });
      // El orquestador ya valido Google y crawler por separado. Conservar el origen
      // de cada campo y no volver a etiquetar referencias mixtas como un solo proveedor.
      // FVE_REPORTE_VISIBLE_CRAWLER_V1: incluir reporte de investigacion, incluso si no se guardan valores.
      const reporte_busqueda=raw?.reporte_busqueda && typeof raw.reporte_busqueda==='object'
        ? raw.reporte_busqueda : null;
      traza('REPORTE_PREPARADO_FRONTEND',{documentos:reporte_busqueda?.documentos?.length||0,
        rechazadas:reporte_busqueda?.rechazos?.length||0,guardado_pendiente:true});
      const candidatos=raw?.validacion_orquestador===1 && raw?.busqueda_realizada===true
        && raw?.candidatos_validados && typeof raw.candidatos_validados==='object'
        && !Array.isArray(raw.candidatos_validados)
        ? raw.candidatos_validados
        : raw.busqueda_realizada===true
          ? limpiarIA(raw,campos,require('../services/fveClasificacionActivo').camposExistentes(d.evaluacion.codigo_taxonomia),traza) : {};
      traza('METRICAS_CONSOLIDADAS',{campos:Object.keys(candidatos),
        pendientes:campos.filter(c=>!Object.hasOwn(candidatos,c)),
        origen_por_campo:Object.fromEntries(Object.entries(candidatos).map(([codigo,v])=>[codigo,v.origen]))});
      if(!Object.keys(candidatos).length) {
        const razon=(typeof raw?.motivo==='string' && raw.motivo.trim()) ? raw.motivo :
          raw.busqueda_realizada!==true?'NO_SE_DETECTO_GOOGLE_SEARCH_CALL':
          !Array.isArray(raw.referencias)||!raw.referencias.length?'GOOGLE_SEARCH_SIN_REFERENCIAS':'REFERENCIAS_RECHAZADAS_EN_VALIDACION';
        traza('FIN_SIN_GUARDAR',{
          razon,
          referencias_devueltas:Array.isArray(raw?.referencias)?raw.referencias.length:0,
          accion:'NO_SE_ESCRIBE_EN_BASE_DE_DATOS',
        });
        return res.json({guardado:false,estimaciones:{campos:{}},reporte_busqueda,
          faltantes:d.evaluacion.faltantes,
          advertencia:'La busqueda no encontro fuentes suficientes para calcular referencias confiables. No se inventaron datos.'});
      }
      traza('INICIO_GUARDADO',{campos_a_guardar:Object.keys(candidatos),tipo:'solo_estimaciones_no_verificadas'});
      const cliente=await db.connect();
      try {
        await cliente.query('BEGIN');
        const now=await cliente.query(`SELECT id_mipyme,datos,estado FROM public.activo WHERE id_activo=$1 FOR UPDATE`,[id]);
        if(!now.rowCount || now.rows[0].id_mipyme!==d.a.id_mipyme || now.rows[0].estado==='eliminado') {
          await cliente.query('ROLLBACK');
          traza('GUARDADO_CANCELADO',{motivo:'ACTIVO_MODIFICADO_DURANTE_BUSQUEDA'});
          return res.status(409).json({error:'El activo cambio durante la busqueda. Actualiza la pantalla.'});
        }
        // Nunca pisar otras propiedades de datos, referencias previas ni ficha validada.
        const previous=objeto(now.rows[0].datos);
        const anteriores=objeto(previous.fve_estimaciones_ia);
        const nuevo={...anteriores,version:1,
          actualizado_en:new Date().toISOString(),
          busqueda_web_confirmada:true,
          consultas:Array.isArray(raw.consultas)?raw.consultas:[],
          campos:{...objeto(anteriores.campos),...candidatos}};
        await cliente.query(`UPDATE public.activo SET datos=$1,updated_at=now(),updated_by=$2 WHERE id_activo=$3`,
          [JSON.stringify({...previous,fve_estimaciones_ia:nuevo}),usuario,id]);
        await cliente.query('COMMIT');
        traza('FIN_GUARDADO',{resultado:'OK',campos_guardados:Object.keys(candidatos),
          advertencia:'Los valores no son mediciones verificadas'});
        return res.json({guardado:true,estimaciones:nuevo, reporte_busqueda, faltantes:d.evaluacion.faltantes,
          advertencia:'Estimaciones de IA sin verificar. No reemplazan mediciones ni habilitan elegibilidad.'});
      } catch(e){try{await cliente.query('ROLLBACK');}catch(_){}throw e;}
      finally{cliente.release();}
    } catch(e){
      traza('ERROR_PROCESO',{
        nombre:e?.name||'Error',codigo:e?.code||null,
        razon:e?.message||'Error desconocido',
        accion:'REVISAR_LOGS_ANTERIORES_CON_EL_MISMO_ID',
      });
      console.error('[FVE ESTIMACIONES] Investigacion:',e);
      return res.status(e?.code==='GEMINI_KEY_MISSING'?422:500).json({error:textoSeguro(e)});
    }
  }
  return {estado,investigarActivo};
}
const handlers=createHandlers();
module.exports={ ...handlers,createHandlers };
