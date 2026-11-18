'use strict';
// FVE_REFERENCIA_CONSUMO_IA_V1: dato textual trazable; NO es una medicion,
// ahorro, consumo validado, ni proyeccion estructurada del diagnostico.
const normalizar = v => String(v ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const numero = v => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
};
const canonUrl = v => {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    u.searchParams.sort();
    return u.toString();
  } catch (_) { return null; }
};
function consumosExplicitos(texto) {
  const s = normalizar(texto);
  // Exige la palabra consumo y unidades mensuales en la misma expresion.
  // No convierte importes, potencia W, consumo anual ni facturas globales.
  const re = /\bconsumo\s+(?:(?:mensual|energetico|electrico|nominal|catalogado|minimo|indicado|reportado|certificado|de|del|fabricante)\s*){0,7}[:=]?\s*(\d+(?:[.,]\d+)?)\s*kwh\s*(?:\/|por)\s*mes\b/gi;
  const valores=[]; let match;
  while ((match=re.exec(s))!==null) {
    const n=numero(match[1]);
    if (n !== null) valores.push(n);
  }
  return valores;
}
function unico(valores) {
  const nums=valores.filter(v=>v!==null && Number.isFinite(v));
  if (!nums.length) return null;
  const primero=nums[0];
  return nums.every(v=>Math.abs(v-primero)<0.00001) ? primero : null;
}
function coincideProducto(e, p) {
  const urlE=canonUrl(e?.url), urlP=canonUrl(p?.url_origen);
  if(urlE && urlP && urlE===urlP) return true;
  const nombreE=normalizar(e?.producto), nombreP=normalizar(p?.nombre);
  return Boolean(nombreE && nombreP && nombreE===nombreP);
}
function datosDeEspecificaciones(espec) {
  if(!espec || typeof espec!=='object' || Array.isArray(espec)) return [];
  return Object.entries(espec).flatMap(([k,v]) => consumosExplicitos(`${k}: ${String(v ?? '')}`));
}
function obtenerReferenciaIA({diagnostico, activo, hallazgo, candidatas}) {
  if(!hallazgo || !activo) return null;
  // 1) Metadatos de la ficha comercial (aun sin validacion independiente).
  const ficha=datosDeEspecificaciones(hallazgo.especificaciones);
  if(ficha.length) {
    const valor=unico(ficha);
    return valor===null ? null : {valor,unidad:'kWh/mes',fuente:'ficha_catalogo',verificado:false};
  }
  // 2) Referencia incluida en la evidencia textual del diagnostico IA.
  const relacionadas=(Array.isArray(candidatas)?candidatas:[])
    .filter(e=>coincideProducto(e,hallazgo));
  const evidencia=relacionadas.flatMap(e=>[
    ...(Array.isArray(e.atributos_comparados)?e.atributos_comparados:[]),
    e.observacion ?? ''
  ]).flatMap(consumosExplicitos);
  if(evidencia.length) {
    const valor=unico(evidencia);
    return valor===null ? null : {valor,unidad:'kWh/mes',fuente:'evidencia_catalogo_ia',verificado:false};
  }
  // 3) Diagnostico antiguo o evidencia sin consumo: detalle narrativo.
  // Solo se usa porque el enlace de producto ya fue verificado como UNICO
  // por resolverSugerencia. Nunca se guarda como metrica tecnica.
  const detalle=String(diagnostico?.beneficios?.detalle ?? '');
  const modelos=normalizar(hallazgo.nombre).match(/\b(?=[a-z0-9]{7,}\b)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]+\b/g) ?? [];
  if(!modelos.some(m=>normalizar(detalle).includes(m))) return null;
  const valor=unico(consumosExplicitos(detalle));
  return valor===null ? null : {valor,unidad:'kWh/mes',fuente:'narrativa_ia',verificado:false};
}
module.exports={obtenerReferenciaIA,consumosExplicitos,unico,coincideProducto};
