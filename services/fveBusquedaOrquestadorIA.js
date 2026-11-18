'use strict';

// The existing Gemini and crawler prompts are not changed by this orchestrator.
// A verified web search is not the same as a usable technical measurement.
const { buscarReferencias: google } = require('./fveBusquedaGeminiGoogleIA');
const { buscarDocumentos } = require('./fveCrawlerTecnico');
const { analizarDocumentos } = require('./fveCrawlerAnalisisIA');
const { limpiarIA } = require('./fveEstimacionesIA');
const { clasificarActivo, camposExistentes } = require('./fveClasificacionActivo');

const tr = (trace, etapa, datos = {}) => {
  try { if (typeof trace === 'function') trace(etapa, datos); } catch (_) {}
};
const codigoError = e => String(e?.code || 'ERROR_DESCONOCIDO').slice(0, 80);
const lista = value => Array.isArray(value) ? value : [];
const deduplicar = values => [...new Set(values.filter(x => typeof x === 'string' && x.trim()))].slice(0, 30);
// FVE_REPORTE_VISIBLE_CRAWLER_V1: informar fichas encontradas sin convertirlas en mediciones del activo.
const { numerosConUnidad } = require('./fveCrawlerEvidenciaIA');
function resumenDocumentosParaFrontend(web){
  const documentos=Array.isArray(web?.documentos)?web.documentos.slice(0,6):[];
  return documentos.map(d=>{
    const titulo=String(d?.titulo||'').slice(0,170);
    const consumo=numerosConUnidad('consumo_actual_kwh_mes',d?.texto).filter(x=>x>0&&x<30000).slice(0,5);
    const capacidades=numerosConUnidad('capacidad_actual_l',d?.texto).filter(x=>x>0&&x<100000).slice(0,5);
    const enTitulo=/\b(\d{2,5})\s*(?:litros?\b|l\b)/i.exec(titulo);
    return {
      url:String(d?.url||'').slice(0,500),titulo,
      fuente_id:String(d?.fuente_id||'').slice(0,80),
      consumos_detectados_kwh_mes:consumo,
      capacidad_titulo_l:enTitulo?Number(enTitulo[1]):null,
      capacidades_mencionadas_l:capacidades,
      estado:'FICHA_ENCONTRADA_NO_VERIFICA_ACTIVO',
    };
  });
}


function validar(raw, campos, taxonomia, trace, prefijo) {
  if (!raw || raw.busqueda_realizada !== true) return {};
  return limpiarIA(raw, campos, taxonomia, (etapa, datos) => {
    tr(trace, `${prefijo}_${etapa}`, datos);
  });
}

