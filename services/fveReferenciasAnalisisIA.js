"use strict";

const { validarDatosExistentes } = require('./fveClasificacionActivo');

// Solo se convierten a sugerencias visibles magnitudes cuya unidad sea explicita.
// Un numero extraido de un modelo equivalente NO es una medicion del equipo.
const ALIASES = {
  anio_equipo_anterior: ['anio_equipo_anterior', 'ano_fabricacion', 'anio_fabricacion', 'ano_del_equipo'],
  consumo_actual_kwh_mes: ['consumo_actual_kwh_mes', 'consumo_de_energia', 'consumo_energia', 'consumo_energetico_estimado', 'consumo_energetico', 'consumo_mensual_kwh', 'consumo_kwh_mes'],
  capacidad_actual_l: ['capacidad_actual_l', 'capacidad_nominal', 'capacidad', 'capacidad_total', 'capacidad_litros'],
  potencia_anterior_w: ['potencia_anterior_w', 'potencia_w', 'potencia_nominal_w'],
  consumo_actual_kwh_ciclo: ['consumo_actual_kwh_ciclo', 'consumo_kwh_ciclo'],
  descarga_anterior_l: ['descarga_anterior_l', 'litros_por_descarga'],
  caudal_anterior_l_min: ['caudal_anterior_l_min', 'caudal_l_min', 'caudal'],
};

function claveNormalizada(cadena) {
  return String(cadena || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function convertir(raw, codigo, claveOriginal) {
  if (raw === null || raw === undefined || typeof raw === 'object') return null;
  const esNumero = typeof raw === 'number';
  const texto = String(raw).trim();
  const clave = claveNormalizada(claveOriginal);
  if (!texto || texto.length > 90) return null;
  let n;
  if (codigo === 'anio_equipo_anterior') {
    if (!/^\d{4}$/.test(texto)) return null;
    n = Number(texto);
    if (n < 1900 || n > new Date().getFullYear() + 1) return null;
    return n;
  }
  const reglas = {
    consumo_actual_kwh_mes: /^([\d]+(?:[.,]\d+)?)\s*kwh\s*(?:\/|por\s+)(?:mes|mensual|meses)$/i,
    capacidad_actual_l: /^([\d]+(?:[.,]\d+)?)\s*(?:l|lt|lts|litro|litros)$/i,
    potencia_anterior_w: /^([\d]+(?:[.,]\d+)?)\s*(?:w|watts?)$/i,
    consumo_actual_kwh_ciclo: /^([\d]+(?:[.,]\d+)?)\s*kwh\s*(?:\/|por\s+)(?:ciclo)$/i,
    descarga_anterior_l: /^([\d]+(?:[.,]\d+)?)\s*(?:l|litros?)\s*(?:\/|por\s+)(?:descarga)$/i,
    caudal_anterior_l_min: /^([\d]+(?:[.,]\d+)?)\s*(?:l|litros?)\s*(?:\/|por\s+)(?:min|minuto)$/i,
  };
  const match = reglas[codigo]?.exec(texto);
  if (match) n = Number(match[1].replace(',', '.'));
  else if ((esNumero || /^\d+(?:[.,]\d+)?$/.test(texto)) &&
    // La unidad se acepta implicita solo cuando el nombre del dato la contiene.
    (clave === codigo || /(?:_kwh_mes|_kwh_ciclo|_l_min|_litros|_w)$/.test(clave))) {
    n = Number(texto.replace(',', '.'));
  } else return null;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function referenciasSinVerificar(datos, campos, verificadas = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos) || !Array.isArray(campos)) return {};
  const origenes = new Map(Object.entries(datos)
    .filter(([,v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k,v]) => [claveNormalizada(k), {clave:k, valor:v}]));
  const resultado = {};
  for (const campo of campos) {
    const codigo = campo.codigo;
    if (Object.hasOwn(verificadas, codigo)) continue;
    const candidatos = ALIASES[codigo] || [];
    for (const alias of candidatos) {
      const dato = origenes.get(alias);
      if (!dato) continue;
      const valor = convertir(dato.valor, codigo, dato.clave);
      if (valor === null) continue;
      const valido = validarDatosExistentes({[codigo]: valor}, [campo]);
      if (valido.error || !Object.hasOwn(valido.normalizados, codigo)) continue;
      resultado[codigo] = {
        valor: valido.normalizados[codigo],
        origen: dato.clave,
        evidencia: String(dato.valor).slice(0,90),
        estado: 'sin_verificar',
      };
      break;
    }
  }
  return resultado;
}

module.exports = { referenciasSinVerificar };
