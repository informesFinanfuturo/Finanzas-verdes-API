'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
// Las dependencias de PostgreSQL no se necesitan para probar los controladores con DB simulada.
const carga=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='../db'&&parent?.filename?.endsWith('fve.negociacion.controller.js'))return {};
  if(request==='../services/accesoMipyme'&&parent?.filename?.endsWith('fve.negociacion.controller.js'))
    return {accesoMipyme:async()=>true};
  if(request==='../services/fveSeleccionValidaciones'&&parent?.filename?.endsWith('fve.negociacion.controller.js'))
    return {verificarCompatibilidad:()=>true};
  return carga.call(this,request,parent,isMain);
};
const {crearControlador}=require('../controllers/fve.negociacion.controller');
Module._load=carga;
function respuesta(){return{code:200,data:null,status(n){this.code=n;return this;},json(x){this.data=x;return this;}};}
function req(body={},role='Asesor'){return{params:{idProceso:'7'},user:{id_usuario:6,nombre_rol:role},body};}
function falsaDB({paso=3,autorizado=true,finalizado=false,lineas=false}={}){
 const estado={peticiones:[],rollback:false};
 const db={query:async(sql,params=[])=>{
  estado.peticiones.push(sql);
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
    if(sql==='ROLLBACK')estado.rollback=true;
    return{rowCount:0,rows:[]};
  }
  if(sql.includes('FROM public.fve_proceso p'))return {rowCount:1,rows:[{
    id_proceso:7,id_mipyme:4,id_diagnostico:24,paso_actual:paso,
    version_flujo:8,diagnostico_estado:'activo',nombre_mipyme:'Restaurante prueba',estado:'en_preparacion',
  }]};
  if(sql.includes('FROM public.fve_cierre_negociacion WHERE id_proceso=$1'))
    return{rowCount:finalizado?1:0,rows:finalizado?[{id_cierre:2}]:[]};
  if(sql.includes('FROM public.fve_seleccion_linea s'))return{rowCount:0,rows:[]};
  if(sql.includes('count(*)::integer AS n FROM public.fve_seleccion_linea'))return{rowCount:1,rows:[{n:0}]};
  if(sql.includes('FROM public.fve_propuesta_version')&&sql.includes("estado='presentada'"))
    return {rowCount:1,rows:[{id_propuesta:2,id_proceso:7,numero_version:1,estado:'presentada',total_inversion:'1000',
      detalle:{lineas:[{estado_ambiental:'pendiente_dato'}]}}]};
  if(sql.includes('FROM public.fve_financiamiento_propuesta')&&sql.includes('WHERE id_propuesta'))
    return {rowCount:1,rows:[{recursos_propios:'0',credito_solicitado:'1000'}]};
  if(sql.includes('SELECT decision FROM public.fve_decision_propuesta'))return {rowCount:1,rows:[{decision:'interesado'}]};
  if(sql.includes('SELECT estado FROM public.fve_viabilidad_propuesta'))return {rowCount:1,rows:[{estado:'viable'}]};
  if(sql.includes('SELECT d.* FROM public.diagnostico d'))return {rowCount:1,rows:[{id_diagnostico:24,id_mipyme:4,metricas:{}}]};
  return {rowCount:0,rows:[]};
 },connect:async()=>({query:(s,p)=>db.query(s,p),release(){}})};
 return {db,estado,autorizado};
}
test('deniega un proceso de ID invalido antes de consultar',async()=>{
 const f=falsaDB();const c=crearControlador({db:f.db,acceso:async()=>true});
 const r=respuesta();await c.prepararPropuesta({...req(),params:{idProceso:'invalid'}},r);
 assert.equal(r.code,400);assert.equal(f.estado.peticiones.length,0);
});
test('el diagnostico de origen se lee de la tabla real y no del snapshot',async()=>{
 const f=falsaDB();const c=crearControlador({db:f.db,acceso:async()=>true});
 const r=respuesta();await c.diagnosticoOrigen(req(),r);
 assert.equal(r.code,200);assert.equal(r.data.diagnostico.id_diagnostico,24);
});
test('prohibe acceso a la negociacion de una empresa ajena',async()=>{
 const f=falsaDB();const c=crearControlador({db:f.db,acceso:async()=>false});
 const r=respuesta();await c.diagnosticoOrigen(req(),r);
 assert.equal(r.code,403);
});
test('no genera una propuesta sin activos confirmados',async()=>{
 const f=falsaDB({paso:3});const c=crearControlador({db:f.db,acceso:async()=>true});
 const r=respuesta();await c.prepararPropuesta(req(),r);
 assert.equal(r.code,422);assert.equal(f.estado.rollback,true);
});
test('protege de modificar una negociacion ya cerrada',async()=>{
 const f=falsaDB({finalizado:true});const c=crearControlador({db:f.db,acceso:async()=>true});
 const r=respuesta();await c.prepararPropuesta(req(),r);
 assert.equal(r.code,409);assert.equal(f.estado.rollback,true);
});
test('asesor no puede registrar aprobacion crediticia',async()=>{
 const f=falsaDB({paso:7});const c=crearControlador({db:f.db,acceso:async()=>true});
 const r=respuesta();await c.viabilidad(req({estado_credito:'aprobado',monto_credito_aprobado:1000,referencia_soporte:'AP-222'}),r);
 assert.equal(r.code,403);assert.match(r.data.error,/Administracion/);
});
test('no cierra FVE como verde cuando faltan evaluaciones elegibles',async()=>{
 const f=falsaDB({paso:8});const c=crearControlador({db:f.db,acceso:async()=>true});
 const r=respuesta();await c.aceptar(req(),r);
 assert.equal(r.code,422);assert.match(r.data.error,/evaluaciones elegibles/);
});
