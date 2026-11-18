'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventarioHandlers, validarDatos } = require('../controllers/fve.inventario.controller');
const acceso = async (_db, id, uid) => id === 6 && uid === 9;
function res() { return { code: 200, body: null, status(x) { this.code = x; return this; }, json(x) { this.body = x; return this; } }; }
function fake() {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM public.activo') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{ id_activo: 4, id_mipyme: 6 }] };
      if (sql.includes('FROM public.fve_taxonomia_activo WHERE codigo')) return { rowCount: 1, rows: [{
        codigo: 'LUMINARIAS', alcance: 'MVP', habilitada: true,
        criterio: 'LED', version_regla: 'V1', campos_tecnicos: [
          { codigo: 'potencia_anterior_w', tipo: 'numero', requerido: true },
          { codigo: 'potencia_nueva_w', tipo: 'numero', requerido: true }
        ]
      }] };
      if (sql.includes('INSERT INTO public.fve_activo_caracterizacion')) return { rowCount: 1, rows: [{ id_activo: 4, estado_datos: params[6] }] };
      if (sql.includes('INSERT INTO public.audit_log')) return { rowCount: 1, rows: [] };
      throw new Error('SQL inesperado: ' + sql);
    }, release() {}
  };
  return { database: { connect: async () => client, query: (...x) => client.query(...x) }, queries };
}
function req(body, idActivo = '4', uid = 9) { return { params: { idActivo }, user: { id_usuario: uid }, body, ip: '127.0.0.1', get: () => 'test' }; }
const good = { codigo_taxonomia: 'LUMINARIAS', tipo_intervencion: 'reemplazo', datos_tecnicos: { potencia_anterior_w: 60, potencia_nueva_w: 9 } };

test('valida campos tecnicos sin admitir claves arbitrarias', () => {
  const campos = [{ codigo: 'potencia_anterior_w', tipo: 'numero', requerido: true }];
  assert.match(validarDatos({ no_declarado: 12 }, campos).error, /desconocido/);
  assert.equal(validarDatos({ potencia_anterior_w: -2 }, campos).error.includes('numerico'), true);
  assert.deepEqual(validarDatos({ potencia_anterior_w: 40 }, campos).pendientes, []);
});
test('guardar caracterizacion registra auditoria y estado completo', async () => {
  const db = fake(); const result = res();
  await createInventarioHandlers(db.database, acceso).guardar(req(good), result);
  assert.equal(result.code, 200);
  assert.equal(result.body.caracterizacion.estado_datos, 'completa');
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO public.audit_log')).length, 1);
});
test('guardar incompleto conserva pendiente_datos', async () => {
  const db = fake(); const result = res();
  await createInventarioHandlers(db.database, acceso).guardar(req({ ...good, datos_tecnicos: { potencia_anterior_w: 60 } }), result);
  assert.equal(result.code, 200);
  assert.equal(result.body.caracterizacion.estado_datos, 'pendiente_datos');
});
test('rechaza usuario sin acceso antes de escribir', async () => {
  const db = fake(); const result = res();
  await createInventarioHandlers(db.database, acceso).guardar(req(good, '4', 12), result);
  assert.equal(result.code, 403);
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO')).length, 0);
});
test('rechaza ids invalidos sin consulta', async () => {
  const db = fake(); const result = res();
  await createInventarioHandlers(db.database, acceso).guardar(req(good, '-1'), result);
  assert.equal(result.code, 400);
  assert.equal(db.queries.length, 0);
});
test('bloquea claves incorrectas e impide registrar auditoria', async () => {
  const db = fake(); const result = res();
  await createInventarioHandlers(db.database, acceso).guardar(req({ ...good, datos_tecnicos: { inventado: true } }), result);
  assert.equal(result.code, 400);
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO')).length, 0);
});