async function buscarReferencias(activo, campos, trace, opciones = {}) {
  const solicitados = deduplicar(lista(campos));
  const codigoTaxonomia = clasificarActivo(activo?.tipo, activo?.nombre);
  const taxonomia = camposExistentes(codigoTaxonomia);
  const obligatorios = new Set(taxonomia.filter(c => c.requerido).map(c => c.codigo));
  const crawlerHabilitado = process.env.FVE_CRAWLER_FALLBACK !== '0';
  tr(trace, 'ORQUESTADOR_INICIO', {
    orden: ['GEMINI_GOOGLE_SEARCH', 'VALIDAR_METRICAS_GOOGLE', 'CRAWLER_PARA_CAMPOS_PENDIENTES', 'VALIDAR_METRICAS_CRAWLER'],
    crawler_habilitado: crawlerHabilitado, campos_solicitados: solicitados,
    campos_obligatorios: solicitados.filter(c => obligatorios.has(c)),
  });

  // FVE_REPORTE_VISIBLE_CRAWLER_V1: los rechazos del analizador se muestran tambien al asesor.
  const rechazosReporte=[];
  const ajustesReporte=[]; // FVE_CRAWLER_ESTABILIDAD_V2
  const trazaConRechazos=(etapa,datos={})=>{
    if(etapa==='WEB_COINCIDENCIA_AJUSTADA' && ajustesReporte.length<12){
      ajustesReporte.push({codigo:String(datos.codigo||'').slice(0,70),
        de:String(datos.de||'').slice(0,45),a:String(datos.a||'').slice(0,45),
        motivo:String(datos.motivo||'').slice(0,100)});
    }
    if(etapa==='WEB_REFERENCIA_RECHAZADA' && rechazosReporte.length<12){
      rechazosReporte.push({codigo:String(datos.codigo||'').slice(0,70),
        motivo:String(datos.motivo||'').slice(0,100),
        dominios_validos:Number(datos.dominios_validos)||0,
        dominios_necesarios:Number(datos.dominios_necesarios)||0});
    }
    tr(trace,etapa,datos);
  };

  let primario;
  try {
    primario = await (opciones.google || google)(activo, solicitados, trace);
  } catch (e) {
    tr(trace, 'ORQUESTADOR_GOOGLE_ERROR', { codigo: codigoError(e), mensaje: String(e?.message || '').slice(0, 160) });
    if (e?.code === 'GEMINI_KEY_MISSING') throw e;
    primario = { referencias: [], busqueda_realizada: false, consultas: [], motivo: codigoError(e) };
  }
  const googleVerificado = primario?.busqueda_realizada === true;
  tr(trace, 'ORQUESTADOR_GOOGLE_FIN', {
    busqueda_verificada: googleVerificado,
    referencias: lista(primario?.referencias).length,
    motivo: primario?.motivo || 'OK',
  });

  const valoresGoogle = validar(primario, solicitados, taxonomia, trace, 'GOOGLE');
  const pendientes = solicitados.filter(c => !Object.hasOwn(valoresGoogle, c));
  tr(trace, 'GOOGLE_METRICAS_EVALUADAS', {
    busqueda_verificada: googleVerificado,
    referencias_recibidas: lista(primario?.referencias).length,
    referencias_validas: Object.keys(valoresGoogle).length,
    campos_validos: Object.keys(valoresGoogle),
    campos_pendientes: pendientes,
    campos_obligatorios_pendientes: pendientes.filter(c => obligatorios.has(c)),
    decision: pendientes.length ? 'NECESITA_RESPALDO' : 'METRICAS_RESUELTAS',
  });

  let web;
  let resultadoCrawler = null;
  let valoresCrawler = {};
  let crawlerEjecutado = false;
  let falloCrawler = null;
  const consultas = deduplicar(lista(primario?.consultas));

  if (!pendientes.length) {
    tr(trace, 'CRAWLER_OMITIDO', { motivo: 'TODOS_LOS_CAMPOS_TIENE_METRICAS_VALIDAS' });
  } else if (!crawlerHabilitado) {
    tr(trace, 'CRAWLER_OMITIDO', {
      motivo: 'DESHABILITADO_POR_VARIABLE_ENTORNO', campos_sin_resolver: pendientes,
    });
  } else {
    crawlerEjecutado = true;
    const motivo = !googleVerificado ? 'GOOGLE_SIN_BUSQUEDA_VERIFICABLE'
      : Object.keys(valoresGoogle).length === 0 ? 'GOOGLE_SIN_METRICAS_VALIDAS'
      : 'GOOGLE_METRICAS_PARCIALES';
    const inicio = Date.now();
    tr(trace, 'CRAWLER_ACTIVADO', {
      motivo, campos_para_crawler: pendientes,
      campos_google_conservados: Object.keys(valoresGoogle),
      sin_api_key_externa: true, lista_blanca: true,
    });
    try {
      web = await (opciones.crawler || buscarDocumentos)(activo, pendientes, trace, opciones.web || {});
      consultas.push(...lista(web?.consultas));
      tr(trace, 'CRAWLER_DOCUMENTOS_RECIBIDOS', {
        documentos: lista(web?.documentos).length,
        campos_solicitados: pendientes, motivo: web?.motivo || 'OK',
      });
      if (lista(web?.documentos).length) {
        resultadoCrawler = await (opciones.analizarDocumentos || analizarDocumentos)(
          activo, pendientes, web, trazaConRechazos, opciones.ia || {},
        );
        valoresCrawler = validar(resultadoCrawler, pendientes, taxonomia, trace, 'CRAWLER');
      } else {
        falloCrawler = web?.motivo || 'CRAWLER_SIN_DOCUMENTOS';
      }
    } catch (e) {
      if (e?.code === 'GEMINI_KEY_MISSING' && !Object.keys(valoresGoogle).length) throw e;
      falloCrawler = codigoError(e);
      tr(trace, 'CRAWLER_ERROR', {
        codigo: falloCrawler, mensaje: String(e?.message || '').slice(0, 160),
        accion: Object.keys(valoresGoogle).length ? 'CONSERVAR_METRICAS_GOOGLE' : 'NO_GUARDAR',
      });
    }
    tr(trace, 'CRAWLER_RESPALDO_FIN', {
      duracion_ms: Date.now() - inicio,
      documentos: lista(web?.documentos).length,
      referencias_recibidas: lista(resultadoCrawler?.referencias).length,
      referencias_validas: Object.keys(valoresCrawler).length,
      codigos_validos: Object.keys(valoresCrawler),
      fallo: falloCrawler || resultadoCrawler?.detalle_fallo?.codigo || null,
      motivo: resultadoCrawler?.motivo || web?.motivo || falloCrawler || 'OK',
    });
  }

  // Only already validated values are merged; crawler can never overwrite Google.
  const candidatos = { ...valoresGoogle };
  for (const [codigo, valor] of Object.entries(valoresCrawler)) {
    if (!Object.hasOwn(candidatos, codigo)) candidatos[codigo] = valor;
  }
  const sinResolver = solicitados.filter(c => !Object.hasOwn(candidatos, c));
  const verificado = googleVerificado || resultadoCrawler?.busqueda_realizada === true;
  const motivo = !sinResolver.length ? 'OK'
    : Object.keys(candidatos).length ? 'METRICAS_PARCIALES'
    : falloCrawler || resultadoCrawler?.motivo || primario?.motivo || 'SIN_METRICAS_VALIDAS_TRAS_BUSQUEDA';

  tr(trace, 'ORQUESTADOR_FIN', {
    busqueda_google_verificada: googleVerificado,
    crawler_ejecutado: crawlerEjecutado,
    busqueda_crawler_verificada: resultadoCrawler?.busqueda_realizada === true,
    campos_google_validos: Object.keys(valoresGoogle),
    campos_crawler_validos: Object.keys(valoresCrawler),
    campos_consolidados: Object.keys(candidatos),
    campos_pendientes: sinResolver,
    campos_obligatorios_pendientes: sinResolver.filter(c => obligatorios.has(c)),
    resultado: !sinResolver.length ? 'COMPLETO' : Object.keys(candidatos).length ? 'PARCIAL' : 'SIN_VALORES_VALIDOS',
    motivo,
  });

  const docsReporte=resumenDocumentosParaFrontend(web);
  const reporte_busqueda={
    google_busqueda_verificada:googleVerificado,
    crawler_ejecutado:crawlerEjecutado,
    paginas_visitadas:Number(web?.estadisticas?.urls_visitadas)||0,
    paginas_leidas:Number(web?.estadisticas?.urls_exitosas)||0,
    errores_lectura:Number(web?.estadisticas?.errores)||0,
    documentos:docsReporte,
    rechazos:rechazosReporte,
    ajustes_clasificacion:ajustesReporte,
    error_analisis:resultadoCrawler?.detalle_fallo||null,
    motivo_resultado:motivo, // FVE_CRAWLER_ESTABILIDAD_V2
    campos_con_estimacion_aceptada:Object.keys(candidatos),
    campos_pendientes:sinResolver,
    resultado:!sinResolver.length?'COMPLETO':Object.keys(candidatos).length?'PARCIAL':'SIN_ESTIMACIONES_APROBADAS',
    advertencia:'Fichas de otros modelos; NO representan mediciones ni consumos demostrados del equipo del cliente.'
  };
  tr(trace,'REPORTE_CONSTRUIDO_FRONTEND',{
    documentos:docsReporte.length, paginas_leidas:reporte_busqueda.paginas_leidas,
    estimaciones_aceptadas:reporte_busqueda.campos_con_estimacion_aceptada,
    rechazos:rechazosReporte.map(x=>({codigo:x.codigo,motivo:x.motivo}))
  });

  return {
    reporte_busqueda,
    // The controller can use these already validated candidates directly.
    validacion_orquestador: 1,
    candidatos_validados: candidatos,
    referencias: Object.entries(candidatos).map(([codigo, valor]) => ({ codigo, ...valor })),
    busqueda_realizada: verificado,
    consultas: deduplicar(consultas),
    motivo,
  };
}

module.exports = { buscarReferencias };
