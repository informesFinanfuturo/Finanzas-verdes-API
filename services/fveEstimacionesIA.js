'use strict';

// Separacion estricta: mediciones/placas verificadas versus estimaciones de referencia.
const { clasificarActivo, camposExistentes, validarDatosExistentes } = require('./fveClasificacionActivo');

const ESTIMABLES = Object.freeze({
  consumo_actual_kwh_mes: { unidad:'kWh/mes', max:30000 },
  consumo_actual_kwh_ciclo: { unidad:'kWh/ciclo', max:1000 },
  potencia_anterior_w: { unidad:'W', max:1000000 },
  caudal_anterior_l_min: { unidad:'L/min', max:1000 },
  descarga_anterior_l: { unidad:'L/descarga', max:1000 },
  capacidad_actual_l: { unidad:'L', max:100000 },
});
const ALIAS = Object.freeze({
  consumo_actual_kwh_mes:'consumo_energia_actual_mes',
  consumo_actual_kwh_ciclo:'consumo_energia_actual_ciclo',
  potencia_anterior_w:'potencia_actual_w',
  caudal_anterior_l_min:'caudal_actual_l_min',
  descarga_anterior_l:'descarga_actual_l',
});
const objeto = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const numero = x => (typeof x === 'number' || typeof x === 'string' && x.trim() !== '') &&
  Number.isFinite(Number(x)) ? Number(x) : null;
