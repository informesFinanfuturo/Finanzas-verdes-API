'use strict';

// FVE_HORARIOS_USO_V1: fuentes declaradas por empresa, NO mediciones.
const DIAS = new Set(['lunes','martes','miercoles','jueves','viernes','sabado','domingo']);
const TIPOS = new Set([
  'Neveras','Televisores','Hornos','Climatización','Vitrinas','Refrigeración',
  'Secadoras','Iluminación','Lavadoras','Lava vajillas','Sanitarios','Grifos',
  'Reductores de caudal','Otro',
]);
const MODOS = new Set([
  'apagado','continuo','espera','parcial','sin_uso','uso_fuera','desconocido',
]);
const LIMITES = {
  horas_uso_dia: 24,
  horas_fuera_horario_dia: 24,
  porcentaje_encendido_fuera: 100,
  ciclos_semana: 10000,
  minutos_ciclo: 1440,
  minutos_uso_dia: 1440,
  descargas_dia: 10000,
  usos_dia: 10000,
};

function validarHora(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function validarHorarioOperacion(entrada) {
  if (entrada === null) return null;
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) || entrada.version !== 1 ||
      !entrada.dias || typeof entrada.dias !== 'object' || Array.isArray(entrada.dias)) {
    throw new Error('Formato de horario de empresa invalido');
  }
  const salida = {};
  for (const [dia, turno] of Object.entries(entrada.dias)) {
    if (!DIAS.has(dia) || !turno || typeof turno !== 'object' || Array.isArray(turno) ||
        !validarHora(turno.inicio) || !validarHora(turno.fin)) {
      throw new Error(`Horario invalido para ${dia}`);
    }
    salida[dia] = {inicio: turno.inicio, fin: turno.fin};
  }
  return Object.keys(salida).length ? {version: 1, dias: salida} : null;
}

function validarPerfilUso(entrada, tipoActual = null) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) || entrada.version !== 1 ||
      !TIPOS.has(entrada.tipo_activo) || !MODOS.has(entrada.modo) ||
      entrada.fuente !== 'declarado_empresa') {
    throw new Error('Perfil de uso invalido');
  }
  if (tipoActual && tipoActual !== entrada.tipo_activo) {
    throw new Error('El perfil de uso no corresponde al tipo de activo');
  }
  const raw = entrada.mediciones ?? {};
  if (typeof raw !== 'object' || !raw || Array.isArray(raw)) {
    throw new Error('Mediciones de uso invalidas');
  }
  const mediciones = {};
  for (const [codigo, valor] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(LIMITES, codigo) ||
        typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > LIMITES[codigo]) {
      throw new Error(`Valor de uso invalido: ${codigo}`);
    }
    mediciones[codigo] = valor;
  }
  return {version: 1, tipo_activo: entrada.tipo_activo, modo: entrada.modo,
    mediciones, fuente: 'declarado_empresa'};
}

module.exports = {validarHorarioOperacion, validarPerfilUso};
