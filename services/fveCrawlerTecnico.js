'use strict';
// Crawler acotado a fuentes permitidas. Nunca realiza busquedas abiertas ni accede a redes privadas.
const dns = require('node:dns/promises');
const net = require('node:net');
const { leerFuentes, seleccionarFuentes, urlSegura, rutaPermitida, norm } = require('./fveCrawlerFuentes');
const { clasificarActivo } = require('./fveClasificacionActivo');
const { numerosConUnidad } = require('./fveCrawlerEvidenciaIA');
const tr = (fn, etapa, datos={})=>{try{fn?.(etapa,datos);}catch(_){}};
function publica(ip) {
  const v=net.isIP(ip);
  if(v===4){
    const a=ip.split('.').map(Number);
    return !(a[0]===0 || a[0]===10 || a[0]===127 || a[0]>=224 ||
      a[0]===169&&a[1]===254 || a[0]===172&&a[1]>=16&&a[1]<=31 ||
      a[0]===192&&a[1]===168 || a[0]===100&&a[1]>=64&&a[1]<=127 ||
      a[0]===192&&a[1]===0 || a[0]===198&&a[1]>=18&&a[1]<=19 ||
      a[0]===198&&a[1]===51&&a[2]===100 || a[0]===203&&a[1]===0&&a[2]===113);
  }
  if(v===6){
    const s=ip.toLowerCase();
    return !(s==='::1'||s==='::'||s.startsWith('fc')||s.startsWith('fd')||
      s.startsWith('fe8')||s.startsWith('fe9')||s.startsWith('fea')||s.startsWith('feb')||
      s.startsWith('::ffff:')||s.startsWith('2001:db8:'));
  }
  return false;
}
function error(codigo,descripcion='') {const e=new Error(descripcion||codigo);e.code=codigo;return e;}
async function dnsPublico(host,resolver=dns.lookup) {
  const registros=await resolver(host,{all:true,verbatim:true});
  if(!Array.isArray(registros)||!registros.length||registros.some(r=>!publica(r.address))) throw error('CRAWLER_DNS_NO_PUBLICO');
}
async function leerCuerpo(res,maxBytes) {
  const contentLength=Number(res.headers?.get?.('content-length'));
  if(Number.isFinite(contentLength) && contentLength>maxBytes) throw error('CRAWLER_RESPUESTA_EXCESIVA');
  if(res.body?.getReader) {
    const lector=res.body.getReader(); const chunks=[];let n=0;
    try {while(true){const r=await lector.read();if(r.done)break;n+=r.value.byteLength;
      if(n>maxBytes){await lector.cancel();throw error('CRAWLER_RESPUESTA_EXCESIVA');}
      chunks.push(Buffer.from(r.value));}}
    finally{try{lector.releaseLock();}catch(_){}}
    return Buffer.concat(chunks).toString('utf8');
  }
  const s=await res.text();
  if(Buffer.byteLength(s,'utf8')>maxBytes)throw error('CRAWLER_RESPUESTA_EXCESIVA');
  return s;
}
async function solicitar(url,fuente,limites,opciones={}) {
  const fetcher=opciones.fetcher||fetch;
  const resolver=opciones.resolver||dns.lookup;
  const inicio=Date.now();let actual=url;
  for(let saltos=0;saltos<=2;saltos++) {
    const valida=urlSegura(actual,fuente);
    if(!valida)throw error('CRAWLER_URL_NO_PERMITIDA');
    await dnsPublico(new URL(valida).hostname,resolver);
    const ctrl=new AbortController();
    const maxMs=Math.min(limites.timeout_por_pagina_ms,Math.max(500,(opciones.deadline||Infinity)-Date.now()));
    const timer=setTimeout(()=>ctrl.abort(),maxMs);
    try {
      const r=await fetcher(valida,{method:'GET',redirect:'manual',signal:ctrl.signal,
        headers:{'User-Agent':'FinanfuturoTecnicoBot/1.0 (+crawler tecnico de consulta publica)',
          'Accept':'text/html,application/xhtml+xml,application/xml,text/plain;q=0.5'}});
      if([301,302,303,307,308].includes(r.status)){
        const location=r.headers?.get?.('location');
        if(!location)throw error('CRAWLER_REDIRECCION_SIN_DESTINO');
        actual=new URL(location,valida).toString();
        if(!urlSegura(actual,fuente))throw error('CRAWLER_REDIRECCION_NO_PERMITIDA');
        const destinoPath=new URL(actual).pathname;
        if(!['/robots.txt','/sitemap.xml'].includes(destinoPath) && !rutaPermitida(actual,fuente))
          throw error('CRAWLER_REDIRECCION_RUTA_NO_AUTORIZADA');
        continue;
      }
      if(!r.ok)throw error('CRAWLER_HTTP_'+r.status);
      const tipo=String(r.headers?.get?.('content-type')||'').toLowerCase();
      if(!/(?:html|xml|text\/plain)/.test(tipo))throw error(tipo.includes('pdf')?'CRAWLER_PDF_SIN_LECTOR':'CRAWLER_CONTENIDO_NO_HTML');
      const contenido=await leerCuerpo(r,limites.max_html_bytes);
      return {url:valida,contenido,tipo,duracion_ms:Date.now()-inicio};
    }catch(e){if(e.name==='AbortError')throw error('CRAWLER_TIMEOUT');throw e;}
    finally{clearTimeout(timer);}
  }
  throw error('CRAWLER_DEMASIADAS_REDIRECCIONES');
}
function reglasRobots(texto) {
  const grupos=[];let agentes=[],reglas=[],inRule=false;
  function push(){if(agentes.length) grupos.push({agentes:[...agentes],reglas:[...reglas]});}
  for(const l of String(texto||'').split(/\r?\n/)){
    const sin=l.split('#')[0].trim();const m=/^([a-z-]+)\s*:\s*(.*)$/i.exec(sin);if(!m)continue;
    const k=m[1].toLowerCase(),v=m[2].trim();
    if(k==='user-agent'){
      if(inRule){push();agentes=[];reglas=[];inRule=false;}
      agentes.push(v.toLowerCase());
    } else if((k==='allow'||k==='disallow')&&agentes.length){reglas.push({tipo:k,ruta:v});inRule=true;}
  }
  push();return grupos;
}
function permitidoRobots(path, texto, agent='FinanfuturoTecnicoBot') {
  const gs=reglasRobots(texto), ua=agent.toLowerCase();
  const propios=gs.filter(g=>g.agentes.some(a=>a!=='*' && ua.includes(a)));
  const aplican=propios.length?propios:gs.filter(g=>g.agentes.includes('*'));
  let mejor=null;
  for(const g of aplican)for(const r of g.reglas) {
    if(!r.ruta)continue;
    const exp='^'+r.ruta.split('*').map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\$$/,'$');
    try{if(new RegExp(exp).test(path)){
      const peso=r.ruta.replace(/[\*\$]/g,'').length;
      if(!mejor||peso>mejor.peso||peso===mejor.peso&&r.tipo==='allow')mejor={peso,tipo:r.tipo};
    }}catch(_){}
  }
  return !mejor || mejor.tipo==='allow';
}
function limpiarHtml(html) {
  const fuente=String(html||'').slice(0,4500000); // FVE_CRAWLER_ESTABILIDAD_V2
  const titulo=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(fuente)?.[1]||'';
  const jsonLd=[...fuente.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .slice(0,3).map(m=>m[1].slice(0,16000)).join(' ');
  const sin=fuente.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ')
    .replace(/<!--([\s\S]*?)-->/g,' ')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|td|th|section|article)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/\r/g,'').replace(/[\t ]+/g,' ').replace(/\n[ \t]*/g,'\n')
    .replace(/\n{3,}/g,'\n\n').trim();
  // FVE_CRAWLER_ESTABILIDAD_V2: preservar fragmentos tecnicos de paginas largas sin enviar
  // anuncios, scripts ni varios megabytes al modelo. MAXIMO 25.000 caracteres.
  const foco=[];
  const inicio=sin.slice(0,3700);
  const regex=/\d{1,5}(?:[.,]\d{1,3})?\s*(?:kwh\b|litros?\b)|consumo.{0,35}(?:mensual|energetico|energético)|capacidad.{0,35}(?:litros|total|neta)/gi;
  let ultima=-1000;
  for(const m of sin.matchAll(regex)){
    if(foco.length>=80)break;
    if(m.index<3300||m.index-ultima<140)continue;
    foco.push(sin.slice(Math.max(0,m.index-130),m.index+180));
    ultima=m.index;
  }
  const texto=(jsonLd.slice(0,4500)+'\n'+inicio+'\n'+foco.join('\n[...]\n')).slice(0,25000);
  return {titulo:titulo.replace(/<[^>]+>/g,'').slice(0,200),texto};
}
function extractoTecnico(s,max=6400) {
  const texto=String(s||'').slice(0,25000),arr=[];
  const matches=[...texto.matchAll(/kwh|consumo|energ[ií]a|litros?|capacidad|n[oó]\s*frost|eficiencia|potencia|referencia|modelo/gi)];
  let ultimo=-1000;
  for(const m of matches.slice(0,90)){
    const desde=Math.max(0,m.index-140);
    if(desde-ultimo<180)continue;
    arr.push(texto.slice(desde,m.index+330));ultimo=desde;
  }
  return arr.join('\n[... ]\n').slice(0,max);
}
function linksHtml(html,base,fuente) {
  const links=[];
  for(const m of String(html||'').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']{1,600})["'][^>]*>/gi)){
    try{
      const u=new URL(m[1].replace(/&amp;/g,'&'),base).toString();
      if(rutaPermitida(u,fuente))links.push(u);
    }catch(_){}}
  return [...new Set(links)].slice(0,150);
}
function puntuacion(url, texto, activo){
  const cuerpo=norm((url+' '+texto).slice(0,12000));
  const marca=norm(activo?.marca),modelo=norm(activo?.modelo);
  let puntos=0;
  if(marca&&cuerpo.includes(marca))puntos+=2;
  if(modelo&&modelo.length>3&&cuerpo.includes(modelo))puntos+=2;
  if(/kwh|consumo|capacidad|litros|ficha tecnica/.test(cuerpo))puntos+=2;
  if(/nevera|refriger|congelador|frost/.test(cuerpo))puntos+=2;
  if(/p\/|product\/|producto|nevera/.test(url))puntos++;
  return puntos;
}
function sitemapUrls(xml,fuente,activo,limite){
  const urls=[];
  for(const m of String(xml||'').matchAll(/<loc[^>]*>([^<]+)<\/loc>/gi)){
    const url=m[1].replace(/&amp;/g,'&').trim();
    if(rutaPermitida(url,fuente))urls.push(url);
  }
  return [...new Set(urls)].sort((a,b)=>puntuacion(b,'',activo)-puntuacion(a,'',activo)).slice(0,limite);
}
async function buscarDocumentos(activo,campos,trace,opciones={}) {
  const config=opciones.config||leerFuentes(opciones.configPath);
  const codigo=clasificarActivo(activo?.tipo,activo?.nombre);
  const fuentes=seleccionarFuentes(config,activo,codigo);
  const lim=config.limites;
  const inicio=Date.now(),deadline=inicio+lim.timeout_total_ms;
  const stats={urls_visitadas:0,urls_exitosas:0,fuentes_autorizadas:fuentes.length,
    documentos_utiles:0,robots_bloqueos:0,errores:0};
  tr(trace,'CRAWLER_INICIO',{motor:'crawler_interno',catalogo:config.ruta||'configuracion_inyectada',
    taxonomia:codigo,campos,fuentes_seleccionadas:fuentes.map(f=>({id:f.id,dominios:f.dominios,
      semillas:f.paginas_iniciales.length})),limites:lim});
  if(!fuentes.length)return {documentos:[],consultas:[],motivo:'CRAWLER_SIN_FUENTES_CONFIGURADAS',estadisticas:stats};
  const consultas=[],documentos=[],visitados=new Set();
  const cacheRobots=new Map();
  async function robotsPermitido(url,fuente){
    const host=new URL(url).hostname;
    if(!cacheRobots.has(host)){
      try{
        const r=await solicitar('https://'+host+'/robots.txt',fuente,{...lim,max_html_bytes:200000},
          {...opciones,deadline});
        // Un HTML de error o login con codigo 200 no demuestra permiso de rastreo.
        if(!r.tipo.includes('text/plain') && !/^\s*(?:user-agent|sitemap)\s*:/im.test(r.contenido))
          throw error('CRAWLER_ROBOTS_FORMATO_INVALIDO');
        cacheRobots.set(host,r.contenido);
        tr(trace,'CRAWLER_ROBOTS',{host,estado:'LEIDO',caracteres:r.contenido.length});
      }catch(e){
        if(e.code==='CRAWLER_HTTP_404'){
          cacheRobots.set(host,'');tr(trace,'CRAWLER_ROBOTS',{host,estado:'NO_EXISTE_404'});
        }else{
          cacheRobots.set(host,null);
          tr(trace,'CRAWLER_ROBOTS',{host,estado:'DENEGADO_FALLO_LECTURA',codigo:e.code||'ERROR_RED'});
        }
      }
    }
    const robots=cacheRobots.get(host);
    const ok=robots!==null && permitidoRobots(new URL(url).pathname,robots);
    if(!ok){stats.robots_bloqueos++;tr(trace,'CRAWLER_URL_RECHAZADA',{url,razon:'ROBOTS_NO_AUTORIZA_O_NO_DISPONIBLE'});}
    return ok;
  }
  for(const fuente of fuentes) {
    if(Date.now()>=deadline||stats.urls_visitadas>=lim.max_paginas_totales)break;
    const cola=fuente.paginas_iniciales.map(url=>({url,depth:0,origen:'SEMILLA'}));
    let visitadasFuente=0;
    if(fuente.sitemap && fuente.dominios.length){
      const sitemap='https://'+fuente.dominios[0]+'/sitemap.xml';
      if(await robotsPermitido(sitemap,fuente)){
        try{
          const r=await solicitar(sitemap,fuente,{...lim,max_html_bytes:350000},{...opciones,deadline});
          const descubiertas=sitemapUrls(r.contenido,fuente,activo,lim.max_sitemap_urls);
          tr(trace,'CRAWLER_SITEMAP',{fuente:fuente.id,url:sitemap,urls_relevantes:descubiertas.length});
          for(const url of descubiertas)cola.push({url,depth:0,origen:'SITEMAP'});
        }catch(e){tr(trace,'CRAWLER_SITEMAP_ERROR',{fuente:fuente.id,codigo:e.code||'ERROR_RED'});}
      }
    }
    // FVE_CRAWLER_ESTABILIDAD_V2: fabricantes admiten HTML mayor bajo un limite estricto de 4,5 MB.
    // El responsable puede fijar max_html_bytes en la entrada del fabricante.
    const bytesSolicitados=Number(fuente.max_html_bytes);
    const esFabricante=/(?:^|_)(?:fabricante|manufacturer)(?:_|$)/i.test(fuente.id);
    const bytesPorDefecto=esFabricante?3500000:lim.max_html_bytes;
    const maxBytesPagina=Math.min(4500000,Math.max(lim.max_html_bytes,
      Number.isSafeInteger(bytesSolicitados)&&bytesSolicitados>0?bytesSolicitados:bytesPorDefecto));
    const limPagina={...lim,max_html_bytes:maxBytesPagina};
    tr(trace,'CRAWLER_FUENTE_INICIO',{fuente:fuente.id,dominios:fuente.dominios,
      urls_en_cola:cola.length,limite_html_por_pagina_bytes:maxBytesPagina});
    while(cola.length && visitadasFuente<lim.max_paginas_por_fuente &&
      stats.urls_visitadas<lim.max_paginas_totales && Date.now()<deadline) {
      const item=cola.shift(),url=urlSegura(item.url,fuente);
      if(!url||!rutaPermitida(url,fuente)||visitados.has(url))continue;
      visitados.add(url);
      if(!await robotsPermitido(url,fuente))continue;
      stats.urls_visitadas++;visitadasFuente++;
      const t=Date.now();
      try{
        const r=await solicitar(url,fuente,limPagina,{...opciones,deadline});
        if(!r.tipo.includes('html'))throw error('CRAWLER_FORMATO_SIN_EXTRAER');
        const data=limpiarHtml(r.contenido),score=puntuacion(url,data.titulo+' '+data.texto,activo);
        stats.urls_exitosas++;
        const valido=data.texto.length>110 && score>=4 && /kwh|litros|capacidad|consumo/i.test(data.texto);
        tr(trace,'CRAWLER_PAGINA',{fuente:fuente.id,url,origen:item.origen,
          profundidad:item.depth,estado:'HTTP_OK',duracion_ms:Date.now()-t,
          caracteres_texto:data.texto.length,bytes_html:Buffer.byteLength(r.contenido,'utf8'),puntaje:score,seleccionada:valido,
          contiene_consumo:/kwh/i.test(data.texto),contiene_capacidad:/litros|\b\d+\s*l\b/i.test(data.texto),
          valores_detectados:{consumo_kwh_mes:numerosConUnidad('consumo_actual_kwh_mes',data.texto).slice(0,5),
            capacidad_l:numerosConUnidad('capacidad_actual_l',data.texto).slice(0,5)}});
        if(valido){documentos.push({url,titulo:data.titulo||url,texto:data.texto,
          fragmento:extractoTecnico(data.texto),fuente_id:fuente.id});stats.documentos_utiles++;}
        if(item.depth<lim.max_profundidad && score>=2){
          for(const siguiente of linksHtml(r.contenido,url,fuente)){
            if(!visitados.has(siguiente) && cola.length<600)cola.push({url:siguiente,depth:item.depth+1,origen:'ENLACE_INTERNO'});
          }
        }
      }catch(e){stats.errores++;
        tr(trace,'CRAWLER_PAGINA_ERROR',{fuente:fuente.id,url,duracion_ms:Date.now()-t,
          codigo:e.code||'ERROR_RED',mensaje:String(e.message||'').slice(0,130)});
      }
    }
    tr(trace,'CRAWLER_FUENTE_FIN',{fuente:fuente.id,paginas_analizadas:visitadasFuente,
      documentos_acumulados:documentos.length});
    consultas.push('SITIO_AUTORIZADO:'+fuente.id);
  }
  documentos.sort((a,b)=>puntuacion(b.url,b.titulo+' '+b.texto,activo)-puntuacion(a.url,a.titulo+' '+a.texto,activo));
  // Evita que un solo dominio llene el cupo: repartir las fichas entre fuentes.
  const colas=new Map();
  for(const doc of documentos){
    if(!colas.has(doc.fuente_id))colas.set(doc.fuente_id,[]);
    colas.get(doc.fuente_id).push(doc);
  }
  const seleccion=[];
  while(seleccion.length<lim.max_documentos_para_ia && [...colas.values()].some(l=>l.length)){
    for(const lista of colas.values()){
      if(lista.length&&seleccion.length<lim.max_documentos_para_ia)seleccion.push(lista.shift());
    }
  }
  tr(trace,'CRAWLER_FIN',{duracion_ms:Date.now()-inicio,estadisticas:stats,
    documentos_enviados_ia:seleccion.map(x=>({url:x.url,fuente:x.fuente_id,
      caracteres:x.fragmento.length})),
    motivo:seleccion.length?'DOCUMENTOS_ENCONTRADOS':Date.now()>=deadline?'CRAWLER_TIEMPO_TOTAL_AGOTADO':'CRAWLER_SIN_DOCUMENTOS'});
  return {documentos:seleccion,consultas,estadisticas:stats,
    motivo:seleccion.length?'OK':Date.now()>=deadline?'CRAWLER_TIEMPO_TOTAL_AGOTADO':'CRAWLER_SIN_DOCUMENTOS'};
}
module.exports={buscarDocumentos,limpiarHtml,extractoTecnico,linksHtml,puntuacion,
  permitidoRobots,reglasRobots,sitemapUrls,publica,dnsPublico,solicitar};