function pendientesActivo(activo, caracterizacion) {
  const codigo = clasificarActivo(activo.tipo, activo.nombre);
  const campos = camposExistentes(codigo);
  const datos = objeto(caracterizacion?.datos_tecnicos);
  const faltantes = campos.filter(c => datos[c.codigo] === null || datos[c.codigo] === undefined || datos[c.codigo] === '')
    .map(c => ({ codigo:c.codigo, etiqueta:c.etiqueta, estimable:Boolean(ESTIMABLES[c.codigo]), requerido:Boolean(c.requerido) }));
  return { codigo_taxonomia:codigo, faltantes,
    campos_busqueda: faltantes.filter(c => c.estimable).map(c => c.codigo),
    datos_verificados:datos };
}
function dominio(url) { try { const u=new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./,'') : null; } catch (_) { return null; } }
const trazarValidacion = (trace, evento, datos) => {
  try { if (typeof trace === 'function') trace(evento, datos); } catch (_) {}
};
function limpiarIA(raw, solicitados, campos, trace) {
  const sugerencias = {};
  const permitidos = new Set(solicitados);
  const lista = Array.isArray(raw?.referencias) ? raw.referencias.slice(0,20) : [];
  trazarValidacion(trace,'INICIO_VALIDACION',{
    referencias_recibidas:Array.isArray(raw?.referencias)?raw.referencias.length:0,
    cantidad_a_revisar:lista.length,
    campos_permitidos:[...permitidos],
    campos_taxonomia:campos.map(c=>c.codigo),
  });
  for (const [indice, item] of lista.entries()) {
    const codigo = String(item?.codigo||'');
    const regla = ESTIMABLES[codigo];
    const resumen = {indice:indice+1,codigo,valor:item?.valor??null,
      unidad:item?.unidad??null,coincidencia:item?.coincidencia??null};
    const descartar = (motivo, detalle = {}) => trazarValidacion(trace,'REFERENCIA_DESCARTADA',{
      ...resumen,motivo,...detalle,
    });
    if (!regla) { descartar('CODIGO_NO_ESTIMABLE');continue; }
    if (!permitidos.has(codigo)) { descartar('CODIGO_NO_SOLICITADO');continue; }
    if (Object.hasOwn(sugerencias,codigo)) { descartar('CAMPO_YA_TIENE_REFERENCIA_ACEPTADA');continue; }
    const valor = numero(item.valor);
    if (valor === null || valor <= 0 || valor > regla.max) {
      descartar('VALOR_NO_NUMERICO_FUERA_DE_RANGO', {rango_maximo:regla.max});continue;
    }
    if (item.unidad !== regla.unidad) {
      descartar('UNIDAD_NO_COINCIDE', {unidad_esperada:regla.unidad});continue;
    }
    const validado = validarDatosExistentes({ [codigo]:valor }, campos.filter(c=>c.codigo===codigo));
    if (validado.error) { descartar('VALIDACION_TAXONOMICA', {detalle:validado.error});continue; }
    const coincidencia = String(item.coincidencia||'');
    if (!['modelo_exacto','modelo_equivalente','categoria'].includes(coincidencia)) {
      descartar('TIPO_COINCIDENCIA_DESCONOCIDO');continue;
    }
    const fuentesOriginales=Array.isArray(item.fuentes)?item.fuentes:[];
    const fuentes = fuentesOriginales
      .filter(f => dominio(f?.url) && typeof f?.dato_observado === 'string' && f.dato_observado.trim())
      .slice(0,5).map(f=>({url:f.url, titulo:String(f.titulo||'').slice(0,150),
         dato_observado:String(f.dato_observado).slice(0,240)}));
    const dominios=[...new Set(fuentes.map(f=>dominio(f.url)))];
    const minimo=coincidencia==='modelo_exacto'?1:2;
    if (dominios.length < minimo) {
      descartar('FUENTES_INSUFICIENTES',{
        minimo_dominios_independientes:minimo,dominios_aceptados:dominios,
        fuentes_recibidas:fuentesOriginales.length,
        fuentes_validas:fuentes.length,
        detalles_fuentes:fuentes.map(f=>({url:f.url,dato_observado:f.dato_observado})),
      });continue;
    }
    const metodo = String(item.metodo||'').trim();
    if (metodo.length < 15 || metodo.length > 1200) {
      descartar('METODO_AUSENTE_O_LONGITUD_INVALIDA',{caracteres:metodo.length});continue;
    }
    sugerencias[codigo] = {valor,unidad:regla.unidad,coincidencia,
       metodo,fuentes,estado:'estimado_no_verificado',origen:raw?.proveedor==='crawler_interno'?'crawler_tecnico_interno_ia':raw?.proveedor==='tavily'?'busqueda_web_tavily_ia':'busqueda_ia_google',
       advertencia:'Estimacion de IA basada en referencias externas, NO medicion del equipo.'};
    trazarValidacion(trace,'REFERENCIA_ACEPTADA',{
      ...resumen,dominios_validos:dominios,
      fuentes:fuentes.map(f=>({url:f.url,dato_observado:f.dato_observado})),
      metodologia:metodo,
    });
  }
  trazarValidacion(trace,'FIN_VALIDACION',{
    referencias_aceptadas:Object.keys(sugerencias).length,
    codigos_aceptados:Object.keys(sugerencias),
    decision:Object.keys(sugerencias).length?'CANDIDATOS_VALIDOS':'SIN_VALORES_VALIDOS',
  });
  return sugerencias;
}
function escenarioEstimado(activoDiag, estimaciones, tarifa) {
  if (numero(activoDiag?.metricas?.consumo_energia_actual_mes) !== null) return null;
  const campos = objeto(estimaciones?.campos);
  const base = campos.consumo_actual_kwh_mes;
  if (!base || base.estado !== 'estimado_no_verificado') return null;
  const antes = numero(base.valor);
  if (antes === null || antes<=0) return null;
  const proyectado = numero(activoDiag?.metricas?.consumo_energia_proyectado_mes);
  const tasa = numero(tarifa);
  const delta = proyectado === null ? null : antes - proyectado;
  const inversion = numero(activoDiag?.metricas?.inversion_total_requerida);
  const ahorroCOP = delta !== null && tasa !== null && tasa>0 ? delta*tasa : null;
  const roiHipotetico = ahorroCOP !== null && inversion !== null && inversion>0 ?
    ((ahorroCOP * 60 - inversion) / inversion) * 100 : null;
  return { estado:'ESCENARIO_HIPOTETICO_IA', consumo_actual_estimado_kwh_mes:antes,
    consumo_nuevo_proyectado_kwh_mes:proyectado,
    ahorro_estimado_kwh_mes:delta,
    ahorro_estimado_cop_mes:ahorroCOP,
    roi_estimado_cinco_anios_pct:roiHipotetico,
    recuperacion_estimado_meses:ahorroCOP !== null && ahorroCOP>0 && inversion!==null && inversion>0 ? inversion/ahorroCOP : null,
    fuente_base:'Referencia de IA, no medicion de equipo',
    fecha_referencia: estimaciones.actualizado_en || null,
    metodo:base.metodo, coincidencia:base.coincidencia, fuentes:base.fuentes,
    advertencia:'Proyeccion orientativa de IA, no ahorro demostrado. No habilita elegibilidad verde ni aprobacion de credito.'};
}
module.exports={ ESTIMABLES, ALIAS, pendientesActivo, limpiarIA, escenarioEstimado };
