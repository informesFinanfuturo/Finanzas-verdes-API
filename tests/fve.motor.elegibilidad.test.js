'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluarActivo } = require('../services/fveMotorElegibilidad');

const base = (banda = 0.3) => ({ umbral_ahorro: '0.2', banda_incertidumbre: banda,
  dias_operacion_default: 365, version_parametro: 'TEST-V1', estado_aprobacion: 'provisional' });
const evidencia = { tipo: 'ficha_tecnica', referencia: 'Ficha tecnica de prueba (NO es un dato real)' };
const luz = { categoria: 'LUMINARIAS', anterior: { tecnologia_anterior: 'fluorescente',
    potencia_anterior_w: 60, horas_dia: 8, dias_anio: 300 },
  nuevo: { tecnologia_nueva: 'LED', potencia_nueva_w: 10 },
  fuenteProducto: evidencia, parametros: base(0) };
const grifo = { categoria: 'GRIFERIA', anterior: { caudal_anterior_l_min: 12, minutos_dia: 60 },
  nuevo: { caudal_nuevo_l_min: 6 }, fuenteProducto: evidencia, parametros: base() };

test('iluminacion: aplica conversion W a kWh/anio y umbral a cada activo', () => {
  const r = evaluarActivo(luz);
  assert.equal(r.estado, 'elegible');
  assert.equal(r.consumo_anterior_anual, 144);
  assert.equal(r.consumo_nuevo_anual, 24);
  assert.equal(r.ahorro_anual_estimado, 120);
  assert.equal(r.ahorro_porcentual_central, 83.3333);
  assert.equal(r.requiere_certificado_disposicion, true);
  assert.equal(r.puede_reportarse_como_verde_confirmado, false);
});
test('griferia: l/min a m3/anio, banda y piso conservador', () => {
  const r = evaluarActivo(grifo);
  assert.equal(r.estado, 'elegible');
  assert.equal(r.consumo_anterior_anual, 262.8);
  assert.equal(r.consumo_nuevo_anual, 131.4);
  assert.equal(r.ahorro_anual_estimado, 131.4);
  assert.equal(r.ahorro_porcentual_central, 50);
  assert.equal(r.ahorro_porcentual_minimo, 35);
  assert.equal(r.supuestos.find(s => s.campo === 'dias_operacion_anio').valor, 365);
});
test('ahorro central del 25 por ciento, pero inferior de banda 17.5 no supera el umbral', () => {
  const r = evaluarActivo({ ...grifo, anterior: { caudal_anterior_l_min: 8, minutos_dia: 30 } });
  assert.equal(r.ahorro_porcentual_central, 25);
  assert.equal(r.ahorro_porcentual_minimo, 17.5);
  assert.equal(r.estado, 'no_alcanza_umbral');
});
test('griferia de 7 l/min incumple producto, incluso con ahorro positivo', () => {
  const r = evaluarActivo({ ...grifo, nuevo: { caudal_nuevo_l_min: 7 } });
  assert.equal(r.estado, 'no_elegible');
  assert.equal(r.cumple_criterio_producto, false);
});
test('reductor necesita confirmacion de aplicacion sobre equipo existente', () => {
  const r = evaluarActivo({ ...grifo, categoria: 'REDUCTORES_CAUDAL',
    nuevo: { caudal_nuevo_l_min: 4 } });
  assert.equal(r.estado, 'pendiente_dato');
  assert.ok(r.pendientes.includes('dispositivo_sobre_griferia_existente'));
});
test('reductor no exige limite de 6 l/min, pero si instalacion y ahorro', () => {
  const r = evaluarActivo({ ...grifo, categoria: 'REDUCTORES_CAUDAL',
    nuevo: { caudal_nuevo_l_min: 7, dispositivo_sobre_griferia_existente: true } });
  assert.equal(r.estado, 'elegible');
});
test('reemplazo LED por LED no cumple criterio de luminarias del MVP', () => {
  assert.equal(evaluarActivo({ ...luz, anterior: { ...luz.anterior, tecnologia_anterior: 'LED' } }).estado, 'no_elegible');
});
test('fuente tecnica del producto faltante no se convierte en elegible', () => {
  const r = evaluarActivo({ ...luz, fuenteProducto: null });
  assert.equal(r.estado, 'pendiente_dato');
  assert.ok(r.pendientes.includes('evidencia_tecnica_producto_nuevo'));
});
test('dato previo faltante queda pendiente y no se inventan valores', () => {
  const r = evaluarActivo({ ...luz, anterior: { tecnologia_anterior: 'fluorescente' } });
  assert.equal(r.estado, 'pendiente_dato');
  assert.equal(r.ahorro_anual_estimado, null);
});
test('adquisicion nueva se excluye sin calcular ahorro ficticio', () => {
  const r = evaluarActivo({ ...luz, intervencion: 'adquisicion_nueva' });
  assert.equal(r.estado, 'fuera_alcance');
  assert.equal(r.ahorro_anual_estimado, null);
});
test('rechaza suponer dias cuando se envio dato invalido explicito', () => {
  const r = evaluarActivo({ ...grifo, nuevo: { caudal_nuevo_l_min: 4, dias_operacion_anio: 400 } });
  assert.equal(r.estado, 'pendiente_dato');
  assert.ok(r.pendientes.includes('dias_operacion_anio'));
});
test('nueva tecnologia no LED no es elegible', () => {
  const r = evaluarActivo({ ...luz, nuevo: { tecnologia_nueva: 'halogena', potencia_nueva_w: 10 } });
  assert.equal(r.estado, 'no_elegible');
});
