'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validarJustificaciones } = require('../services/fveJustificacionesAmbientales');

test('no exige notas en borradores ni visitas antiguas', () => {
  assert.deepEqual(validarJustificaciones(undefined), {});
  assert.deepEqual(validarJustificaciones(null), {});
});

test('conserva solo notas de bloques 1, 3, 4 y 5 y limpia espacios', () => {
  assert.deepEqual(validarJustificaciones({ '1': '  Factura disponible  ', '3': ' ', '5': '  Evidencia  ' }), {
    '1': 'Factura disponible', '5': 'Evidencia',
  });
});

test('rechaza notas de inventario y contexto opcional', () => {
  assert.throws(() => validarJustificaciones({ '2': 'Inventario' }), /bloque 2/);
  assert.throws(() => validarJustificaciones({ '6': 'Opcional' }), /bloque 6/);
});

test('rechaza entradas no textuales o excesivas', () => {
  assert.throws(() => validarJustificaciones([]), /objeto/);
  assert.throws(() => validarJustificaciones({ '1': 4 }), /invalida/);
  assert.throws(() => validarJustificaciones({ '1': 'x'.repeat(1201) }), /1200/);
  assert.equal(validarJustificaciones({ '4': 'a'.repeat(1200) })['4'].length, 1200);
});
