"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { referenciasSinVerificar } = require('../services/fveReferenciasAnalisisIA');
const { camposExistentes } = require('../services/fveClasificacionActivo');
const campos = camposExistentes('NEVERAS_REFRIGERACION');

test('extrae capacidad y consumo textual mostrado por la IA sin convertirlos en mediciones', () => {
  const x = referenciasSinVerificar({
    'capacidad': '300 litros',
    'consumo de energía': '28.5 kWh/mes',
    'costo mensual': '27550.34 COP',
  }, campos);
  assert.equal(x.capacidad_actual_l.valor, 300);
  assert.equal(x.consumo_actual_kwh_mes.valor, 28.5);
  assert.equal(x.capacidad_actual_l.estado, 'sin_verificar');
  assert.equal(x.consumo_actual_kwh_mes.estado, 'sin_verificar');
  assert.equal(x.anio_equipo_anterior, undefined);
});
test('admite el formato de atributos alternativo y coma decimal', () => {
  const x = referenciasSinVerificar({ capacidad_nominal: '300 Litros', consumo_energetico_estimado: '28,5 kWh/mes' }, campos);
  assert.equal(x.capacidad_actual_l.valor, 300);
  assert.equal(x.consumo_actual_kwh_mes.valor, 28.5);
});
test('no confunde kWh por ciclo, kW ni costos monetarios con kWh por mes', () => {
  const x = referenciasSinVerificar({ 'consumo de energía': '28 kWh/ciclo', capacidad: '250 COP' }, campos);
  assert.deepEqual(x, {});
});
test('no rellena consumo a partir de numeros sin unidades', () => {
  const x = referenciasSinVerificar({ 'consumo de energía': 28.5, capacidad: 300 }, campos);
  assert.deepEqual(x, {});
});
test('no toma referencias cuando hay un valor tecnicamente verificado', () => {
  const x = referenciasSinVerificar({ capacidad: '300 litros' }, campos, {capacidad_actual_l: 310});
  assert.deepEqual(x, {});
});
test('rechaza texto especulativo y anios fuera de rango', () => {
  const x = referenciasSinVerificar({ capacidad: 'aproximadamente 300 litros', anio_equipo_anterior: 1888 }, campos);
  assert.deepEqual(x, {});
});
test('no reutiliza un resultado con categoria sin coincidencias', () => {
  const x = referenciasSinVerificar({capacidad: '300 litros'}, camposExistentes('AIRES_ACONDICIONADOS'));
  assert.deepEqual(x, {});
});
