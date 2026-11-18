'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
// Inyectar pg ficticio solo cuando se ejecuta fuera del proyecto real.
const Module=require('node:module'),load=Module._load;
Module._load=function(mod,p,...rest){
  if(mod==='pg' && process.env.FVE_TEST_PG_STUB==='1') return {Pool:class {query(){throw new Error('pool real no disponible')}}};
  return load.call(this,mod,p,...rest);
};
const {crearControlador}=require('../services/diagnosticoVinculos');
const {crearObtenerAlternativas}=require('../services/diagnosticoAlternativas');
const {contextoSeleccion}=require('../services/fveSeleccionValidaciones');
Module._load=load;
function respuesta(){return {statusCode:200,payload:null,status(n){this.statusCode=n;return this},json(v){this.payload=v;return this}}}
const reqBase={params:{idDiagnostico:'24',idActivo:'900'},user:{id_usuario:7},body:{}};
function database({acceso=true,duplicado=false,esCrear=false}={}){
  const llamadas=[];let updated=null, inserts=0;
  const snap={id_activo:900,nombre_activo:'Nevera vieja',producto_recomendado:{id_item:12}};
  const metricas={activos:duplicado?[snap,{...snap}]:[snap],activos_seleccionados:[900],alternativas_seleccionadas:[{id_activo:900,id_item:12,fuente:'usuario'}]};
  const connection={async query(sql,args){
    llamadas.push({sql,args});
    if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT') return {rows:[],rowCount:0};
    if(sql.includes('FROM public.diagnostico'))return {rowCount:1,rows:[{id_mipyme:3,estado:'activo',metricas}]};
    if(sql.includes('SELECT 1 FROM public.activo'))return {rowCount:0,rows:[]};
    if(sql.includes('INSERT INTO public.activo')){inserts++;return {rowCount:1,rows:[{id_activo:314}]}}
    if(sql.includes('SELECT id_activo,nombre,tipo FROM public.activo'))return {rowCount:1,rows:[{id_activo:28,nombre:'Nevera vieja',tipo:'Neveras'}]};
    if(sql.includes('UPDATE public.diagnostico')){
      updated=JSON.parse(args[1]);return {rowCount:1,rows:[{id_diagnostico:24,metricas:updated}]};
    }
    if(sql.includes('SELECT id_activo,nombre,tipo,marca,modelo,cantidad'))return {rowCount:2,rows:[
      {id_activo:28,nombre:'Nevera vieja',tipo:'Neveras'},
      {id_activo:31,nombre:'Nevera vieja',tipo:'Neveras'},
      {id_activo:9,nombre:'Horno',tipo:'Hornos'}]};
    if(sql.includes('SELECT id_activo, id_mipyme, nombre, tipo, marca, modelo, cantidad'))return {rowCount:0,rows:[]};
    if(sql.includes('FROM public.item_catalogo'))throw Error('NO consultar catalogo si falta inventario');
    throw Error('Consulta inesperada: '+sql);
  },release(){}};
  return {db:{query:connection.query.bind(connection),connect:async()=>connection},acceso:async()=>acceso,
    get calls(){return llamadas}, get updated(){return updated},get inserts(){return inserts},metricas};
}
test('GET: diagnostico con referencia huerfana pide vinculacion, no inventa id',async()=>{
  const f=database();const res=respuesta();
  const h=crearObtenerAlternativas({db:f.db,accesoMipyme:f.acceso});
  await h({params:reqBase.params,user:reqBase.user},res);
  assert.equal(res.statusCode,409);assert.equal(res.payload.codigo,'ACTIVO_SIN_VINCULO');
  assert.deepEqual(res.payload.opciones.map(o=>o.id_activo),[28,31]);
  assert.equal(f.updated,null);assert.equal(f.inserts,0);
});
test('POST: no hace cambios sin eleccion explicita',async()=>{
  const f=database();const res=respuesta();
  await crearControlador({db:f.db,acceso:f.acceso}).vincular(reqBase,res);
  assert.equal(res.statusCode,400);assert.equal(f.calls.length,0);
});
test('POST: rechaza acceso ajeno a empresa',async()=>{
  const f=database({acceso:false});const res=respuesta();
  await crearControlador({db:f.db,acceso:f.acceso}).vincular({...reqBase,body:{id_activo_real:28}},res);
  assert.equal(res.statusCode,403);assert.equal(f.updated,null);
});
test('POST: si hay dos referencias historicas iguales no enlaza silenciosamente',async()=>{
  const f=database({duplicado:true});const res=respuesta();
  await crearControlador({db:f.db,acceso:f.acceso}).vincular({...reqBase,body:{id_activo_real:28}},res);
  assert.equal(res.statusCode,409);assert.equal(f.updated,null);
});
test('POST: vinculo explicitamente elegido reescribe solo metricas del diagnostico',async()=>{
  const f=database();const res=respuesta();
  await crearControlador({db:f.db,acceso:f.acceso}).vincular({...reqBase,body:{id_activo_real:28}},res);
  assert.equal(res.statusCode,200);assert.equal(res.payload.id_activo_real,28);
  assert.equal(f.updated.activos[0].id_activo,28);
  assert.equal(f.updated.activos[0].id_activo_original,900);
  assert.deepEqual(f.updated.activos_seleccionados,[28]);
  assert.equal(f.updated.alternativas_seleccionadas[0].id_activo,28);
  assert.equal(f.updated.activos[0].vinculacion_inventario.accion,'vinculo_explicito');
  assert.equal(f.inserts,0);
});
test('POST: registro nuevo solo con consentimiento expreso, sin datos tecnicos inventados',async()=>{
  const f=database();const res=respuesta();
  await crearControlador({db:f.db,acceso:f.acceso}).vincular({...reqBase,body:{crear_desde_diagnostico:true}},res);
  assert.equal(res.statusCode,200);assert.equal(f.inserts,1);
  assert.equal(f.updated.activos[0].id_activo,314);
  const q=f.calls.find(x=>x.sql.includes('INSERT INTO public.activo'));
  assert.equal(q.args[0],'Nevera vieja');assert.equal(q.args[1],'Neveras');
});
test('FVE sin lineas guardadas prioriza seleccion reparada, no snapshot obsoleto',()=>{
  const snapshot={diagnostico:{metricas:{activos_seleccionados:[900],alternativas_seleccionadas:[{id_activo:900,id_item:12}]}}};
  const actual={activos_seleccionados:[28],alternativas_seleccionadas:[{id_activo:28,id_item:12}]};
  const lineas=contextoSeleccion(snapshot,actual);
  assert.equal(lineas[0].id_activo,28);assert.equal(lineas[0].id_item,12);
  assert.equal(snapshot.diagnostico.metricas.activos_seleccionados[0],900);
});
test('POST: no cambia IDs si los datos estan desactualizados',async()=>{
  const f=database();const res=respuesta();
  await crearControlador({db:f.db,acceso:f.acceso}).vincular({...reqBase,params:{idDiagnostico:'24',idActivo:'987'},body:{id_activo_real:28}},res);
  assert.equal(res.statusCode,409);assert.equal(f.updated,null);
});
