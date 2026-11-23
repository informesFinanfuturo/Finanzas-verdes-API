'use strict';
const {parentPort,workerData}=require('worker_threads');
const {generarPresentacionEmpresa}=require('./fvePresentacionGenerador');
(async()=>{
  try {
    const resultado=await generarPresentacionEmpresa(workerData.datos,{
      rutaSalida:workerData.archivo,uploads:workerData.uploads,
      progreso:etapa=>parentPort.postMessage({tipo:'avance',etapa}),
    });
    parentPort.postMessage({tipo:'listo',...resultado});
  }catch(e){parentPort.postMessage({tipo:'error',error:String(e?.message||e).slice(0,350)});}
})();
