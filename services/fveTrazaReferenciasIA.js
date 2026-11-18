'use strict';

// Trazabilidad bajo demanda: no registra claves, autorizaciones ni datos completos del cliente.
const crypto = require('node:crypto');
const MAX_TEXTO = 1700;
const MAX_ARRAY = 20;
const MAX_PROFUNDIDAD = 5;

function redactar(texto) {
  return String(texto ?? '')
    .replace(/(AIza[0-9A-Za-z_-]{20,})/g, '[CLAVE_IA_OCULTA]')
    .replace(/(Bearer\s+)[\w.~-]+/gi, '$1[OCULTO]')
    .replace(/([\w.+-]+)@([\w.-]+\.[A-Za-z]{2,})/g, '[CORREO_OCULTO]')
    .replace(/\b(?:\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[TELEFONO_OCULTO]')
    .replace(/(api[_ -]?key|authorization|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[OCULTO]')
    .slice(0, MAX_TEXTO);
}
function sanitizar(valor, profundidad = 0, clave = '') {
  if (/token|password|secret|api.?key|authorization|credential|contrasena|contraseña/i.test(clave)) {
    return '[OCULTO]';
  }
  if (valor == null || typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') return redactar(valor);
  if (profundidad >= MAX_PROFUNDIDAD) return '[PROFUNDIDAD_LIMITADA]';
  if (Array.isArray(valor)) {
    const lista = valor.slice(0, MAX_ARRAY).map(v => sanitizar(v, profundidad + 1));
    if (valor.length > MAX_ARRAY) lista.push(`[${valor.length - MAX_ARRAY} ELEMENTOS ADICIONALES]`);
    return lista;
  }
  if (typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).slice(0, 35)
      .map(([k, v]) => [k, sanitizar(v, profundidad + 1, k)]));
  }
  return redactar(String(valor));
}
function crearTrazaReferencias(idActivo, idUsuario) {
  const id = `ACT${Number(idActivo) || 'X'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const inicio = Date.now();
  const emitir = (etapa, detalles = {}) => {
    try {
      const mensaje = {
        id,
        segundos: Number(((Date.now() - inicio) / 1000).toFixed(2)),
        etapa: String(etapa || 'EVENTO').slice(0, 80),
        ...sanitizar(detalles),
      };
      console.info('[FVE-REFERENCIAS-IA]', JSON.stringify(mensaje));
    } catch (e) {
      // La instrumentacion nunca puede romper el proceso ni comprometer datos.
      console.warn('[FVE-REFERENCIAS-IA]', id, 'Fallo al generar una traza segura');
    }
  };
  emitir('INICIO', { id_activo: Number(idActivo), id_usuario: Number(idUsuario), solicitud_manual: true });
  return emitir;
}
module.exports = { crearTrazaReferencias, sanitizar, redactar };
