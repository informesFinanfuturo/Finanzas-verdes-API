'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load(relative, pool, overrides = {}) {
  const filename = path.join(__dirname, '..', relative);
  const mod = { exports: {} };
  const special = { '../db': pool, bcrypt: overrides.bcrypt || { hash: async () => 'hash-safe', compare: async () => true } };
  const resolve = (name) => Object.prototype.hasOwnProperty.call(special, name)
    ? special[name] : require(name);
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
    resolve, mod, mod.exports
  );
  return mod.exports;
}
function response() { return {
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
}; }

const basicReq = { user: { id_usuario: 22 }, ip: '127.0.0.1', get: () => 'test-agent' };

test('listado de proveedores usa filtros parametrizados y devuelve estructura esperada', async () => {
  const queries = [];
  const pool = { query: async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('AS total_proveedores') && !sql.includes('FROM public.item_catalogo i WHERE i.id_proveedor = p.id_proveedor\n  ) stats')) {
      return { rows: [{ total_proveedores: 2, proveedores_activos: 1, sin_usuario: 0, sin_productos: 1 }] };
    }
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1 }] };
    return { rows: [{ id_proveedor: 1, razon_social: 'A', tipos_proveedor: [] }] };
  } };
  const c = load('controllers/adminCompat.controller.js', pool);
  const res = response();
  await c.getProveedoresAdmin({ ...basicReq, query: { buscar: "prueba' OR TRUE --", pagina: '1', limite: '20' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.proveedores.length, 1);
  assert.equal(res.body.pagination.total_registros, 1);
  assert.equal(queries.length, 3);
  assert.ok(queries[1].params[0].includes("prueba' OR TRUE --"));
  assert.ok(!queries[1].sql.includes("prueba' OR TRUE --"));
});

test('listado de catalogo exige parametros validos', async () => {
  const c = load('controllers/adminCompat.controller.js', { query: async () => { throw Error('No debe consultar'); } });
  const res = response();
  await c.getCatalogoAdmin({ ...basicReq, query: { disponible: 'incorrecto' } }, res);
  assert.equal(res.statusCode, 400);
});

test('reset administrativo registra auditoria y no filtra contrasena en la auditoria', async () => {
  const statements = [];
  const client = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      if (sql.includes('SELECT id_usuario, estado, estado_acceso')) {
        return { rowCount: 1, rows: [{ estado: 'activo', estado_acceso: 'activo' }] };
      }
      return { rowCount: 1, rows: [] };
    }, release() {},
  };
  const c = load('controllers/adminCompat.controller.js', { connect: async () => client });
  const res = response();
  await c.resetUserPassword({ ...basicReq, params: { id: '32' }, body: { motivo: 'Usuario olvido clave' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.temporary_password.length >= 24);
  assert.ok(statements.some(x => x.sql.includes('must_change_password = TRUE')));
  const audit = statements.find(x => x.sql.includes('INSERT INTO public.audit_log'));
  assert.ok(audit);
  assert.ok(!JSON.stringify(audit.params).includes(res.body.temporary_password));
  assert.ok(statements.some(x => x.sql === 'COMMIT'));
});

test('reseteo no permite actuar sobre cuenta propia', async () => {
  const c = load('controllers/adminCompat.controller.js', { connect: async () => { throw Error('No debe conectar'); } });
  const res = response();
  await c.resetUserPassword({ ...basicReq, params: { id: '22' }, body: { motivo: 'Motivo valido' } }, res);
  assert.equal(res.statusCode, 409);
});

