'use strict';

// PROMPT NUEVO Y AISLADO. NO modifica prompts existentes de activos o diagnosticos.
const { PROMPT_REFERENCIAS } = require('./fveBusquedaReferenciasIA');

function respuestaJson(s) {
  const t=String(s||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  return JSON.parse(t);
}
const trazar = (trace, evento, datos) => {
  try { if (typeof trace === 'function') trace(evento, datos); } catch (_) {}
};

function textoGenerate(response) {
  if (typeof response?.text === 'string') return response.text;
  return (response?.candidates?.[0]?.content?.parts || [])
    .map(p => typeof p?.text === 'string' ? p.text : '')
    .filter(Boolean).join('\n');
}

// Una respuesta narrativa del modelo no demuestra que Google Search haya sido ejecutado.
// GenerateContent publica la evidencia de la busqueda en groundingMetadata.
function evidenciaGenerate(response) {
  const metadata=response?.candidates?.[0]?.groundingMetadata || {};
  const consultas=Array.isArray(metadata.webSearchQueries)
    ? metadata.webSearchQueries.filter(q=>typeof q==='string' && q.trim()).map(q=>q.trim().slice(0,240)).slice(0,15)
    : [];
  const fragments=Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks : [];
  const fuentes=fragments.filter(x=>typeof x?.web?.uri==='string' && /^https?:\/\//i.test(x.web.uri))
    .slice(0,12).map(x=>({url:x.web.uri.slice(0,320),titulo:String(x.web.title||'').slice(0,120)}));
  return {consultas,fuentes,verificada:consultas.length>0 && fuentes.length>0};
}

async function conLimite(p,ms,etapa) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(p),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        const e=new Error('Tiempo maximo de espera agotado en '+etapa);
        e.code='GEMINI_REFERENCE_TIMEOUT'; reject(e);
      },ms);}),
    ]);
  } finally {clearTimeout(timer);}
}

// Usa el timeout del SDK y una señal de cancelación local para evitar dejar la
// solicitud de red abierta cuando el servidor ya devolvió un resultado.
// Cancelar en el cliente NO garantiza cancelar trabajo ni cobro en Google.
async function generateConCancelacion(solicitar, ms, etapa) {
  const controlador=new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(()=>solicitar(controlador.signal)),
      new Promise((_,reject)=>{timer=setTimeout(()=>{
        const e=new Error('Tiempo maximo de espera agotado en '+etapa);
        e.code='GEMINI_REFERENCE_TIMEOUT';
        reject(e);
        controlador.abort();
      },ms);}),
    ]);
  } finally {clearTimeout(timer);}
}

