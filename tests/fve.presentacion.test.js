'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {cargarDatosPresentacion}=require('../services/fvePresentacionDatos');
const {generarPresentacionEmpresa}=require('../services/fvePresentacionGenerador');

function crearDb({permitido=true}={}) {
  const consultas=[];
  const db={query:async(sql,params)=>{
    consultas.push({sql,params});
    if(sql.includes('AS permitido'))return {rows:[{permitido}]};
    if(sql.includes('FROM public.mipyme WHERE'))return {rows:[{id_mipyme:7,nombre_mipyme:'Hotel de ejemplo'}]};
    return {rows:[]};
  }};
  return {db,consultas};
}
test('rechaza empresa sin autorización, sin consultar registros privados',async()=>{
  const {db,consultas}=crearDb({permitido:false});
  await assert.rejects(cargarDatosPresentacion(db,7,40),e=>e.status===403);
  assert.equal(consultas.length,1);
});
test('filtra todas las lecturas a la empresa solicitada',async()=>{
  const {db,consultas}=crearDb();
  const datos=await cargarDatosPresentacion(db,7,40);
  assert.equal(datos.empresa.id_mipyme,7);
  assert.ok(consultas.filter(c=>!c.sql.includes('AS permitido')&&!c.sql.includes('FROM public.usuario WHERE')).every(c=>c.params[0]===7));
});
test('el generador crea un PPTX con su información y no necesita API ni BD',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fve_ppt_test_'));
  try {
    const datos={empresa:{id_mipyme:7,nombre_mipyme:'Empresa de prueba'},
      contactos:[],asesor:null,activos:[],facturas:[],evaluacion:null,preguntas:[],diagnosticos:[]};
    const salida=path.join(dir,'ejemplo.pptx');
    const r=await generarPresentacionEmpresa(datos,{rutaSalida:salida,uploads:dir});
    const archivo=fs.readFileSync(salida);
    assert.ok(r.diapositivas>=5);
    assert.ok(archivo.length>2000);
    assert.equal(archivo.subarray(0,2).toString('ascii'),'PK');
  }finally {fs.rmSync(dir,{force:true,recursive:true});}
});


test('worker_threads genera PPTX fuera del hilo principal',async()=>{
  const {Worker}=require('node:worker_threads');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fve_worker_test_'));
  try {
    const archivo=path.join(dir,'desde_worker.pptx');
    const datos={empresa:{id_mipyme:9,nombre_mipyme:'Ejemplo worker'},
      contactos:[],asesor:null,activos:[],facturas:[],evaluacion:null,preguntas:[],diagnosticos:[]};
    const resultado=await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(__dirname,'../services/fvePresentacionWorker.js'),
        {workerData:{datos,archivo,uploads:dir}});
      worker.on('message',m=>{
        if(m.tipo==='listo')resolve(m);
        if(m.tipo==='error')reject(new Error(m.error));
      });
      worker.on('error',reject);
      worker.on('exit',n=>{if(n!==0)reject(new Error('worker exit '+n));});
    });
    assert.ok(resultado.diapositivas>=5);
    assert.equal(fs.readFileSync(archivo).subarray(0,2).toString(),'PK');
  }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
