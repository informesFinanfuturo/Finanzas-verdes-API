'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Carga el archivo REAL del parche y sustituye dependencias externas, sin DB real.
function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const mod = { exports: {} };
  const mockRequire = (name) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name];
    if (name.startsWith('./') || name.startsWith('../')) {
      return require(path.resolve(path.dirname(filename), name));
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', 'process', fs.readFileSync(filename, 'utf8'))(
    mockRequire, mod, mod.exports, process
  );
  return mod.exports;
}
function res() {
  return { code: 200, body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}
const policy = load('services/adminPolicy.js');

test('Administrador y Super Administrador tienen la misma clase de autoridad', () => {
  for (const name of ['Administrador', 'administrador', 'Super Administrador', 'super administrador']) {
    assert.equal(policy.isAdministrator(name), true);
  }
  for (const name of ['Asesor', 'Cliente', 'Proveedor', '', null, 'Administrador falsificado']) {
    assert.equal(policy.isAdministrator(name), false);
  }
});

test('middleware administrativo admite cualquiera de los dos roles, solo si la BD lo confirma', async () => {
  let currentRole = 'Administrador';
  const pool = { async query() { return { rowCount: 1, rows: [{ id_rol: 7, nombre_rol: currentRole }] }; } };
  const middleware = load('middleware/requireAdministrator.js', {'../db': pool});
  for (const role of ['Administrador','Super Administrador']) {
    currentRole = role;
    const response = res(); let nextCount=0;
    await middleware({user:{id_usuario:12,nombre_rol:'Cliente'}},response,()=>nextCount++);
    assert.equal(nextCount,1); assert.equal(response.code,200);
  }
  currentRole='Asesor';
  const response=res();let nextCount=0;
  await middleware({user:{id_usuario:12,nombre_rol:'Super Administrador'}},response,()=>nextCount++);
  assert.equal(nextCount,0);assert.equal(response.code,403);
});

test('middleware administrativo falla cerrado si el usuario no esta en BD', async () => {
  const middleware = load('middleware/requireAdministrator.js', {'../db': {query:async()=>({rowCount:0,rows:[]})}});
  const response=res(); let nextCount=0;
  await middleware({user:{id_usuario:1}},response,()=>nextCount++);
  assert.equal(response.code,403);assert.equal(nextCount,0);
});

test('requirePermissions otorga el MISMO acceso funcional a ambos admins', async () => {
  const pool={query:async()=>{throw new Error('No debe depender de permiso_rol para admins');}};
  const middleware = load('middleware/requirePermissions.js', {'../db':pool})(['Acceso especial']);
  for (const role of ['Administrador','Super Administrador']) {
    let nextCount=0;const response=res();
    await middleware({user:{id_usuario:1,id_rol:3,nombre_rol:role}},response,()=>nextCount++);
    assert.equal(nextCount,1);assert.equal(response.code,200);
  }
});

test('requirePermissions no concede permisos a un asesor si no los tiene',async()=>{
  const pool={query:async()=>({rows:[{nombre:'Ver reportes'}]})};
  const middleware=load('middleware/requirePermissions.js', {'../db':pool})(['Editar usuarios']);
  const response=res();let nextCount=0;
  await middleware({user:{id_usuario:3,id_rol:4,nombre_rol:'Asesor'}},response,()=>nextCount++);
  assert.equal(response.code,403);assert.equal(nextCount,0);
});

test('auth verifica rol y estado vigentes en PostgreSQL en lugar del JWT',async()=>{
  const pool={query:async()=>({rows:[{
    id_usuario:5,id_rol:17,nombre_rol:'Asesor',estado:'activo',estado_acceso:'activo',estado_rol:'activo',locked_until:null
  }]})};
  const auth=load('middleware/auth.js',{
    'jsonwebtoken':{verify:()=>({id_usuario:5,id_rol:1,nombre_rol:'Super Administrador'})},
    '../db':pool,
  });
  const req={headers:{authorization:'Bearer prueba'}};const response=res();let called=0;
  await auth(req,response,()=>called++);
  assert.equal(called,1);assert.equal(req.user.id_rol,17);assert.equal(req.user.nombre_rol,'Asesor');
});

test('auth rechaza la cuenta inactiva aunque el token sea valido',async()=>{
  const pool={query:async()=>({rows:[{
    id_usuario:5,id_rol:1,nombre_rol:'Administrador',estado:'inactivo',estado_acceso:'activo',estado_rol:'activo'
  }]})};
  const auth=load('middleware/auth.js',{
    'jsonwebtoken':{verify:()=>({id_usuario:5,id_rol:1})},'../db':pool,
  });
  const response=res();let called=0;
  await auth({headers:{authorization:'Bearer prueba'}},response,()=>called++);
  assert.equal(response.code,401);assert.equal(called,0);
});

test('no se degrada ni desactiva al ultimo administrador activo',async()=>{
  const current={id_usuario:22,id_rol:2,nombre_rol:'Super Administrador',estado:'activo',estado_acceso:'activo',estado_rol:'activo'};
  const db={query:async(sql)=>{
    if(sql.includes('SELECT nombre_rol, estado'))return {rowCount:1,rows:[{nombre_rol:'Asesor',estado:'activo'}]};
    return {rows:[{total:0}]};
  }};
  await assert.rejects(policy.assertKeepsLastAdministrator(db,current,5,'activo'), {httpStatus:409});
  await assert.rejects(policy.assertKeepsLastAdministrator(db,current,2,'inactivo'), {httpStatus:409});
  await assert.doesNotReject(policy.assertKeepsLastAdministrator(db,current,2,'activo'));
});

test('degradar un admin es posible si otro administrador permanece activo',async()=>{
  const current={id_usuario:22,id_rol:2,nombre_rol:'Administrador',estado:'activo',estado_acceso:'activo',estado_rol:'activo'};
  const db={query:async(sql)=>sql.includes('SELECT nombre_rol, estado')
    ?{rowCount:1,rows:[{nombre_rol:'Cliente',estado:'activo'}]}
    :{rows:[{total:1}]}};
  await assert.doesNotReject(policy.assertKeepsLastAdministrator(db,current,5,'activo'));
});

test('todas las rutas que CAMBIAN roles, permisos y usuarios exigen administrador',()=>{
  const routes=['routes/rol.routes.js','routes/permission.routes.js',
    'routes/user.routes.js','routes/asesor.routes.js'];
  for (const file of routes) {
    const actions=[];
    const middleware=()=>{};
    const requireAdministrator=()=>{};
    const router={get(...args){actions.push(['get',args]);},post(...args){actions.push(['post',args]);},
      patch(...args){actions.push(['patch',args]);},put(...args){actions.push(['put',args]);}};
    load(file,{
      express:{Router:()=>router},
      '../middleware/requirePermissions':()=>middleware,
      '../middleware/requireAdministrator':requireAdministrator,
      '../controllers/rol.controller':new Proxy({}, {get:()=>()=>{}}),
      '../controllers/permission.controller':new Proxy({}, {get:()=>()=>{}}),
      '../controllers/user.controller':new Proxy({}, {get:()=>()=>{}}),
      '../controllers/asesor.controller':new Proxy({}, {get:()=>()=>{}}),
    });
    const updates=actions.filter(([m,args])=>['post','patch'].includes(m));
    assert.ok(updates.length>0,file);
    for (const [,args] of updates) assert.ok(args.includes(requireAdministrator),file+': '+args[0]);
  }
});

test('actualizacion de usuario rechaza la degradacion del ultimo administrador',async()=>{
  const current={id_usuario:22,id_rol:2,nombre_rol:'Administrador',email:'a@b.co',estado:'activo',estado_acceso:'activo',estado_rol:'activo'};
  let didUpdate=false,rolledBack=false;
  const connection={async query(sql){
    if(sql.startsWith('SELECT u.id_usuario, u.email'))return{rowCount:1,rows:[current]};
    if(sql.startsWith('SELECT id_rol, nombre_rol'))return{rowCount:1,rows:[{id_rol:6,nombre_rol:'Asesor'}]};
    if(sql.startsWith('SELECT nombre_rol, estado'))return{rowCount:1,rows:[{nombre_rol:'Asesor',estado:'activo'}]};
    if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:0}]};
    if(sql.includes('UPDATE usuario')) didUpdate=true;
    if(sql==='ROLLBACK')rolledBack=true;
    return{rowCount:1,rows:[]};
  }, release(){}};
  const pool={connect:async()=>connection};
  const controller=load('controllers/user.controller.js',{'../db':pool,
    'jsonwebtoken':{},'bcrypt':{hash:async()=>''}});
  const response=res();
  await controller.updateUser({params:{id:'22'},user:{id_usuario:22},body:{id_rol:6},ip:'127.0.0.1'},response);
  assert.equal(response.code,409);assert.equal(rolledBack,true);assert.equal(didUpdate,false);
});