async function buscarReferencias(activo, campos, trace) {
  const modelo=process.env.GEMINI_REFERENCE_MODEL||'gemini-3.1-flash-lite';
  const modeloRespaldo=process.env.GEMINI_REFERENCE_FALLBACK_MODEL||'gemini-3.1-flash-lite';
  const tiempoRespaldo=35000;
  const contexto={ nombre:String(activo.nombre||'').slice(0,160), tipo:String(activo.tipo||'').slice(0,100),
    marca:String(activo.marca||'').slice(0,80), modelo:String(activo.modelo||'').slice(0,100),
    descripcion:String(activo.descripcion||'').slice(0,450), campos_solicitados:campos };
  trazar(trace,'CONTEXTO_ENVIADO_IA',{
    modelo_ia:modelo,modelo_busqueda_respaldo:modeloRespaldo,herramienta:'google_search',
    nombre_activo:contexto.nombre,tipo:contexto.tipo,marca:contexto.marca,
    modelo_activo:contexto.modelo,descripcion_caracteres:contexto.descripcion.length,
    campos_solicitados:contexto.campos_solicitados,
  });
  const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
  if (!apiKey) {
    trazar(trace,'ERROR_CONFIGURACION',{codigo:'GEMINI_KEY_MISSING'});
    const e=new Error('GEMINI_API_KEY no configurada');e.code='GEMINI_KEY_MISSING';throw e;
  }
  const { GoogleGenAI } = require('@google/genai');
  const ai=new GoogleGenAI({apiKey});
  // El prompt y el contexto son IDENTICOS en ambos intentos. No se cambia ninguna instruccion.
  const pedido=PROMPT_REFERENCIAS+'\nCONTEXTO:\n'+JSON.stringify(contexto);
  let response=null;
  let errorPrimario=null;
  const inicio=Date.now();
  try {
    trazar(trace,'GOOGLE_SEARCH_SOLICITADO',{model:modelo,api:'interactions.create',timeout_segundos:55});
    response=await conLimite(()=>ai.interactions.create({
      model:modelo,input:[{type:'text',text:pedido}],tools:[{type:'google_search'}],
    }),55000,'interactions.create');
  } catch(e) {
    errorPrimario=e;
    trazar(trace,'ERROR_PRIMER_INTENTO',{
      codigo:e?.code||null,nombre:e?.name||'Error',mensaje:e?.message||'Error desconocido',
      duracion_ms:Date.now()-inicio,
    });
  }

  if (response) {
    const pasos=Array.isArray(response?.steps)?response.steps:[];
    const searches=pasos.filter(x=>x?.type==='google_search_call');
    const salida=typeof response?.output_text==='string'?response.output_text:'';
    const consultas=searches.flatMap(x=>Array.isArray(x?.arguments?.queries)?x.arguments.queries:[])
      .map(x=>String(x).slice(0,240)).slice(0,15);
    trazar(trace,'RESPUESTA_MODELO',{
      duracion_ms:Date.now()-inicio,
      claves_respuesta:response&&typeof response==='object'?Object.keys(response).slice(0,25):[],
      pasos_reportados:pasos.length,tipos_pasos:pasos.map(x=>x?.type||'sin_tipo').slice(0,20),
      llamadas_google_search_detectadas:searches.length,consultas_realizadas:consultas,
      salida_texto_caracteres:salida.length,vista_previa_salida:salida.slice(0,1500),
    });
    if (searches.length) {
      try {
        const parseado=respuestaJson(salida);
        trazar(trace,'JSON_INTERPRETADO',{
          via:'interactions.create',
          referencias_devueltas:Array.isArray(parseado?.referencias)?parseado.referencias.length:0,
          campos_devueltos:Array.isArray(parseado?.referencias) ? parseado.referencias.slice(0,20)
            .map(x=>({codigo:x?.codigo,valor:x?.valor,unidad:x?.unidad,coincidencia:x?.coincidencia,
              fuentes:Array.isArray(x?.fuentes)?x.fuentes.length:0})) : [],
        });
        return {...parseado,busqueda_realizada:true,consultas,via:'interactions.create'};
      } catch(e) {
        trazar(trace,'JSON_NO_VALIDO',{via:'interactions.create',razon:e.message,
          vista_previa:salida.slice(0,800),accion:'REINTENTO_GENERATE_CONTENT'});
      }
    } else {
      trazar(trace,'SIN_BUSQUEDA_VERIFICABLE',{
        razon:'response.steps no contiene google_search_call',
        hay_steps:Array.isArray(response?.steps),respuesta_con_texto:salida.length>0,
        accion:'REINTENTO_AUTOMATICO_CON_BUSQUEDA_FUNDAMENTADA',
      });
    }
  }

  // Un unico reintento con una API diferente. El modelo aun controla si buscar,
  // de modo que NO se asume que la busqueda se haya producido por solicitarla.
  const inicioRespaldo=Date.now();
  trazar(trace,'REINTENTO_BUSQUEDA_WEB',{
    modelo:modeloRespaldo,api:'models.generateContent',timeout_segundos:tiempoRespaldo/1000,
    motivo:errorPrimario ? 'FALLO_PRIMER_INTENTO' : 'SIN_BUSQUEDA_O_JSON_VALIDO',
    advertencia:'Esta llamada adicional puede consumir cuota de Gemini',
  });
  let grounded;
  try {
    grounded=await generateConCancelacion((signal)=>ai.models.generateContent({
      model:modeloRespaldo,contents:pedido,
      config:{tools:[{googleSearch:{}}],abortSignal:signal,httpOptions:{timeout:tiempoRespaldo}},
    }),tiempoRespaldo,'models.generateContent');
  } catch(e) {
    trazar(trace,'ERROR_REINTENTO_BUSQUEDA',{
      codigo:e?.code||null,nombre:e?.name||'Error',mensaje:e?.message||'Error desconocido',
      duracion_ms:Date.now()-inicioRespaldo,accion:'NO_GUARDAR_ESTIMACIONES',
    });
    return {referencias:[],busqueda_realizada:false,consultas:[],
      motivo:e?.code==='GEMINI_REFERENCE_TIMEOUT' ? 'GEMINI_REFERENCE_TIMEOUT' : 'ERROR_REINTENTO_BUSQUEDA_WEB'};
  }
  const evidencia=evidenciaGenerate(grounded);
  const salida=textoGenerate(grounded);
  trazar(trace,'RESPUESTA_REINTENTO_BUSQUEDA',{
    modelo:modeloRespaldo,duracion_ms:Date.now()-inicioRespaldo,
    llamadas_google_search_detectadas:evidencia.consultas.length,
    consultas_realizadas:evidencia.consultas,
    enlaces_grounding:evidencia.fuentes,
    texto_caracteres:salida.length,vista_previa_salida:salida.slice(0,1500),
  });
  if (!evidencia.verificada) {
    trazar(trace,'REINTENTO_SIN_BUSQUEDA_VERIFICABLE',{
      consultas_con_metadata:evidencia.consultas.length,fuentes_con_metadata:evidencia.fuentes.length,
      razon:'Faltan consultas o fuentes reales en groundingMetadata',
      accion:'NO_GUARDAR_ESTIMACIONES',
    });
    return {referencias:[],busqueda_realizada:false,consultas:evidencia.consultas,
      motivo:'SIN_GROUNDING_VERIFICABLE'};
  }
  let parseado;
  try {parseado=respuestaJson(salida);} catch(e) {
    trazar(trace,'JSON_NO_VALIDO',{via:'models.generateContent',razon:e.message,
      vista_previa:salida.slice(0,1000),accion:'NO_GUARDAR_ESTIMACIONES'});
    return {referencias:[],busqueda_realizada:true,consultas:evidencia.consultas,
      motivo:'JSON_INVALIDO_TRAS_BUSQUEDA'};
  }
  trazar(trace,'JSON_INTERPRETADO',{
    via:'models.generateContent',referencias_devueltas:Array.isArray(parseado?.referencias)?parseado.referencias.length:0,
    campos_devueltos:Array.isArray(parseado?.referencias) ? parseado.referencias.slice(0,20)
      .map(x=>({codigo:x?.codigo,valor:x?.valor,unidad:x?.unidad,coincidencia:x?.coincidencia,
        fuentes:Array.isArray(x?.fuentes)?x.fuentes.length:0})) : [],
  });
  return {...parseado,busqueda_realizada:true,consultas:evidencia.consultas,
    via:'models.generateContent'};
}
module.exports={buscarReferencias,PROMPT_REFERENCIAS,_pruebas:{generateConCancelacion}};
