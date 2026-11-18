'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const orig=Module._load;
Module._load=function(request,parent,...rest){
 if(parent?.filename?.endsWith('fve.diagnosticoOrigen.controller.js')){
   if(request==='../db')return {};
   if(request==='../services/accesoMipyme')return {accesoMipyme:async()=>true};
 }
 return orig.call(this,request,parent,...rest);
};
const {crearControlador}=require('../controllers/fve.diagnosticoOrigen.controller');
Module._load=orig;
function res() {return {code:200,body:null,status(n){this.code=n;return this},json(v){this.body=v;return this}}}
function fake({existeProceso=true,acceso=true,existeDiag=true,seleccion=[4]}={}) {
  const llamadas=[];
  return {llamadas,acceso:async()=>acceso,db:{async query(q,args){llamadas.push({q,args});
    if(q.includes('FROM public.fve_proceso')) return {rowCount:existeProceso?1:0,rows:existeProceso?[{id_proceso:7,id_mipyme:12,id_diagnostico:24}]:[]};
    if(q.includes('FROM public.diagnostico'))return {rowCount:existeDiag?1:0,rows:existeDiag?[{id_diagnostico:24,id_mipyme:12,metricas:{activos_seleccionados:seleccion}}]:[]};
    throw Error('Consulta inesperada');
  }}};
}
const req={params:{idProceso:'7'},user:{id_usuario:9}};
test('Recupera diagnostico real aun sin snapshot FVE',async()=>{
 const f=fake(),r=res();await crearControlador(f).obtenerDiagnosticoOrigen(req,r);
 assert.equal(r.code,200);assert.equal(r.body.diagnostico.id_diagnostico,24);
 assert.equal(r.body.seleccion_guardada,true);
 assert.deepEqual(f.llamadas[1].args,[24,12]);
});
test('No inventa seleccion cuando no fue guardada',async()=>{
 const f=fake({seleccion:[]}),r=res();await crearControlador(f).obtenerDiagnosticoOrigen(req,r);
 assert.equal(r.body.seleccion_guardada,false);assert.equal(r.body.cantidad_activos_seleccionados,0);
});
test('No consulta diagnostico cuando el proceso no existe',async()=>{
 const f=fake({existeProceso:false}),r=res();await crearControlador(f).obtenerDiagnosticoOrigen(req,r);
 assert.equal(r.code,404);assert.equal(f.llamadas.length,1);
});
test('Bloquea la consulta de otra empresa',async()=>{
 const f=fake({acceso:false}),r=res();await crearControlador(f).obtenerDiagnosticoOrigen(req,r);
 assert.equal(r.code,403);assert.equal(f.llamadas.length,1);
});
test('Rechaza IDs invalidos y falta de autenticacion',async()=>{
 const f=fake();const h=crearControlador(f).obtenerDiagnosticoOrigen;
 const r1=res(),r2=res();await h({params:{idProceso:'-1'},user:{id_usuario:9}},r1);
 await h({params:{idProceso:'7'},user:{}},r2);
 assert.equal(r1.code,400);assert.equal(r2.code,401);assert.equal(f.llamadas.length,0);
});
test('Diagnostico ausente se informa, no se reconstruye ficticiamente',async()=>{
 const f=fake({existeDiag:false}),r=res();await crearControlador(f).obtenerDiagnosticoOrigen(req,r);
 assert.equal(r.code,404);
});
