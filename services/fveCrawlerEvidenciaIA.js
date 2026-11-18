'use strict';
// Segundo candado: no basta con citar una URL. Debe haberse extraido y
// contener el valor + unidad para el campo especifico.
// Las URLs de Gemini solo son admisibles cuando ya figuran en documentos descargados.
function urlSegura(raw) {
  try {
    const u = new URL(String(raw||''));
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port!=='443')) return null;
    u.hash=''; return u.toString();
  } catch (_) { return null; }
}
const CODIGOS = Object.freeze({
 consumo_actual_kwh_mes:'kWh/mes',capacidad_actual_l:'L',
 consumo_actual_kwh_ciclo:'kWh/ciclo',potencia_anterior_w:'W',
 caudal_anterior_l_min:'L/min',descarga_anterior_l:'L/descarga',
});
const trazar=(f,e,d)=>{try{f?.(e,d);}catch(_){}};
function dominioIndependiente(url){
 try{
  const h=new URL(url).hostname.replace(/^www\./,'').toLowerCase().split('.');
  if(h.length<2)return '';
  const suf=h.slice(-2).join('.');
  if(h.length>=3 && ['com.co','gov.co','edu.co','org.co','com.mx','com.br','com.ar','co.uk','org.uk'].includes(suf))
    return h.slice(-3).join('.');
  return suf;
 }catch(_){return '';}
}
const normalizarUrl=(url)=>{
 const u=urlSegura(url);
 return u ? u.replace(/\/$/,'').toLowerCase() : null;
};
const normalizarNumero=s=>Number(String(s||'').replace(',','.'));
function numerosConUnidad(codigo,texto){
 const s=String(texto||'').slice(0,16000);
 let regex;
 if(codigo==='consumo_actual_kwh_mes')
   regex=/(\d{1,5}(?:[.,]\d{1,3})?)\s*kwh\s*(?:\/\s*mes\b|\/\s*month\b|(?:\s+(?:al|por)\s+mes\b)|\s*mensuales?\b)/gi;
 else if(codigo==='capacidad_actual_l') regex=/(\d{1,5}(?:[.,]\d{1,3})?)\s*(?:litros?\b|lts?\b|l\b)/gi;
 else if(codigo==='consumo_actual_kwh_ciclo') regex=/(\d{1,5}(?:[.,]\d{1,3})?)\s*kwh\s*(?:\/\s*ciclo|por\s+ciclo)/gi;
 else if(codigo==='potencia_anterior_w') regex=/(\d{1,6}(?:[.,]\d{1,3})?)\s*w\b/gi;
 else if(codigo==='caudal_anterior_l_min') regex=/(\d{1,5}(?:[.,]\d{1,3})?)\s*(?:l|litros?)\s*\/\s*min/gi;
 else if(codigo==='descarga_anterior_l') regex=/(\d{1,5}(?:[.,]\d{1,3})?)\s*(?:l|litros?)\s*\/\s*descarga/gi;
 else return [];
 const numeros=[...s.matchAll(regex)].map(x=>normalizarNumero(x[1]));
 // Consumo mensual tambien puede leerse "consumo mensual ... 37 kWh".
 if(codigo==='consumo_actual_kwh_mes'){
  for(const m of s.matchAll(/(\d{1,5}(?:[.,]\d{1,3})?)\s*kwh\b/gi)){
   const anterior=s.slice(Math.max(0,m.index-65),m.index).toLowerCase();
   const posterior=s.slice(m.index,m.index+35).toLowerCase();
   if(/mensual|por mes|al mes/i.test(anterior) && !/\/\s*(?:a[nñ]o|d[ií]a|ciclo|h)/.test(posterior))
    numeros.push(normalizarNumero(m[1]));
  }
 }
 return [...new Set(numeros.filter(x=>Number.isFinite(x)&&x>0))].slice(0,35);
}
function citaTecnicaReal(codigo,texto,limite=220){
 const fuente=String(texto||'').slice(0,16000);
 const unidad=codigo==='capacidad_actual_l' ? /\d{1,5}(?:[.,]\d{1,3})?\s*(?:litros?\b|lts?\b|l\b)/i :
   codigo==='consumo_actual_kwh_mes' ? /\d{1,5}(?:[.,]\d{1,3})?\s*kwh\s*(?:\/\s*mes|\s*(?:al|por)\s+mes|\s*mensuales?)/i :
   /\d{1,6}(?:[.,]\d{1,3})?\s*(?:kwh|w|l)/i;
 let m=unidad.exec(fuente);
 if(!m && codigo==='consumo_actual_kwh_mes')m=/\d{1,5}(?:[.,]\d{1,3})?\s*kwh\b/i.exec(fuente);
 if(!m)return '';
 return fuente.slice(Math.max(0,m.index-85),Math.min(fuente.length,m.index+115))
   .replace(/\s+/g,' ').trim().slice(0,limite);
}
function contieneMarca(d,marca){
 const m=String(marca||'').trim().toLowerCase();
 if(!m)return true;
 return [d.titulo,d.texto].join(' ').toLowerCase().includes(m);
}
function evaluarEvidencia(raw,documentos,campos,activo,trace){
 const lista=Array.isArray(raw?.referencias)?raw.referencias.slice(0,25):[];
 const lookup=new Map(documentos.map(d=>[normalizarUrl(d.url),d]));
 const permitidos=new Set(campos);
 const aceptadas=[];
 trazar(trace,'WEB_VALIDACION_EVIDENCIA_INICIO',{referencias_modelo:lista.length,documentos_disponibles:documentos.length,
   campos_permitidos:[...permitidos]});
 for(const [indice,item] of lista.entries()){
  const codigo=String(item?.codigo||'');
  const resumen={indice:indice+1,codigo,valor:item?.valor??null,unidad:item?.unidad??null};
  const rechazo=(motivo,detalles={})=>trazar(trace,'WEB_REFERENCIA_RECHAZADA',{...resumen,motivo,...detalles});
  if(!permitidos.has(codigo)||!CODIGOS[codigo]){rechazo('CAMPO_NO_SOLICITADO');continue;}
  if(item.unidad!==CODIGOS[codigo]){rechazo('UNIDAD_NO_CORRESPONDE',{esperada:CODIGOS[codigo]});continue;}
  const valor=typeof item.valor==='number'?item.valor:Number(item.valor);
  if(item.valor==null||!Number.isFinite(valor)||valor<=0){rechazo('VALOR_AUSENTE_O_INVALIDO');continue;}
  let tipo=String(item?.coincidencia||'');
  if(!['modelo_exacto','modelo_equivalente','categoria'].includes(tipo)){rechazo('TIPO_COINCIDENCIA_INVALIDO');continue;}
  const modelo=String(activo?.modelo||'').trim();
  if(tipo==='modelo_exacto' && !/\d/.test(modelo)){
   // FVE_CRAWLER_ESTABILIDAD_V2: es una familia comercial, no hay referencia unica verificable.
   // Se clasifica como comparable, pero NO se acepta ni se rebaja el minimo
   // de dos dominios independientes, y no se escribe al activo.
   trazar(trace,'WEB_COINCIDENCIA_AJUSTADA',{codigo,
     de:'modelo_exacto',a:'modelo_equivalente',
     motivo:'ACTIVO_SIN_CODIGO_MODELO_UNICO',modelo_activo:modelo.slice(0,90)});
   tipo='modelo_equivalente';
  }
  const citas=Array.isArray(item.fuentes)?item.fuentes:[];
  const fuentes=[];
  for(const cita of citas){
   const llave=normalizarUrl(cita?.url);
   const doc=lookup.get(llave);
   if(!doc){trazar(trace,'WEB_FUENTE_RECHAZADA',{codigo,url:urlSegura(cita?.url),motivo:'URL_NO_FUE_EXTRAIDA'});continue;}
   if(!contieneMarca(doc,activo?.marca)){
    trazar(trace,'WEB_FUENTE_RECHAZADA',{codigo,url:doc.url,motivo:'MARCA_NO_APARECE_EN_DOCUMENTO'});continue;
   }
   if(tipo==='modelo_exacto' && ![doc.titulo,doc.texto].join(' ').toLowerCase().includes(modelo.toLowerCase())){
    trazar(trace,'WEB_FUENTE_RECHAZADA',{codigo,url:doc.url,motivo:'MODELO_EXACTO_NO_APARECE'});continue;
   }
   const numeros=numerosConUnidad(codigo,doc.texto);
   if(!numeros.length){trazar(trace,'WEB_FUENTE_RECHAZADA',{codigo,url:doc.url,motivo:'FUENTE_SIN_VALOR_Y_UNIDAD',unidad:CODIGOS[codigo]});continue;}
   if(fuentes.some(f=>normalizarUrl(f.url)===llave))continue;
   fuentes.push({...cita,url:doc.url,titulo:doc.titulo||String(cita?.titulo||''),
      dato_observado:citaTecnicaReal(codigo,doc.texto),_valores:numeros});
  }
  const independientes=new Set(fuentes.map(f=>dominioIndependiente(f.url)));
  const minimo=tipo==='modelo_exacto'?1:2;
  if(independientes.size<minimo){rechazo('FUENTES_EXTRAIDAS_INSUFICIENTES',{
    urls_citadas:citas.length,fuentes_con_valor:fuentes.length,dominios_validos:independientes.size,dominios_necesarios:minimo});continue;}
  const observados=fuentes.flatMap(f=>f._valores);
  const exacto=observados.some(n=>Math.abs(n-valor)<0.011);
  const metodologia=String(item?.metodo||'');
  const promedioExplicado=/promedio|media|mediana|rango|intervalo|media aritm[eé]tica/i.test(metodologia);
  const enRango=valor>=Math.min(...observados)-0.011 && valor<=Math.max(...observados)+0.011;
  if(!exacto && !(promedioExplicado && observados.length>=2 && enRango)){
    rechazo('VALOR_NO_SOPORTADO_POR_FICHAS',{valor_propuesto:valor,valores_documentados:observados.slice(0,12),
      requiere_promedio_justificado:!exacto});continue;
  }
  const limpio={...item,codigo,valor,coincidencia:tipo,fuentes:fuentes.map(({_valores,...f})=>f)};
  aceptadas.push(limpio);
  trazar(trace,'WEB_REFERENCIA_CON_EVIDENCIA',{codigo,valor,unidad:item.unidad,
    coincidencia:tipo,urls_validas:limpio.fuentes.map(f=>f.url),valores_observados:observados.slice(0,12),
    tipo_apoyo:exacto?'VALOR_PUBLICADO':'INTERPOLACION_ENTRE_FUENTES'});
 }
 trazar(trace,'WEB_VALIDACION_EVIDENCIA_FIN',{referencias_originales:lista.length,referencias_con_soporte:aceptadas.length,
   codigos:aceptadas.map(x=>x.codigo)});
 return aceptadas;
}
module.exports={evaluarEvidencia,numerosConUnidad,dominioIndependiente};
