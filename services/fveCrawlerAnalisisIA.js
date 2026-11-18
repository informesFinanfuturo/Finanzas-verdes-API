'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {evaluarEvidencia}=require('./fveCrawlerEvidenciaIA');
const {ESTIMABLES}=require('./fveEstimacionesIA');
const PROMPT_PATH=path.resolve(__dirname,'../config/PROMPT_ANALISIS_CRAWLER.txt');
const tr=(f,e,d={})=>{try{f?.(e,d);}catch(_){}};
// FVE_CRAWLER_ESTABILIDAD_V2: solo fallos transitorios de red, tiempo y servicio admiten reintento.
function esFalloTransitorio(error){
  const mensajes=[];
  for(let e=error,i=0;e&&i<4;e=e.cause,i++)mensajes.push(String(e.code||'')+' '+String(e.message||''));
  const texto=mensajes.join(' ').toLowerCase();
  const status=Number(error?.status||error?.response?.status||0);
  if([401,403,400,404].includes(status))return false;
  return [408,429,500,502,503,504].includes(status) ||
    /fetch failed|econnreset|econnrefused|etimedout|eai_again|enotfound|socket hang up|network|timeout|timed out|gemini_crawler_timeout|service unavailable|internal server error/.test(texto);
}
const pausa=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function parsear(texto){
  const t=String(texto||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  return JSON.parse(t);
}
function textoRespuesta(r){
  if(typeof r?.text==='string')return r.text;
  return (r?.candidates?.[0]?.content?.parts||[]).map(x=>typeof x?.text==='string'?x.text:'').filter(Boolean).join('\n');
}
async function generar(pedido,modelo,opciones={}){
  const key=String(opciones.apiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
  if(!key){const e=new Error('Falta GEMINI_API_KEY');e.code='GEMINI_KEY_MISSING';throw e;}
  const {GoogleGenAI}=opciones.sdk||require('@google/genai');
  const ai=new GoogleGenAI({apiKey:key});
  const ms=Math.min(40000,Math.max(3000,Number(opciones.timeoutMs)||26000));
  const controller=new AbortController();let timer;
  try{
    return await Promise.race([
      ai.models.generateContent({model: modelo,contents:pedido,config:{
        responseMimeType:'application/json',abortSignal:controller.signal,httpOptions:{timeout:ms}}}),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();const e=new Error('Gemini no respondio al analizar las fichas');e.code='GEMINI_CRAWLER_TIMEOUT';reject(e);},ms);})
    ]);
  }finally{clearTimeout(timer);}
}
async function analizarDocumentos(activo,campos,web,trace,opciones={}){
  const modelo=opciones.modelo||process.env.GEMINI_REFERENCE_ANALYSIS_MODEL||'gemini-3.1-flash-lite';
  const docs=(web?.documentos||[]).slice(0,6).map(d=>({
    url:d.url,titulo:String(d.titulo||'').slice(0,200),
    contenido_extraido:String(d.fragmento||'').slice(0,6400)
  }));
  if(!docs.length)return {referencias:[],busqueda_realizada:false,consultas:web?.consultas||[],motivo:web?.motivo||'CRAWLER_SIN_DOCUMENTOS'};
  const contexto={nombre:String(activo?.nombre||'').slice(0,120),
    tipo:String(activo?.tipo||'').slice(0,80),marca:String(activo?.marca||'').slice(0,75),
    modelo:String(activo?.modelo||'').slice(0,80),
    campos_solicitados:campos,unidades_solicitadas:Object.fromEntries(campos.map(c=>[c,ESTIMABLES[c]?.unidad||null]))};
  const prompt=fs.readFileSync(PROMPT_PATH,'utf8');
  const pedido=prompt+'\nCONTEXTO:\n'+JSON.stringify(contexto)+'\nEVIDENCIA_WEB_RECUPERADA:\n'+JSON.stringify(docs);
  const t=Date.now();
  tr(trace,'CRAWLER_IA_INICIO',{modelo,api:'models.generateContent',busqueda_google:'NO',
    documentos_entregados:docs.length,urls:docs.map(d=>d.url),caracteres_contexto:pedido.length});
  let r, falloFinal, numeroIntentos=0;
  const totalIntentos=2;
  const analizar=opciones.analizar||((p,m)=>generar(p,m,opciones));
  for(let intento=1;intento<=totalIntentos;intento++){
    numeroIntentos=intento;
    tr(trace,'CRAWLER_IA_INTENTO_INICIO',{intento,total_intentos:totalIntentos,modelo});
    const inicioIntento=Date.now();
    try{
      r=await analizar(pedido,modelo);
      tr(trace,'CRAWLER_IA_INTENTO_OK',{intento,duracion_ms:Date.now()-inicioIntento});
      falloFinal=null;
      break;
    }catch(e){
      falloFinal=e;
      const transitorio=esFalloTransitorio(e);
      const ultimo=intento>=totalIntentos;
      tr(trace,'CRAWLER_IA_INTENTO_ERROR',{intento,total_intentos:totalIntentos,
        codigo:String(e.code||'GEMINI_ERROR').slice(0,75),duracion_ms:Date.now()-inicioIntento,
        transitorio,reintento:transitorio&&!ultimo,
        mensaje:String(e.message||'Error').slice(0,160)});
      if(!transitorio||ultimo)break;
      const esperaMs=400*intento;
      tr(trace,'CRAWLER_IA_REINTENTO_PROGRAMADO',{siguiente_intento:intento+1,espera_ms:esperaMs,
        causa:String(e.code||e.message||'ERROR_RED').slice(0,90)});
      await (opciones.esperar||pausa)(esperaMs);
    }
  }
  if(falloFinal){
    const transitorio=esFalloTransitorio(falloFinal);
    const codigo=String(falloFinal.code||'GEMINI_ERROR').slice(0,75);
    tr(trace,'CRAWLER_IA_ERROR',{codigo,duracion_ms:Date.now()-t,
      intentos:numeroIntentos,transitorio,reintentos_agotados:transitorio&&numeroIntentos>=totalIntentos,
      mensaje:String(falloFinal.message||'Error').slice(0,160)});
    return {referencias:[],busqueda_realizada:true,consultas:web.consultas||[],
      motivo:'GEMINI_ANALISIS_CRAWLER_FALLIDO',proveedor:'crawler_interno',
      detalle_fallo:{codigo,categoria:transitorio?'FALLO_TRANSITORIO_RED':'FALLO_NO_REINTENTABLE',
        intentos:numeroIntentos}};
  }
  const salida=textoRespuesta(r);
  tr(trace,'CRAWLER_IA_RESPUESTA',{duracion_ms:Date.now()-t,intentos:numeroIntentos,caracteres:salida.length,
    vista_previa:salida.slice(0,1100)});
  let raw;
  try{raw=parsear(salida);}catch(e){tr(trace,'CRAWLER_IA_JSON_INVALIDO',{mensaje:e.message,
    salida_caracteres:salida.length});
    return {referencias:[],busqueda_realizada:true,consultas:web.consultas||[],motivo:'CRAWLER_IA_JSON_INVALIDO',proveedor:'crawler_interno'};}
  const propuestas=Array.isArray(raw?.referencias)?raw.referencias:[];
  tr(trace,'CRAWLER_IA_REFERENCIAS',{candidatas:propuestas.length,
    campos:propuestas.slice(0,20).map(x=>({codigo:x.codigo,valor:x.valor??null,
      unidad:x.unidad,fuentes:Array.isArray(x.fuentes)?x.fuentes.length:0}))});
  const aceptadas=evaluarEvidencia(raw,web.documentos,campos,activo,trace);
  tr(trace,'CRAWLER_IA_FIN',{candidatas:propuestas.length,aceptadas:aceptadas.length,
    motivo:aceptadas.length?'REFERENCIAS_DOCUMENTADAS':'SIN_REFERENCIAS_DOCUMENTADAS'});
  return {referencias:aceptadas,busqueda_realizada:true,consultas:web.consultas||[],
    proveedor:'crawler_interno',motivo:aceptadas.length?'OK':'CRAWLER_SIN_REFERENCIAS_VALIDAS'};
}
module.exports={analizarDocumentos,generar,parsear,textoRespuesta};
