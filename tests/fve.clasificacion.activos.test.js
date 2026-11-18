'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  clasificarActivo, camposExistentes, validarDatosExistentes, sugerenciasDesdeDatos,
} = require('../services/fveClasificacionActivo');
const { createInventarioHandlers } = require('../controllers/fve.inventario.controller');

const cases = [
  ['Neveras', 'Nevera piso 2', 'NEVERAS_REFRIGERACION'],
  ['Refrigeración', 'Congelador', 'NEVERAS_REFRIGERACION'],
  ['Hornos', 'Horno eléctrico', 'HORNOS'],
  ['Hornos', 'Microondas', null],
  ['Iluminación', 'Lámpara 1', 'LUMINARIAS'],
  ['Lavadoras', 'Lavadora', 'LAVADORAS'],
  ['Sanitarios', 'Baño principal', 'SANITARIOS'],
  ['Grifos', 'Llave de cocina', 'GRIFERIA'],
  ['Grifos', 'Llave con reductor de caudal', 'REDUCTORES_CAUDAL'],
  ['Reductores de caudal', 'Aireador', 'REDUCTORES_CAUDAL'],
  ['Climatización', 'Aire acondicionado emilio', 'AIRES_ACONDICIONADOS'],
  ['Climatización', 'Ventilador', null],
  ['Televisores', 'Pantalla', null],
  ['Otro', 'Motor', null],
];
for (const [tipo, nombre, codigo] of cases) {
  test(`clasifica ${tipo}: ${nombre}`, () => assert.equal(clasificarActivo(tipo, nombre), codigo));
}

test('las fichas tecnicas nunca incluyen especificaciones de la tecnologia nueva', () => {
  const campos = camposExistentes('NEVERAS_REFRIGERACION');
  assert.ok(campos.some(c => c.codigo === 'anio_equipo_anterior'));
  assert.ok(!campos.some(c => c.codigo.includes('_nuevo')));
});
test('campos opcionales permiten guardar sin datos', () => {
  const v = validarDatosExistentes({}, camposExistentes('LUMINARIAS'));
  assert.equal(v.error, undefined);
  assert.ok(v.pendientes.includes('potencia_anterior_w'));
});
test('rechaza valores arbitrarios e inventos', () => {
  assert.match(validarDatosExistentes({ precio_propuesto: 10 }, camposExistentes('GRIFERIA')).error, /no permitido/);
  assert.match(validarDatosExistentes({ caudal_anterior_l_min: 'quince' }, camposExistentes('GRIFERIA')).error, /no valido/);
});
test('solo sugiere valores con unidad explicita, no estimaciones ambiguas', () => {
  const datos = { 'Potencia (W)': 120, 'Consumo': 50, 'Potencia': 140 };
  const r = sugerenciasDesdeDatos(datos, camposExistentes('AIRES_ACONDICIONADOS'));
  assert.equal(r.potencia_anterior_w, 120);
  assert.equal(r.consumo_actual_kwh_mes, undefined);
});

test('consulta de reemplazo devuelve faltantes sin editar registros', async () => {
  const consultas = [];
  const pool = { async query(sql, params) {
    consultas.push(sql.trim());
    if (sql.includes('FROM public.activo a')) return { rowCount: 1, rows: [{ id_activo: 4, id_mipyme: 7,
      tipo: 'Grifos', nombre: 'Llave', datos: {}, caracterizacion: null }] };
    if (sql.includes('FROM public.fve_taxonomia_activo')) return { rows: [{codigo:'GRIFERIA',nombre:'Griferia',criterio:'caudal',version_regla:'v1'}] };
    throw Error('SQL no esperada');
  }};
  const res = { status(c){ this.code=c; return this; }, json(v){ this.data=v; return this; } };
  await createInventarioHandlers(pool, async () => true).validarReemplazo(
    { user: { id_usuario: 1 }, params: { idActivo: '4' } }, res);
  assert.equal(res.data.puede_continuar, false);
  assert.ok(res.data.campos_pendientes.some(x => x.codigo === 'caudal_anterior_l_min'));
  assert.ok(consultas.every(sql => sql.startsWith('SELECT')));
});

test('clasificacion sin categoria no obliga ni asigna categoria falsa', async () => {
  const res = { status(c){ this.code=c; return this; }, json(v){ this.data=v; return this; } };
  const pool = { query: async () => { throw Error('No debio consultar BD'); } };
  await createInventarioHandlers(pool).clasificar({user:{id_usuario:1},query:{tipo:'Televisores',nombre:'TV'}},res);
  assert.equal(res.data.ficha.codigo_taxonomia, null);
  assert.equal(res.data.ficha.campos_existentes.length, 0);
});