test('cambio de contrasena propia actualiza bandera y revoca token', async () => {
  const queries = [];
  const client = { query: async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('SELECT password_hash FROM public.usuario'))
      return { rowCount: 1, rows: [{ password_hash: 'old' }] };
    return { rowCount: 1, rows: [] };
  }, release() {} };
  const bcrypt = { hash: async () => 'newhash',
    compare: async (password) => password === 'old-pass' };
  const c = load('controllers/adminCompat.controller.js', { connect: async () => client }, { bcrypt });
  const res = response();
  await c.changeOwnPassword({ ...basicReq, body: {
    current_password: 'old-pass', new_password: 'Nueva1-ContraseNa!' ,
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(queries.some(x => x.sql.includes('must_change_password = FALSE')));
  assert.ok(queries.some(x => x.sql.includes('token_version = token_version + 1')));
});

test('endpoints administrativos protegen el orden y requieren administrador', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/catalogo.routes.js'), 'utf8');
  assert.ok(source.indexOf("router.get('/admin'") < source.indexOf("router.get('/:id'"));
  assert.ok(source.indexOf("router.get('/sync/history'") < source.indexOf("router.get('/sync/:id'"));
  assert.match(source, /router\.get\('\/admin', requireAdministrator, getCatalogoAdmin\)/);
  const providers = fs.readFileSync(path.join(__dirname, '../routes/proveedor.routes.js'), 'utf8');
  assert.match(providers, /router\.get\('\/admin', requireAdministrator, getProveedoresAdmin\)/);
  const users = fs.readFileSync(path.join(__dirname, '../routes/user.routes.js'), 'utf8');
  assert.match(users, /router\.post\('\/:id\/reset-password', requireAdministrator, resetUserPassword\)/);
  assert.match(users, /router\.put\('\/me\/password', changeOwnPassword\)/);
  assert.match(users, /router\.put\('\/password\/:id', requireAdministrator/);
});

test('los tokens anteriores se revocan y el login entrega la bandera obligatoria', () => {
  const login = fs.readFileSync(path.join(__dirname, '../controllers/login.controller.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '../middleware/auth.js'), 'utf8');
  assert.match(login, /must_change_password:\s*Boolean\(user\.must_change_password\)/);
  assert.match(login, /token_version:\s*Number\(user\.token_version/);
  assert.match(auth, /Number\(decoded\.token_version \?\? 0\) !== Number\(u\.token_version \?\? 0\)/);
  assert.match(auth, /u\.must_change_password && !isOwnPasswordChange/);
});

test('cambio de contrasena propia exige complejidad', async () => {
  const c = load('controllers/adminCompat.controller.js', {
    connect: async () => { throw Error('No debe conectar'); },
  });
  const res = response();
  await c.changeOwnPassword({ ...basicReq, body: {
    current_password: 'antigua', new_password: 'solo-minusculas-123',
  } }, res);
  assert.equal(res.statusCode, 400);
});

test('historial de sincronizaciones devuelve estructura de Flutter', async () => {
  const c = load('controllers/adminCompat.controller.js', {
    query: async (sql, params) => {
      assert.match(sql, /FROM public\.catalogo_sincronizacion/);
      assert.deepEqual(params, [20]);
      return { rows: [{ id_sincronizacion: '10', estado: 'completada' }] };
    },
  });
  const res = response();
  await c.getSyncHistory({ ...basicReq, query: { limite: '20' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sincronizaciones.length, 1);
});


test('reset rechaza usuario inactivo sin modificar contrasena', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('SELECT id_usuario, estado, estado_acceso'))
      return { rowCount: 1, rows: [{estado:'inactivo', estado_acceso:'inactivo'}] };
    return { rowCount: 1, rows: [] };
  }, release() {} };
  const c = load('controllers/adminCompat.controller.js', { connect: async () => client });
  const res = response();
  await c.resetUserPassword({ ...basicReq, params:{id:'40'}, body:{motivo:'Cuenta sin acceso'}}, res);
  assert.equal(res.statusCode, 409);
  assert.ok(!statements.some(sql => sql.includes('UPDATE public.usuario')));
});

test('cambio de contrasena rechaza actual incorrecta sin modificar datos', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('SELECT password_hash FROM public.usuario'))
      return { rowCount: 1, rows: [{password_hash:'actual-hash'}] };
    return { rowCount: 1, rows: [] };
  }, release() {} };
  const c = load('controllers/adminCompat.controller.js', { connect: async () => client }, {
    bcrypt: { compare: async () => false, hash: async () => 'otro-hash' },
  });
  const res = response();
  await c.changeOwnPassword({ ...basicReq, body:{current_password:'incorrecta',new_password:'Nueva1-ContraseNa!'}},res);
  assert.equal(res.statusCode, 401);
  assert.ok(!statements.some(sql => sql.includes('UPDATE public.usuario')));
});

test('la contrasena permite comillas como caracter especial igual que Flutter', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('SELECT password_hash FROM public.usuario'))
      return {rowCount:1,rows:[{password_hash:'hash-viejo'}]};
    return {rowCount:1,rows:[]};
  }, release() {} };
  const c=load('controllers/adminCompat.controller.js',{connect:async()=>client},{
    bcrypt:{compare:async (given)=>given==='Anterior1!',hash:async()=> 'hash-nuevo'}
  });
  const res=response();
  await c.changeOwnPassword({...basicReq,body:{current_password:'Anterior1!',new_password:'NuevaClave1"'}},res);
  assert.equal(res.statusCode,200);
  assert.ok(statements.includes('COMMIT'));
});
