'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
 claseActivo, claseProducto, alternativasCompatibles, crearObtenerAlternativas
} = require('../services/diagnosticoAlternativas');

function respuesta() {
 return {
  code: 200, data: null,
  status(n) { this.code=n; return this; },
  json(value) { this.data=value; return this; }
 };
}
const id = {idDiagnostico:'21',idActivo:'14'};
function prueba({metricas={activos:[{id_activo:14}]}, acceso=true, activoTipo='Neveras', activoNombre='Nevera 2', catalogo=[]}={}) {
 const consultas=[];
 const db={async query(sql,params) {
  consultas.push({sql,params});
  if (sql.includes('FROM public.diagnostico')) return {rowCount:1,rows:[{id_mipyme:3,metricas}]};
  if (sql.includes('FROM public.activo')) return {rowCount:1,rows:[{id_activo:14,id_mipyme:3,tipo:activoTipo,nombre:activoNombre,cantidad:1}]};
  if (sql.includes('FROM public.item_catalogo')) return {rowCount:catalogo.length,rows:catalogo};
  throw Error('Consulta inesperada');
 }};
 const accesoMipyme=async()=>acceso;
 const handler=crearObtenerAlternativas({db,accesoMipyme});
 return {handler,consultas};
}
const producto=(name,tipo='Electrodoméstico',id=2)=>({id_item:id,tipo_item:tipo,nombre:name,id_proveedor:1,nombre_proveedor:'Proveedor Prueba',disponible:true});

test('clasifica neveras y productos de categoria generica por su nombre',()=>{
 assert.equal(claseActivo({tipo:'Neveras'}),'nevera');
 assert.equal(claseProducto(producto('Nevera No Frost 267 L')),'nevera');
 assert.equal(claseProducto(producto('Licuadora Industrial')),'licuadora');
});
test('evita confundir microondas y hornos',()=>{
 assert.equal(claseActivo({tipo:'Hornos',nombre:'microondas 1'}),'microondas');
 assert.equal(claseProducto(producto('Horno a gas','Horno')),'horno');
 assert.equal(claseProducto(producto('Microondas industrial','Horno')),'microondas');
});
test('excluye servicios de mantenimiento',()=>{
 assert.equal(claseProducto(producto('Mantenimiento de nevera','Servicio')),null);
});
test('no equipara climatizacion ambigua con aire acondicionado',()=>{
 assert.equal(claseActivo({tipo:'Climatización',nombre:'Equipo sin referencia'}),null);
});
test('filtra alternativas compatibles sin suponer ahorros',()=>{
 const ok=alternativasCompatibles({tipo:'Neveras'},[producto('Nevera 267 L'),producto('Horno')]);
 assert.equal(ok.length,1);
 assert.equal(ok[0].nombre,'Nevera 267 L');
});
test('valida IDs antes de consultar la BD',async()=>{
 const {handler,consultas}=prueba();const res=respuesta();
 await handler({params:{...id,idActivo:'abc'},user:{id_usuario:7}},res);
 assert.equal(res.code,400);assert.equal(consultas.length,0);
});
test('no consulta el catalogo sin autorizacion',async()=>{
 const {handler,consultas}=prueba({acceso:false}); const res=respuesta();
 await handler({params:id,user:{id_usuario:7}},res);
 assert.equal(res.code,403);assert.equal(consultas.length,1);
});
test('rechaza activo no vinculado al diagnostico',async()=>{
 const {handler,consultas}=prueba({metricas:{activos:[{id_activo:15}]}});const res=respuesta();
 await handler({params:id,user:{id_usuario:7}},res);
 assert.equal(res.code,404);assert.equal(consultas.length,1);
});
test('retorna proveedor, tipo y precio para la seleccion',async()=>{
 const {handler,consultas}=prueba({catalogo:[producto('Nevera No Frost'),producto('Horno')]});const res=respuesta();
 await handler({params:id,user:{id_usuario:7}},res);
 assert.equal(res.code,200);assert.equal(res.data.alternativas.length,1);
 assert.equal(res.data.alternativas[0].proveedor.nombre,'Proveedor Prueba');
 assert.equal(consultas.length,3);
});
test('un activo ambiguo retorna lista vacia sin consultar el catalogo',async()=>{
 const {handler,consultas}=prueba({activoTipo:'Otro',activoNombre:'Equipo sin referencia'});const res=respuesta();
 await handler({params:id,user:{id_usuario:7}},res);
 assert.equal(res.code,200);assert.equal(res.data.alternativas.length,0);
 assert.equal(consultas.length,2);
});
