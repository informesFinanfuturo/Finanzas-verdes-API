'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventarioHandlers } = require('../controllers/fve.inventario.controller');
const { camposExistentes, validarDatosExistentes } = require('../services/fveClasificacionActivo');

const acceso = async (_db, id, uid) => id === 6 && uid === 9;
const campos = camposExistentes('LUMINARIAS');
const datosCompletos = {
  tecnologia_anterior: 'fluorescente',
  potencia_anterior_w: 60,
  horas_dia: 8,
  dias_anio: 300,
};
const cuerpoValido = {
  datos_tecnicos: datosCompletos,
  observaciones: 'Equipo existente verificado por el asesor',
};
function respuesta() {
  return {
    code: 200, body: null,
    status(x) { this.code = x; return this; },
    json(x) { this.body = x; return this; },
  };
}
function solicitud(body, idActivo = '4', uid = 9) {
  return {
    params: { idActivo },
    user: { id_usuario: uid },
    body,
    ip: '127.0.0.1',
    get: () => 'test',
  };
}
function simularBD() {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes('FROM public.activo') && normalized.includes('FOR UPDATE')) {
        return {
          rowCount: 1,
          rows: [{ id_activo: 4, id_mipyme: 6, tipo: 'Iluminacion', nombre: 'Lampara de prueba' }],
        };
      }
      if (normalized.includes('FROM public.fve_taxonomia_activo')) {
        return {
          rowCount: 1,
          rows: [{
            codigo: 'LUMINARIAS', nombre: 'Luminarias', criterio: 'LED',
            version_regla: 'TEST-V1', habilitada: true, alcance: 'MVP',
          }],
        };
      }
      if (normalized.includes('FROM public.fve_activo_caracterizacion')) {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes('INSERT INTO public.fve_activo_caracterizacion')) {
        return {
          rowCount: 1,
          rows: [{ id_activo: 4, estado_datos: params[5], datos_tecnicos: JSON.parse(params[3]) }],
        };
      }
      if (normalized.includes('INSERT INTO public.audit_log')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`SQL inesperado: ${normalized}`);
    },
    release() {},
  };
  return { database: { connect: async () => client, query: (...args) => client.query(...args) }, queries };
}

test('valida solo campos actuales, sin aceptar tecnologia futura ni claves inventadas', () => {
  assert.match(validarDatosExistentes({ inventado: 12 }, campos).error, /no permitido/i);
  assert.match(validarDatosExistentes({ potencia_nueva_w: 9 }, campos).error, /no permitido/i);
  assert.match(validarDatosExistentes({ potencia_anterior_w: -2 }, campos).error, /no valido/i);
  assert.deepEqual(validarDatosExistentes(datosCompletos, campos).pendientes, []);
});
test('guardar caracterizacion completa crea auditoria y persiste datos actuales', async () => {
  const db = simularBD(); const res = respuesta();
  await createInventarioHandlers(db.database, acceso).guardar(solicitud(cuerpoValido), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.caracterizacion.estado_datos, 'completa');
  assert.deepEqual(res.body.caracterizacion.datos_tecnicos, datosCompletos);
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO public.audit_log')).length, 1);
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO public.fve_activo_caracterizacion')).length, 1);
});
test('guardar incompleto registra pendiente_datos sin inventar valores', async () => {
  const db = simularBD(); const res = respuesta();
  const body = { datos_tecnicos: { potencia_anterior_w: 60 } };
  await createInventarioHandlers(db.database, acceso).guardar(solicitud(body), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.caracterizacion.estado_datos, 'pendiente_datos');
  assert.deepEqual(res.body.caracterizacion.datos_tecnicos, { potencia_anterior_w: 60 });
});
test('rechaza empresa ajena antes de guardar o auditar', async () => {
  const db = simularBD(); const res = respuesta();
  await createInventarioHandlers(db.database, acceso).guardar(solicitud(cuerpoValido, '4', 12), res);
  assert.equal(res.code, 403);
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO')).length, 0);
});
test('rechaza id invalido sin consultar la base', async () => {
  const db = simularBD(); const res = respuesta();
  await createInventarioHandlers(db.database, acceso).guardar(solicitud(cuerpoValido, '-1'), res);
  assert.equal(res.code, 400);
  assert.equal(db.queries.length, 0);
});
test('rechaza campos arbitrarios sin guardar y sin auditar', async () => {
  const db = simularBD(); const res = respuesta();
  await createInventarioHandlers(db.database, acceso).guardar(solicitud({ datos_tecnicos: { inventado: true } }), res);
  assert.equal(res.code, 400);
  assert.equal(db.queries.filter(q => q.sql.includes('INSERT INTO')).length, 0);
});
