'use strict';
// FVE_REFERENCIA_CONSUMO_IA_V1: extraer referencias citadas, no calcular ahorros.
const {obtenerReferenciaIA}=require('./diagnosticoReferenciaConsumoIA');
// FVE: enlazar referencias de IA a productos reales sin atribuirle una eleccion comercial.
// Unicamente coincidencias deterministicas y univocas; nunca es elegibilidad.
const normalizar = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = v => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const valorId = v => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const canonUrl = v => {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    u.searchParams.sort();
    return u.toString();
  } catch (_) {return null;}
};
const mismoPrecio = (a,b) => {
  const x=num(a),y=num(b);
  return x != null && y != null && x >= 0 && Math.abs(x-y)<0.01;
};
const modelos = texto => new Set((normalizar(texto).match(/\b(?=[a-z0-9-]{6,}\b)(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]+\b/g)||[])
  .filter(token=>token.length>=7));
// El modelo solo se puede recuperar de descripcion de beneficios, NUNCA del problema
// (el problema suele nombrar el equipo actual, no la alternativa).
function resolverSugerencia({diagnostico, idActivo, alternativas}) {
  const activos=Array.isArray(diagnostico?.metricas?.activos)?diagnostico.metricas.activos:[];
  const activo=activos.find(a=>valorId(a?.id_activo)===valorId(idActivo));
  if(!activo || !Array.isArray(alternativas) || !alternativas.length) return null;
  const posibles = alternativas.filter(p=>valorId(p?.id_item));
  const evidencia=Array.isArray(diagnostico?.metricas?.evidencia_catalogo)
    ? diagnostico.metricas.evidencia_catalogo : [];
  const nombreActivo=normalizar(activo?.nombre_activo);
  const candidatas=evidencia.filter(e=>e && typeof e==='object'
    && normalizar(e.activo_relacionado)===nombreActivo);
  let hallazgo=null, origen='';
  for(const e of candidatas) {
    const url=canonUrl(e.url);
    let coincidencias=url ? posibles.filter(p=>canonUrl(p.url_origen)===url) : [];
    if(coincidencias.length!==1) {
      const nom=normalizar(e.producto);
      coincidencias=nom ? posibles.filter(p=>normalizar(p.nombre)===nom) : [];
    }
    if(coincidencias.length!==1) continue;
    const elegido=coincidencias[0];
    const proveedor=valorId(e.proveedor);
    if(proveedor && proveedor!==valorId(elegido.id_proveedor)) continue;
    if(hallazgo && valorId(hallazgo.id_item)!==valorId(elegido.id_item)) return null;
    hallazgo=elegido;
    origen='evidencia_catalogo';
  }
  if(!hallazgo) {
    // Diagnosticos anteriores: evidencia_catalogo nunca se persistio. Recuperacion
    // segura SOLO con modelo singular en beneficios + precio exacto + catalogo activo.
    const detalle=String(diagnostico?.beneficios?.detalle||'');
    const tokens=modelos(detalle);
    const inversion=num(activo?.metricas?.inversion_total_requerida);
    if(!tokens.size || inversion == null || inversion <= 0) return null;
    const encontrados=posibles.filter(p=>[...tokens].some(t=>modelos(p.nombre).has(t)));
    const mismoValor=encontrados.filter(p=>mismoPrecio(p.precio_base,inversion));
    // Si varios productos comparten modelo, el precio permite desambiguar.
    // Si el modelo es unico pero su precio cambio, el mismo equipo sigue
    // siendo identificable: siempre se mostrara el precio VIGENTE del catalogo.
    if(mismoValor.length===1) hallazgo=mismoValor[0];
    else if(encontrados.length===1) hallazgo=encontrados[0];
    else return null;
    origen=mismoPrecio(hallazgo.precio_base,inversion)
      ? 'referencia_y_precio_historico' : 'modelo_unico_precio_actualizado';
  }
  return {
    id_item:valorId(hallazgo.id_item),
    nombre:hallazgo.nombre,
    precio_base:hallazgo.precio_base,
    precio_diagnostico:num(activo?.metricas?.inversion_total_requerida),
    origen,
    consumo_energia_proyectado_mes:num(activo?.metricas?.consumo_energia_proyectado_mes),
    consumo_agua_proyectado_mes:num(activo?.metricas?.consumo_agua_proyectado_mes),
    consumo_referencia_ia: num(activo?.metricas?.consumo_energia_proyectado_mes) === null
      ? obtenerReferenciaIA({diagnostico,activo,hallazgo,candidatas}) : null,
    confianza:activo?.confianza?.nivel ?? null,
    requiere_confirmacion:true,
    elegibilidad_verde:'no_evaluada'
  };
}
module.exports={resolverSugerencia,canonUrl,modelos};
