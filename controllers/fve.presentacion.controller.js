'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');
const { cargarDatosPresentacion } = require('../services/fvePresentacionDatos');
const trabajos = new Map();
const TTL = 15 * 60 * 1000;
const LIMITE_MS = 4 * 60 * 1000;
const MAX_ARCHIVO = 60 * 1024 * 1024;
const idSeguro = x => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x);
const limpiar = () => {
  const ahora=Date.now();
  for (const [id, t] of trabajos) {
    if (t.terminado && ahora-t.terminado>TTL) {
      if(t.archivo)fs.promises.unlink(t.archivo).catch(()=>{});
      trabajos.delete(id);
    }
  }
};
setInterval(limpiar, 60 * 1000).unref();
const nombreSeguro = (nombre,id) => `FVE_${String(nombre||'Empresa').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,55)}_${id}.pptx`;
const serializar = t => ({id:t.id,estado:t.estado,etapa:t.etapa,
    diapositivas:t.diapositivas ?? null,advertencias:t.advertencias||[]});

async function ejecutar(t) {
  try {
    t.estado='preparando';t.etapa='Consultando registros';
    const db=await pool.connect();
    let datos;
    try {
      await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      datos=await cargarDatosPresentacion(db,t.empresa,t.usuario);
      if (Buffer.byteLength(JSON.stringify(datos),'utf8') > 12 * 1024 * 1024) {
        const e = new Error('Los datos del informe exceden el limite seguro para una sola exportacion.');
        e.status = 413; throw e;
      }
      await db.query('COMMIT');
    }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
    finally{db.release();}
    t.nombre=nombreSeguro(datos.empresa.nombre_mipyme,t.empresa);
    t.estado='procesando';t.etapa='Construyendo PowerPoint';
    const archivo=path.join(os.tmpdir(),`fve_${t.id}.pptx`);
    t.archivo=archivo;
    const worker = new Worker(path.join(__dirname,'../services/fvePresentacionWorker.js'), {
      workerData:{datos,archivo,uploads:path.join(__dirname,'../uploads')},
      resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:64},
    });
    let resolvio=false;
    const terminar = (error, resultado) => {
      if(resolvio)return; resolvio=true;
      clearTimeout(t.temporizador);
      if(error){t.estado='error';t.etapa=String(error.message||error).slice(0,350);
        fs.promises.unlink(archivo).catch(()=>{});t.archivo=null;
      }else{t.estado='listo';t.etapa='Presentacion disponible';
        t.diapositivas=resultado?.diapositivas;
        t.advertencias=resultado?.advertencias||[];}
      t.terminado=Date.now();
    };
    t.temporizador=setTimeout(()=>{terminar(new Error('Se supero el tiempo maximo de generacion.'));worker.terminate();},LIMITE_MS);
    worker.on('message',m=>{
      if(m?.tipo==='avance')t.etapa=String(m.etapa||'Generando').slice(0,100);
      else if(m?.tipo==='listo')terminar(null,m);
      else if(m?.tipo==='error')terminar(new Error(m.error||'Error de generacion'));
    });
    worker.once('error', e=>terminar(e));
    worker.once('exit', code=>{if(!resolvio)terminar(new Error(`Generador termino inesperadamente (${code}).`));});
  }catch(e){
    console.error('[FVE PPTX] Preparacion:',e);
    t.estado='error';
    t.etapa=e?.status ? String(e.message).slice(0,350) : 'No fue posible consultar todos los registros de esta empresa. Revisa los logs de la API.';
    t.terminado=Date.now();
  }
}

async function iniciar(req,res) {
  limpiar();
  const empresa=Number(req.params.idMipyme), usuario=Number(req.user?.id_usuario);
  if(!Number.isSafeInteger(empresa)||empresa<=0)return res.status(400).json({error:'Empresa invalida'});
  try {
    if(!await accesoMipyme(pool,empresa,usuario))return res.status(403).json({error:'Empresa no autorizada'});
    const mismo=[...trabajos.values()].find(t=>t.usuario===usuario&&t.empresa===empresa&&!t.terminado);
    if(mismo)return res.status(202).json(serializar(mismo));
    if([...trabajos.values()].some(t=>!t.terminado))return res.status(429).json({error:'Ya se genera una presentacion. Intenta nuevamente en unos minutos.'});
    const id=crypto.randomUUID();
    const t={id,empresa,usuario,estado:'en_cola',etapa:'Iniciando',terminado:null,
      archivo:null,advertencias:[]};
    trabajos.set(id,t);
    res.set('Cache-Control','no-store').status(202).json(serializar(t));
    // Ejecutar despues de responder; consultas SQL son no bloqueantes, el PPTX se realiza en Worker.
    setImmediate(()=>{ejecutar(t).catch(e=>{t.estado='error';t.etapa=String(e.message||e);t.terminado=Date.now();});});
  }catch(e){console.error('[FVE PPTX] Inicio:',e);return res.status(503).json({error:'No se pudo iniciar exportacion'});}
}
function propio(req,res) {
  const id=req.params.idTrabajo;
  if(!idSeguro(id)) {res.status(404).json({error:'Exportacion no encontrada'});return null;}
  const t=trabajos.get(id);
  if(!t||t.usuario!==Number(req.user?.id_usuario)){res.status(404).json({error:'Exportacion no encontrada'});return null;}
  return t;
}
function estado(req,res) {
  limpiar();const t=propio(req,res);if(!t)return;
  return res.set('Cache-Control','no-store').json(serializar(t));
}
async function descargar(req,res) {
  limpiar();const t=propio(req,res);if(!t)return;
  if(t.estado!=='listo'||!t.archivo)return res.status(409).json({error:'Presentacion aun no disponible'});
  try {
    // Revalidar autorización, inclusive si el usuario perdió acceso mientras se generaba.
    if(!await accesoMipyme(pool,t.empresa,t.usuario))return res.status(403).json({error:'Acceso revocado'});
    const st=await fs.promises.stat(t.archivo);
    if(st.size<=0||st.size>MAX_ARCHIVO)return res.status(413).json({error:'El archivo excede el limite seguro'});
    res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
      'Content-Type':'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
    return res.download(t.archivo,t.nombre);
  }catch(e){console.error('[FVE PPTX] Descarga:',e);return res.status(404).json({error:'Archivo temporal no disponible'});}
}
module.exports={iniciar,estado,descargar};
