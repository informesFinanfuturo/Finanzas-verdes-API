'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const CONFIG = path.resolve(__dirname, '../config/fuentes_tecnicas.json');
const limitesHard = Object.freeze({
  max_fuentes_por_busqueda: 8,
  max_paginas_totales: 60,
  max_paginas_por_fuente: 24,
  max_profundidad: 3,
  max_documentos_para_ia: 8,
  timeout_por_pagina_ms: 12000,
  timeout_total_ms: 60000,
  max_html_bytes: 1500000,
  max_sitemap_urls: 700,
});
const limitesDefault = Object.freeze({
  max_fuentes_por_busqueda: 4, max_paginas_totales: 24,
  max_paginas_por_fuente: 12, max_profundidad: 2,
  max_documentos_para_ia: 6, timeout_por_pagina_ms: 7000,
  timeout_total_ms: 35000, max_html_bytes: 1000000,
  max_sitemap_urls: 350,
});
const norm = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function urlSegura(raw, fuente) {
  try {
    const u = new URL(String(raw || ''));
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' ||
        !host.includes('.') || net.isIP(host) || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (!fuente || !Array.isArray(fuente.dominios) || !fuente.dominios.some(d => norm(d) === host)) return null;
    const ruta = decodeURIComponent(u.pathname).toLowerCase();
    if (fuente.rutas_bloqueadas?.some(v => ruta.startsWith(String(v).toLowerCase()))) return null;
    u.hash = '';
    return u.toString();
  } catch (_) { return null; }
}
function rutaPermitida(url, fuente) {
  const segura = urlSegura(url, fuente);
  if (!segura) return false;
  if (!Array.isArray(fuente.rutas_permitidas) || !fuente.rutas_permitidas.length) return false;
  const pathname = decodeURIComponent(new URL(segura).pathname).toLowerCase();
  return fuente.rutas_permitidas.some(p => pathname.startsWith(String(p).toLowerCase()));
}
function validarFuente(s) {
  if (!s || !/^[a-z0-9_\-]{3,80}$/i.test(s.id || '') || !Array.isArray(s.dominios) ||
      !s.dominios.length || !Array.isArray(s.paginas_iniciales) ||
      !Array.isArray(s.rutas_permitidas) || !s.rutas_permitidas.length) return false;
  if (s.dominios.length > 8 || s.paginas_iniciales.length > 30) return false;
  return s.dominios.every(host => {
    const h = String(host).toLowerCase();
    return h.includes('.') && !net.isIP(h) && /^[a-z0-9.-]+$/.test(h) &&
      !/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(h);
  }) && s.paginas_iniciales.every(u => urlSegura(u, s) && rutaPermitida(u, s));
}
function leerFuentes(ruta = CONFIG) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(ruta, 'utf8')); }
  catch (e) { const err = new Error('No se pudo leer fuentes_tecnicas.json: ' + e.message); err.code='CRAWLER_CONFIG_INVALIDA'; throw err; }
  if (!obj || !Array.isArray(obj.fuentes) || obj.fuentes.length > 50) {
    const e = new Error('Catalogo de fuentes invalido o demasiado grande'); e.code = 'CRAWLER_CONFIG_INVALIDA'; throw e;
  }
  for (const f of obj.fuentes) if (!validarFuente(f)) {
    const e = new Error('Fuente mal configurada: ' + String(f?.id||'sin_id')); e.code='CRAWLER_FUENTE_INVALIDA'; throw e;
  }
  const limites={};
  for (const [k,maximo] of Object.entries(limitesHard)) {
    const n = Number(obj.limites?.[k]);
    limites[k] = Number.isSafeInteger(n) && n >= 1 ? Math.min(n,maximo) : limitesDefault[k];
  }
  return {fuentes:obj.fuentes,limites,ruta};
}
function seleccionarFuentes(catalogo, activo, codigo) {
  const marca=norm(activo?.marca);
  const clase=norm(codigo || '');
  return catalogo.fuentes.filter(f => f.habilitada===true &&
     (f.categorias||[]).some(c => norm(c)===clase) &&
     (!Array.isArray(f.marcas) || f.marcas.length===0 || f.marcas.some(m=>norm(m)===marca)))
    .slice(0,catalogo.limites.max_fuentes_por_busqueda);
}
module.exports={CONFIG,leerFuentes,seleccionarFuentes,urlSegura,rutaPermitida,norm,limitesHard};
