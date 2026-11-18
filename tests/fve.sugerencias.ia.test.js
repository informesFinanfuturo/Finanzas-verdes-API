'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { camposExistentes } = require('../services/fveClasificacionActivo');
const { normalizarSugerenciasIA } = require('../services/fveSugerenciasIA');
const placa = { fuente: 'placa', evidencia: 'Placa tecnica fotografiada, dato exacto' };

test('acepta datos exactos con evidencia en una categoria habilitada', () => {
  const campos = camposExistentes('NEVERAS_REFRIGERACION');
  const r = normalizarSugerenciasIA({
    anio_equipo_anterior: { valor: 2021, ...placa },
    capacidad_actual_l: { valor: 450, ...placa },
    consumo_actual_kwh_mes: { valor: 45.6, fuente: 'fabricante', evidencia: 'Ficha exacta modelo X, 45.6 kWh/mes' },
  }, campos);
  assert.equal(r.anio_equipo_anterior.valor, 2021);
  assert.equal(r.capacidad_actual_l.valor, 450);
  assert.equal(r.consumo_actual_kwh_mes.valor, 45.6);
  assert.equal(r.capacidad_actual_l.estado, 'sugerido');
});

test('rechaza claves ajenas, ausencia de evidencia, estimaciones y valores ambiguos', () => {
  const campos = camposExistentes('NEVERAS_REFRIGERACION');
  assert.deepEqual(normalizarSugerenciasIA({
    precio: { valor: 300, ...placa },
    anio_equipo_anterior: { valor: 2021, fuente: 'estimacion', evidencia: 'Parece del 2021 por su aspecto' },
    capacidad_actual_l: { valor: '450 litros', ...placa },
    consumo_actual_kwh_mes: { valor: 100, fuente: 'fabricante', evidencia: '' },
  }, campos), {});
});

test('uso diario no se extrae de la etiqueta de potencia', () => {
  const campos = camposExistentes('LUMINARIAS');
  const r = normalizarSugerenciasIA({
    potencia_anterior_w: { valor: 12, ...placa },
    horas_dia: { valor: 8, ...placa },
    dias_anio: { valor: 260, fuente: 'contexto', evidencia: 'Horario declarado por el cliente: 260 dias al año' },
  }, campos);
  assert.equal(r.potencia_anterior_w.valor, 12);
  assert.equal(r.horas_dia, undefined);
  assert.equal(r.dias_anio.valor, 260);
});

test('rechaza fechas invalidas y numeros negativos o cero', () => {
  const campos = camposExistentes('NEVERAS_REFRIGERACION');
  assert.deepEqual(normalizarSugerenciasIA({
    anio_equipo_anterior: { valor: 1800, ...placa },
    capacidad_actual_l: { valor: -2, ...placa },
    consumo_actual_kwh_mes: { valor: 0, ...placa },
  }, campos), {});
});

test('sugerencias ausentes no generan valores inventados', () => {
  assert.deepEqual(normalizarSugerenciasIA(null, camposExistentes('GRIFERIA')), {});
  assert.deepEqual(normalizarSugerenciasIA({}, camposExistentes('GRIFERIA')), {});
});
