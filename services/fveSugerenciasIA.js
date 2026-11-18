'use strict';

const { validarDatosExistentes } = require('./fveClasificacionActivo');

const FUENTES_ADMITIDAS = new Set([
  'placa', 'etiqueta', 'fotografia', 'manual', 'ficha_tecnica',
  'fabricante', 'documento', 'contexto',
]);

// La duracion/frecuencia de uso de un equipo no se deduce de una placa.
const SOLO_CONTEXTO_OPERATIVO = new Set([
  'horas_dia', 'dias_anio', 'ciclos_semana', 'minutos_dia', 'descargas_dia',
]);

function normalizarFuente(valor) {
  return String(valor || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ -]/g, '_');
}

function normalizarSugerenciasIA(sugerencias, campos) {
  if (!sugerencias || typeof sugerencias !== 'object' || Array.isArray(sugerencias)) return {};
  if (!Array.isArray(campos) || campos.length === 0) return {};
  const permitidos = new Map(campos.map(c => [c.codigo, c]));
  const salida = {};
  for (const [codigo, item] of Object.entries(sugerencias)) {
    const campo = permitidos.get(codigo);
    if (!campo || !item || typeof item !== 'object' || Array.isArray(item)) continue;
    const fuente = normalizarFuente(item.fuente);
    const evidencia = typeof item.evidencia === 'string' ? item.evidencia.trim() : '';
    if (!FUENTES_ADMITIDAS.has(fuente) || evidencia.length < 8 || evidencia.length > 500) continue;
    if (SOLO_CONTEXTO_OPERATIVO.has(codigo) && fuente !== 'contexto') continue;
    if (item.valor === null || item.valor === undefined || item.valor === '') continue;
    // No convertir textos ambiguos con unidades ni estimaciones en valores guardables.
    if (campo.tipo !== 'texto' && typeof item.valor !== 'number') continue;
    const validacion = validarDatosExistentes({ [codigo]: item.valor }, [campo]);
    if (validacion.error || !Object.hasOwn(validacion.normalizados, codigo)) continue;
    const valor = validacion.normalizados[codigo];
    if (typeof valor === 'number' && valor <= 0) continue;
    salida[codigo] = { valor, fuente, evidencia, estado: 'sugerido' };
  }
  return salida;
}

module.exports = { normalizarSugerenciasIA };
