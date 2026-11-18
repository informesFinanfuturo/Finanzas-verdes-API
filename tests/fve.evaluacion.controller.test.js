'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearHandlers } = require('../controllers/fve.evaluacion.controller');
function res() { return { code: 200, body: null, status(n) { this.code = n; return this; },
  json(body) { this.body = body; return this; } }; }
function req(props = {}) {
  return { user: { id_usuario: 8 }, body: { id_proceso: 7, id_activo: 15,
    ruta_intervencion: 'reemplazo', datos_nuevos: { tecnologia_nueva: 'LED', potencia_nueva_w: 10 },
    fuente_producto: { tipo: 'ficha_tecnica', referencia: 'Ficha simulada' }, ...props },
    ip: '127.0.0.1', get: () => 'test' };
}
function mockDb() {
  const queries = [];
  const client = {
    async query(sql, args = []) {
      queries.push({ sql, args });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM public.fve_proceso p') && sql.includes('JOIN public.activo a')) return {
        rowCount: 1, rows: [{ id_proceso: 7, id_mipyme: 9, id_activo: 15,
          nombre: 'Tubos fluorescentes', tipo: 'Iluminación', caracterizacion: {
            codigo_taxonomia: 'LUMINARIAS', tipo_intervencion: 'reemplazo',
            version_taxonomia: 'V1', datos_tecnicos: { tecnologia_anterior: 'fluorescente',
              potencia_anterior_w: 60, horas_dia: 8, dias_anio: 300 } } }] };
      if (sql.includes('FROM public.fve_taxonomia_activo')) return { rowCount: 1, rows: [
        { codigo: 'LUMINARIAS', nombre: 'Luminarias', criterio: 'LED',
          version_regla: 'V1', habilitada: true, alcance: 'MVP' }] };
      if (sql.includes('FROM public.fve_motor_parametro')) return { rowCount: 1, rows: [
        { umbral_ahorro: '0.20', banda_incertidumbre: '0', dias_operacion_default: 365,
          version_parametro: 'TEST', estado_aprobacion: 'provisional' }] };
      if (sql.includes('INSERT INTO public.fve_evaluacion_activo')) return {
        rowCount: 1, rows: [{ id_evaluacion: 100, created_at: '2026-11-05T00:00:00Z' }] };
      if (sql.includes('INSERT INTO public.audit_log')) return { rowCount: 1, rows: [] };
      throw new Error('SQL inesperado ' + sql);
    }, release() {},
  };
  return { pool: { connect: async () => client, query: (...args) => client.query(...args) }, queries };
}
const acceso = async (_db, idMipyme, idUsuario) => idMipyme === 9 && idUsuario === 8;
test('evaluacion persiste snapshot, version y auditoria', async () => {
  const db = mockDb(); const response = res();
  await crearHandlers(db.pool, acceso).evaluar(req(), response);
  assert.equal(response.code, 201);
  assert.equal(response.body.resultado.estado, 'elegible');
  assert.equal(response.body.apto_para_propuesta, false);
  assert.ok(db.queries.some(q => q.sql.includes('INSERT INTO public.audit_log')));
  const insert = db.queries.find(q => q.sql.includes('INSERT INTO public.fve_evaluacion_activo'));
  assert.equal(insert.args[8], 'elegible');
  assert.equal(JSON.parse(insert.args[17]).tipo_intervencion, 'reemplazo');
});
test('usuario no autorizado no escribe evaluacion', async () => {
  const db = mockDb(); const response = res();
  await crearHandlers(db.pool, acceso).evaluar({ ...req(), user: { id_usuario: 99 } }, response);
  assert.equal(response.code, 403);
  assert.equal(db.queries.some(q => q.sql.includes('INSERT INTO')), false);
});
test('ruta obligatoria para evitar que el sistema asuma reemplazo', async () => {
  const db = mockDb(); const response = res();
  await crearHandlers(db.pool, acceso).evaluar(req({ ruta_intervencion: null }), response);
  assert.equal(response.code, 400);
  assert.equal(db.queries.length, 0);
});
test('campo tecnico extra no se acepta', async () => {
  const db = mockDb(); const response = res();
  await crearHandlers(db.pool, acceso).evaluar(req({ datos_nuevos: {
    potencia_nueva_w: 8, tecnologia_nueva: 'LED', precio_manual: 100 } }), response);
  assert.equal(response.code, 400);
  assert.equal(db.queries.some(q => q.sql.includes('INSERT INTO')), false);
});
test('adquisicion nueva nunca genera ahorro ni elegibilidad', async () => {
  const db = mockDb(); const response = res();
  await crearHandlers(db.pool, acceso).evaluar(req({ ruta_intervencion: 'adquisicion_nueva' }), response);
  assert.equal(response.code, 201);
  assert.equal(response.body.resultado.estado, 'fuera_alcance');
  assert.equal(response.body.resultado.ahorro_anual_estimado, null);
});