test('Flutter usa el mismo dashboard y paginas para Administrador y Super Administrador',()=>{
 const routes=fs.readFileSync(path.resolve(__dirname,'../../flutter/lib/app/routes/appRouter.dart'),'utf8');
 const controls=fs.readFileSync(path.resolve(__dirname,'../../flutter/lib/controllers/GeneralContoller.dart'),'utf8');
 assert.match(routes,/name:\s*Routes\.dashboardSuperAdmin,\s*(?:\/\/[^\n]*\n\s*)*page:\s*\(\) => const Dashboardadmin\(\)/);
 assert.match(controls,/case "super administrador":\s*(?:\/\/[^\n]*\n\s*)*return adminRoutes;/);
});

test('roles administrativos reservados no pueden desactivarse ni renombrarse',async()=>{
 const pool={query:async(sql)=>{
   if(sql.startsWith('SELECT id_rol, nombre_rol, estado'))return {rows:[{id_rol:1,nombre_rol:'Administrador',estado:'activo'}]};
   throw new Error('No debio hacer UPDATE del rol administrativo');
 }};
 const c=load('controllers/rol.controller.js',{'../db':pool,'jsonwebtoken':{}});
 for(const body of [{estado:'inactivo'},{nombre_rol:'Asesor'}]) {
   const response=res();await c.updateRol({params:{id:1},body},response);
   assert.equal(response.code,409);
 }
});

test('no se pueden quitar permisos individualmente a los roles administrativos',async()=>{
 const pool={query:async()=>({rows:[{nombre_rol:'Super Administrador'}],rowCount:1})};
 const c=load('controllers/rol.controller.js',{'../db':pool,'jsonwebtoken':{}});
 const response=res();
 await c.togglePermisoRol({body:{id_rol:1,id_permiso:3}},response);
 assert.equal(response.code,409);
});

test('un permiso nuevo se vincula a ambos roles administrativos al crearse',async()=>{
 const queries=[];
 const db={async query(sql){queries.push(sql);
   if(sql.includes('INSERT INTO public.permiso ('))return {rows:[{id_permiso:3,nombre:'Listar'}]};
   return {rowCount:1,rows:[]};},release(){}};
 const pool={connect:async()=>db};
 const c=load('controllers/permission.controller.js',{'../db':pool});
 const response=res();await c.createPermission({body:{nombre:'Listar'}},response);
 assert.equal(response.code,201);
 assert.ok(queries.some(sql=>sql.includes("('administrador', 'super administrador')")));
 assert.ok(queries.includes('COMMIT'));
});
