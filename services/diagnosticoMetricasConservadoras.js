'use strict';

// No convierte datos ausentes en un ahorro de cero. No altera los prompts.
const numeroNoNegativo = valor => {
  if (valor === null || valor === undefined || valor === '' ||
      typeof valor === 'boolean') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function calcularAhorroVerificable(metricas, tarifas) {
  const categorias = [
    [metricas.consumo_energia_actual_mes, metricas.consumo_energia_proyectado_mes,
      tarifas.costoUnitarioEnergia],
    [metricas.consumo_agua_actual_mes, metricas.consumo_agua_proyectado_mes,
      tarifas.costoUnitarioAgua],
  ];
  const declaradas = categorias.filter(([antes, despues]) =>
    antes !== null && antes !== undefined || despues !== null && despues !== undefined);
  if (!declaradas.length) return null;
  let actual = 0;
  let nuevo = 0;
  for (const [antes, despues, tarifa] of declaradas) {
    const a = numeroNoNegativo(antes);
    const d = numeroNoNegativo(despues);
    const t = numeroNoNegativo(tarifa);
    if (a === null || d === null || t === null) return null;
    actual += a * t;
    nuevo += d * t;
  }
  return { actual, nuevo, ahorro: actual - nuevo };
}

function sumarCompleto(activos, campo) {
  if (!activos.length) return null;
  let suma = 0;
  for (const activo of activos) {
    const valor = activo?.metricas?.[campo];
    if (valor === null || valor === undefined || valor === '' ||
        typeof valor === 'boolean' || !Number.isFinite(Number(valor))) return null;
    suma += Number(valor);
  }
  return suma;
}

function corregirMetricasNoVerificables(metricas, tarifas = {}) {
  if (!metricas || typeof metricas !== 'object' || Array.isArray(metricas)) return metricas;
  const activos = Array.isArray(metricas.activos) ? metricas.activos : [];
  for (const activo of activos) {
    if (!activo || typeof activo !== 'object' || Array.isArray(activo)) continue;
    const m = activo.metricas && typeof activo.metricas === 'object' &&
      !Array.isArray(activo.metricas) ? activo.metricas : (activo.metricas = {});
    const calculo = calcularAhorroVerificable(m, tarifas);
    m.costo_actual_mes = calculo?.actual ?? null;
    m.costo_proyectado_mes = calculo?.nuevo ?? null;
    m.ahorro_economico_mensual = calculo?.ahorro ?? null;
    const inversion = numeroNoNegativo(m.inversion_total_requerida);
    m.roi_5_anios = calculo && inversion !== null && inversion > 0
      ? ((calculo.ahorro * 60 - inversion) / inversion) * 100 : null;
  }
  for (const campo of [
    'costo_actual_mes', 'costo_proyectado_mes', 'ahorro_economico_mensual',
    'reduccion_energia', 'reduccion_agua', 'reduccion_carbono',
  ]) metricas[campo] = sumarCompleto(activos, campo);
  const inversion = numeroNoNegativo(metricas.inversion_total_requerida);
  const ahorro = metricas.ahorro_economico_mensual;
  metricas.roi = inversion !== null && inversion > 0 && ahorro !== null
    ? ((ahorro * 60 - inversion) / inversion) * 100 : null;
  metricas.payback = inversion !== null && inversion > 0 && ahorro !== null && ahorro > 0
    ? inversion / ahorro : null;
  return metricas;
}

module.exports = { corregirMetricasNoVerificables, calcularAhorroVerificable };
