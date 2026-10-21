'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Test without a live PostgreSQL instance. The dependency injected here
// exercises controller input validation, duplicate protection and audit flow.
const { createFveHandlers } = require('../controllers/fve.controller');

function response() {
  return {
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeDb({ diagnostic = { id_diagnostico: 17, id_mipyme: 6, estado: 'activo', estado_mipyme: 'activo' }, existing = null } = {}) {
  const executed = [];
  let row = existing;
  const client = {
    async query(sql, params = []) {
      executed.push(sql.trim());
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.includes('AS permitido')) {
        return {
          rowCount: 1,
          rows: [{ permitido: true }]
        };
      }
      if (sql.includes('FROM public.diagnostico d')) return { rowCount: diagnostic ? 1 : 0, rows: diagnostic ? [diagnostic] : [] };
      if (sql.includes('INSERT INTO public.fve_proceso')) {
        if (row) return { rowCount: 0, rows: [] };
        row = { id_proceso: 5, id_diagnostico: params[0], id_mipyme: params[1], created_by: params[2], estado: 'en_preparacion', paso_actual: 2 };
        return { rowCount: 1, rows: [row] };
      }
      if (/SELECT\s+\*\s+FROM\s+public\.fve_proceso/i.test(sql)) {
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : []
        };
      }
      if (sql.includes('INSERT INTO public.audit_log')) return { rowCount: 1, rows: [] };
      throw Error('Unexpected SQL: ' + sql);
    },
    release() {},
  };
  return { connect: async () => client, executed };
}

function request(diagnostico = 17) {
  return { body: { id_diagnostico: diagnostico }, user: { id_usuario: 9 }, ip: '127.0.0.1', get: () => 'node-test' };
}

test('crea un solo proceso y registra un evento de auditoria', async () => {
  const db = fakeDb();
  const handlers = createFveHandlers(db);
  const first = response();
  await handlers.iniciarProceso(request(), first);
  assert.equal(first.code, 201);
  assert.equal(first.body.creado, true);
  assert.equal(first.body.proceso.paso_actual, 2);
  assert.equal(db.executed.filter(sql => sql.includes('INSERT INTO public.audit_log')).length, 1);

  const second = response();
  await handlers.iniciarProceso(request(), second);
  assert.equal(second.code, 200);
  assert.equal(second.body.creado, false);
  assert.equal(second.body.proceso.id_proceso, first.body.proceso.id_proceso);
  assert.equal(db.executed.filter(sql => sql.includes('INSERT INTO public.audit_log')).length, 1);
});

test('rechaza identificadores invalidos sin consultar la base', async () => {
  const db = fakeDb();
  const handlers = createFveHandlers(db);
  const res = response();
  await handlers.iniciarProceso(request('no-numerico'), res);
  assert.equal(res.code, 400);
  assert.equal(db.executed.length, 0);
});

test('no inicia proceso con diagnostico inactivo', async () => {
  const db = fakeDb({ diagnostic: { id_diagnostico: 17, id_mipyme: 6, estado: 'eliminado', estado_mipyme: 'activo' } });
  const handlers = createFveHandlers(db);
  const res = response();
  await handlers.iniciarProceso(request(), res);
  assert.equal(res.code, 422);
  assert.ok(db.executed.includes('ROLLBACK'));
});

test('no inicia proceso con diagnostico inexistente', async () => {
  const db = fakeDb({ diagnostic: null });
  const handlers = createFveHandlers(db);
  const res = response();
  await handlers.iniciarProceso(request(), res);
  assert.equal(res.code, 404);
});
