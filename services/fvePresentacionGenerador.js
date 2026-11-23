'use strict';
/** Presentación FVE: mismo lenguaje visual de la plantilla del piloto HORECA.
 *  Generada fuera del hilo principal por un Worker. Solo usa datos entregados por SQL.
 */
const pptxgen=require('pptxgenjs');
const sharp=require('sharp');
const path=require('path');
const fs=require('fs').promises;

const C={bg:'F6F8F1',green:'3B684A',deep:'22312A',olive:'7A8F1F',line:'D9E2D3',muted:'5C6B62',pale:'EAF0E8',white:'FFFFFF',gray:'F8FAF7'};
const W=13.333333333333334, H=7.5;
const ND='N/D';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
const txt=v=>v===null||v===undefined||v===''?ND:(typeof v==='object'?JSON.stringify(v):String(v)).trim()||ND;
const fecha=v=>{if(!v)return ND;const d=new Date(v);return Number.isNaN(d.getTime())?txt(v):new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);};
const dinero=v=>v==null||v===''?ND:(Number.isFinite(Number(v))?new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(v)):txt(v));
const corto=(v,n=90)=>{const t=txt(v);return t.length<=n?t:t.slice(0,n-1)+'…';};
const unir=(...parts)=>parts.filter(v=>v!=null&&txt(v)!==ND).map(v=>txt(v)).join(' · ')||ND;
const uso=a=>{const p=obj(obj(a.datos).fve_perfil_uso);const etiquetas={continuo:'Continuo',apagado:'Apagado al cierre',parcial:'Uso parcial',espera:'Modo espera',sin_uso:'Sin uso fuera del horario',uso_fuera:'Usado fuera del horario',desconocido:'No se conoce'};return etiquetas[p.modo]||ND;};
const tecnico=(a,nombres)=>{const f=obj(obj(a.ficha_fve).datos_tecnicos), d=obj(a.datos);
  for(const k of nombres){let v=f[k]??d[k];if(v!==null&&v!==undefined&&v!==''){
    if(v&&typeof v==='object'&&'valor' in v)return unir(v.valor,v.unidad,v.fuente?`Fuente: ${v.fuente}`:null);
    return txt(v);
  }}return ND;
};
const dividir=(cadena,max=900)=>{
  const t=String(cadena??'').trim();if(!t)return[ND];
  const salida=[];let resto=t;
  while(resto.length){if(resto.length<=max){salida.push(resto);break;}
    let corte=resto.lastIndexOf(' ',max);if(corte<max*.55)corte=max;
    salida.push(resto.slice(0,corte).trim());resto=resto.slice(corte).trimStart();
  }
  return salida;
};
const serial=(x)=>{if(x==null)return ND;
  if(Array.isArray(x))return x.map(v=>serial(v)).join('; ')||ND;
  if(typeof x==='object')return Object.entries(x).map(([k,v])=>`${k}: ${serial(v)}`).join('; ')||ND;
  return txt(x);
};
function construirEsquema(datos, pptx) {
  const ST=pptx.ShapeType;
  let paginas=0;
  const slideBase=(titulo,sub='')=>{
    if(paginas>=450)throw Error('Demasiadas diapositivas para una sola exportacion (>450).');
    const s=pptx.addSlide();paginas++;s.background={color:C.bg};
    titulo=corto(titulo,115);
    s.addText(titulo,{x:.36,y:.33,w:11.35,h:.69,margin:0,fontFace:'Georgia',fontSize:titulo.length>66?22:28,bold:true,color:C.green,fit:'shrink'});
    s.addImage({path:path.join(__dirname,'../assets/fve/logo_fina.png'),x:11.80,y:.188,w:1.45,h:.80});
    if(sub)s.addText(corto(sub,175),{x:.53,y:1.12,w:12.15,h:.32,fontFace:'Calibri',fontSize:10.5,bold:true,color:C.olive,breakLine:false,margin:0,fit:'shrink'});
    s.addText(String(paginas),{x:12.51,y:7.05,w:.40,h:.20,fontFace:'Calibri',fontSize:9,color:C.muted,margin:0,align:'center'});
    return s;
  };
  const T=(s,t,x,y,w,h,o={})=>s.addText(String(t??ND),{x,y,w,h,margin:0,fontFace:'Calibri',fontSize:11.8,color:C.deep,valign:'mid',breakLine:false,fit:'shrink',...o});
  const G=(s,t,x,y,w,h,o={})=>T(s,t,x,y,w,h,{fontFace:'Georgia',color:C.green,bold:true,...o});
  const caja=(s,x,y,w,h,title)=>{s.addShape(ST.roundRect,{x,y,w,h,rectRadius:.14,line:{color:C.line,width:1},fill:{color:C.white}});G(s,title,x+.18,y+.16,w-.36,.36,{fontSize:16});s.addShape(ST.line,{x:x+.18,y:y+.61,w:w-.36,h:0,line:{color:C.line,width:.8}});};
  const campo=(s,x,y,w,l,v,lab=1.6,altura=.40)=>{
    T(s,l,x,y+.08,lab,altura-.08,{fontSize:10.8,bold:true,color:C.muted});
    s.addShape(ST.roundRect,{x:x+lab+.04,y,w:w-lab-.04,h:altura,rectRadius:.04,line:{color:'E2E9DE',width:.6},fill:{color:C.gray}});
    T(s,corto(v,210),x+lab+.14,y+.03,w-lab-.25,altura-.05,{fontSize:11.4,color:C.deep});
  };
  const banda=(s,x,y,w,h,t,sub='')=>{s.addShape(ST.roundRect,{x,y,w,h,rectRadius:.09,line:{color:C.line,width:.75},fill:{color:C.pale}});G(s,t,x+.15,y+.065,w-.30,.30,{fontSize:13});if(sub)T(s,sub,x+.15,y+.37,w-.3,h-.38,{fontSize:10.3,color:C.muted,valign:'top'});};
  const nota=(s,t)=>T(s,corto(t,245),.55,6.94,12.1,.24,{fontSize:10.2,italic:true,color:C.muted});
  const tabular=(s,headers,filas,y,xs,altFila=.45)=>{
    const totalW=xs.reduce((a,b)=>a+b,0);
    let x=.52;
    for(let j=0;j<headers.length;j++){
      s.addShape(ST.rect,{x,y,w:xs[j],h:.46,line:{color:C.line,width:.5},fill:{color:C.green}});
      T(s,headers[j],x+.08,y+.03,xs[j]-.16,.36,{fontSize:10.4,bold:true,color:C.white});x+=xs[j];
    }
    filas.forEach((fila,i)=>{let xx=.52;
      for(let j=0;j<headers.length;j++){
        const yy=y+.46+i*altFila;
        s.addShape(ST.rect,{x:xx,y:yy,w:xs[j],h:altFila,line:{color:C.line,width:.5},fill:{color:i%2===0?'FFFFFF':'F0F4ED'}});
        T(s,corto(fila[j]??'',300),xx+.08,yy+.02,xs[j]-.16,altFila-.04,{fontSize:10.5,color:C.deep});xx+=xs[j];
      }
    });
    return totalW;
  };
  return {slideBase,T,G,caja,campo,banda,nota,tabular,get paginas(){return paginas;}};
}
function horarioss(m) {
  const dias=obj(obj(m.horario_operacion).dias);
  return Object.entries(dias).map(([dia,r])=>{
    const o=obj(r);return `${dia}: ${unir(o.inicio,o.fin)}`;
  });
}
async function generarPresentacionEmpresa(data,{rutaSalida,uploads,progreso=()=>{}}={}) {
  if(!rutaSalida||!uploads)throw Error('Configuracion de exportacion incompleta');
  const p=new pptxgen();p.defineLayout({name:'FVE',width:W,height:H});p.layout='FVE';
  p.author='Finanfuturo';p.subject='Informe de una empresa, generado con registros de Finanzas Verdes';
  p.title=`Finanzas Verdes - ${txt(obj(data.empresa).nombre_mipyme)}`;p.lang='es-CO';
  const D=construirEsquema(data,p),m=obj(data.empresa),activos=arr(data.activos),facturas=arr(data.facturas),evaluacion=obj(data.evaluacion);
  const diags=arr(data.diagnosticos),q=arr(data.preguntas),logoDir=path.resolve(uploads);
  const avisos=[];
  const avisa=v=>{if(!avisos.includes(v))avisos.push(v);};
  const t=()=>progreso(`Preparando diapositiva ${D.paginas}`);
  const foto=async(informacion)=>{
    const nombre=txt(obj(informacion).nombre_fisico);
    if(!/^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(nombre)){avisa('Hay fotos sin nombre de archivo compatible.');return null;}
    const destino=path.resolve(logoDir,nombre);
    if(!destino.startsWith(logoDir+path.sep)){avisa('Ruta de evidencia no valida.');return null;}
    try {
      const rutaReal=await fs.realpath(destino);
      if(!rutaReal.startsWith(logoDir+path.sep))throw Error('Fuera de uploads');
      const st=await fs.stat(rutaReal);if(!st.isFile()||st.size>12*1024*1024||st.size===0)throw Error('Archivo excesivo o vacio');
      const pipeline=sharp(rutaReal,{limitInputPixels:25e6,pages:1}).rotate().resize({width:1000,height:750,fit:'inside',withoutEnlargement:true}).jpeg({quality:78,mozjpeg:true});
      const buf=await pipeline.toBuffer({resolveWithObject:true});
      return {data:`image/jpeg;base64,${buf.data.toString('base64')}`,w:buf.info.width,h:buf.info.height};
    }catch(_){avisa('Algunas fotografias no estan disponibles o no pudieron procesarse en el servidor.');return null;}
  };
  const imagenEn=(s,im,x,y,w,h)=>{
    s.addShape(p.ShapeType.roundRect,{x,y,w,h,rectRadius:.06,line:{color:'C8D8C5',width:.8,dashType:'dash'},fill:{color:'F4F7F2'}});
    if(!im){D.T(s,'Fotografía no disponible',x+.14,y+h*.40,w-.28,.3,{fontSize:11,color:C.muted,align:'center'});return;}
    const escala=Math.min(w/im.w,h/im.h), iw=im.w*escala,ih=im.h*escala;
    s.addImage({data:im.data,x:x+(w-iw)/2,y:y+(h-ih)/2,w:iw,h:ih});
  };
  const respaldo=(titulo,contenido,{fuente='Datos registrados en Finanzas Verdes',aviso='IA: referencia sujeta a verificacion; no sustituye mediciones.'}={})=>{
    for(const [indice,part] of dividir(contenido,1600).entries()){
      const s=D.slideBase(corto(titulo,90),`DETALLE / RESPALDO · PARTE ${indice+1}`);
      D.caja(s,.52,1.55,12.29,4.98,'Información disponible en la aplicación');
      D.T(s,part,.78,2.30,11.75,4.0,{fontSize:14.6,valign:'top',breakLine:false});
      D.nota(s,`${fuente}. ${aviso}`);t();
    }
  };
  const observacion=(titulo,detalle)=>{if(txt(detalle)!==ND)respaldo(titulo,detalle);};

  // 1. Información empresarial, la misma distribución doble de la plantilla.
  {
    const s=D.slideBase(`${txt(m.nombre_mipyme)}: información empresarial`,'FICHA DE REGISTRO Y VISITA');
    D.caja(s,.52,1.55,6.05,4.77,'Identificación de la empresa');
    const iz=[['Nombre comercial',m.nombre_mipyme],['Razón social',m.razon_social],['Documento / NIT',m.nit],['Subsector HORECA',m.tipo_empresa],['Actividad / CIIU',unir(m.sector_economico,m.codigo_ciiu)],['Departamento',m.departamento],['Municipio',m.municipio],['Dirección',m.direccion]];
    iz.forEach(([k,v],j)=>D.campo(s,.74,2.28+j*.47,5.62,k,txt(v),1.57,.38));
    D.caja(s,6.77,1.55,6.04,4.77,'Visita, contacto y operación');
    const co=arr(data.contactos)[0]||{},horarios=horarioss(m);
    const dr=[['Fecha de visita',fecha(evaluacion.fecha_visita)],['Asesor/a',obj(data.asesor).nombre_usuario],['ID cliente / Mipyme',unir(co.id_usuario,m.id_mipyme)],['Contacto',co.nombre_usuario],['Teléfono / correo',unir(co.telefono,co.email)],['Horario de atención',horarios[0]],['Días de operación',horarios.map(x=>x.split(':')[0]).join(', ')],['Tipo de facturación',m.tipo_factura]];
    dr.forEach(([k,v],j)=>D.campo(s,6.97,2.28+j*.47,5.63,k,txt(v),1.57,.38));
    D.banda(s,.53,6.47,12.29,.40,corto(m.descripcion_empresa||'Sin observaciones empresariales registradas',215));t();
    respaldo('Información empresarial complementaria',`ID Mipyme: ${txt(m.id_mipyme)}\nBarrio: ${txt(m.barrio)}\nEstrato: ${txt(m.estrato)}\nTipo de persona: ${txt(m.tipo_persona)}\nPersonal registrado: ${txt(m.cantidad_empleados)}\nIngresos registrados: ${dinero(m.ingresos)}\nEgresos registrados: ${dinero(m.egresos)}\nHorario completo: ${horarios.join('; ')||ND}\nDescripción: ${txt(m.descripcion_empresa)}`);
  }

  // 2. Facturas: dos tarjetas como la plantilla; repetir por factura y por foto.
  const identificarTipo=f=>String(f.tipo||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const energia=facturas.filter(f=>/energia|electr/.test(identificarTipo(f)));
  const agua=facturas.filter(f=>/agua|acueduct/.test(identificarTipo(f)));
  const otros=facturas.filter(f=>!energia.includes(f)&&!agua.includes(f));
  const pares=[];
  for(let i=0;i<Math.max(energia.length,agua.length);i++)pares.push([energia[i]||null,agua[i]||null]);
  for(let i=0;i<otros.length;i+=2)pares.push([otros[i],otros[i+1]||null]);
  if(!pares.length)pares.push([null,null]);
  for(const [index,par] of pares.entries()){
    const ima=[arr(obj(par[0]).imagenes),arr(obj(par[1]).imagenes)];
    const paginas=Math.max(1,ima[0].length,ima[1].length);
    for(let k=0;k<paginas;k++){
      const s=D.slideBase(`${txt(m.nombre_mipyme)}: facturas registradas (${index+1}/${pares.length})`,paginas>1?`EVIDENCIA FOTOGRÁFICA ${k+1}/${paginas}`:'DATOS Y EVIDENCIA REGISTRADOS');
      for(let side=0;side<2;side++){
        const f=obj(par[side]), x=side===0?.52:6.77;
        D.caja(s,x,1.55,6.04,5.20,side===0?'Factura de energía / servicio':'Factura de agua / servicio');
        const filas=[['Empresa prestadora',f.proveedor],['ID factura',f.id_consumo],['Período facturado',unir(fecha(f.periodo_inicio),fecha(f.periodo_fin))],['Fecha de la factura',fecha(f.created_at)],['Consumo registrado',unir(f.consumo,f.unidad)],['Valor facturado',dinero(f.valor)],['Tarifa / costo unitario',dinero(f.costo_unitario)]];
        filas.forEach(([label,val],j)=>D.campo(s,x+.20,2.24+j*.41,5.62,label,val,1.75,.37));
        imagenEn(s,k<ima[side].length?await foto(ima[side][k]):null,x+.22,5.22,5.58,1.22);
      }D.nota(s,'Los valores provienen de registros de facturas. N/D significa dato no disponible, no cero.');t();
    }
  }
  for(const f of facturas){observacion(`Factura ${txt(f.id_consumo)}: observaciones`,unir(f.observaciones,f.observacion_ia));}

  // 3. Inventario en bloques de 8 filas, sin perder activos.
  for(let start=0;start<Math.max(1,activos.length);start+=8){
    const s=D.slideBase(`${txt(m.nombre_mipyme)}: inventario de activos`,'REGISTROS DE LA APP · FICHAS DETALLADAS A CONTINUACIÓN');
    D.banda(s,.52,1.53,12.29,.48,`Inventario · registros ${activos.length?`${start+1} a ${Math.min(start+8,activos.length)}`:'no disponibles'}`);
    const encabezados=['ID','Activo / categoría','Marca y modelo','Año / capacidad','Perfil de uso','Fotografías','Análisis IA'];
    const filas=activos.slice(start,start+8).map(a=>[txt(a.id_activo),unir(a.nombre,a.tipo),unir(a.marca,a.modelo),tecnico(a,['anio_equipo','anio','capacidad_actual']),uso(a),String(arr(a.imagenes).length),txt(a.observacion_ia)===ND?'Pendiente':'Con análisis']);
    D.tabular(s,encabezados,filas,2.22,[.72,2.35,2.25,1.9,2.45,1.26,1.32],.49);
    D.nota(s,'La ficha técnica y el análisis IA se muestran por separado; los valores estimados no se consideran mediciones.');t();
  }

  // 4. Cada activo y todas sus fotos; los datos técnicos amplios van a páginas de respaldo.
  for(const a of activos){
    const fotos=arr(a.imagenes),n=Math.max(1,Math.ceil(fotos.length/2));
    for(let i=0;i<n;i++){
      const s=D.slideBase(`Activo ${txt(a.id_activo)}: ${corto(a.nombre,65)}`,`FICHA DE ACTIVO · ${i+1}/${n}`);
      D.caja(s,.52,1.56,6.05,4.41,'Datos del activo registrado');
      const filas=[['ID del activo',a.id_activo],['Nombre / categoría',unir(a.nombre,a.tipo)],['Marca y modelo',unir(a.marca,a.modelo)],['Año / antigüedad',tecnico(a,['anio_equipo','anio','año'])],['Capacidad / potencia',tecnico(a,['capacidad_actual','capacidad','potencia'])],['Consumo actual',tecnico(a,['consumo_actual','consumo_kwh_mes','consumo'])],['Uso / funcionamiento',uso(a)]];
      filas.forEach(([l,v],j)=>D.campo(s,.72,2.28+j*.49,5.64,l,v,1.78,.39));
      D.caja(s,6.78,1.56,6.03,4.41,'Evidencia fotográfica');
      imagenEn(s,i*2<fotos.length?await foto(fotos[2*i]):null,7.00,2.35,2.76,2.48);
      imagenEn(s,i*2+1<fotos.length?await foto(fotos[2*i+1]):null,9.86,2.35,2.71,2.48);
      D.T(s,`Fotos registradas: ${fotos.length}`,7.02,5.16,5.55,.3,{color:C.muted});
      D.banda(s,.52,6.10,6.05,.71,'Datos de uso y medición',corto(serial(obj(obj(a.datos).fve_perfil_uso).mediciones),130));
      D.banda(s,6.78,6.10,6.03,.71,'Estado del análisis con IA',txt(a.observacion_ia)===ND?'No hay análisis IA guardado':'Disponible (ver respaldo)');t();
    }
    const tec=obj(obj(a.ficha_fve).datos_tecnicos),datosBrutos=obj(a.datos);
    respaldo(`Activo ${txt(a.id_activo)}: ficha técnica y uso`,
      `Nombre: ${txt(a.nombre)}. Categoría: ${txt(a.tipo)}.\n`+
      `Ficha FVE: ${serial(tec)}\nEstado ficha: ${txt(obj(a.ficha_fve).estado_datos)}\n`+
      `Perfil de uso declarado: ${serial(datosBrutos.fve_perfil_uso)}\n`+
      `Otros datos guardados: ${serial(Object.fromEntries(Object.entries(datosBrutos).filter(([k])=>!['fve_perfil_uso','fve_sugerencias_ia','fve_estimaciones_ia'].includes(k))))}\n`+
      `Sugerencias IA (NO verificadas): ${serial(datosBrutos.fve_sugerencias_ia)}\nEstimaciones IA (NO verificadas): ${serial(datosBrutos.fve_estimaciones_ia)}\n`+
      `Observaciones ficha: ${txt(obj(a.ficha_fve).observaciones)}`);
    observacion(`Activo ${txt(a.id_activo)}: análisis de IA`,a.observacion_ia);
  }

  // 5-6. Las 16 preguntas reales, sin textos supuestos.
  const respuestas=obj(evaluacion.respuestas),puntajes=obj(evaluacion.puntajes),mapPreg=new Map(q.map(a=>[Number(a.numero),a]));
  for(const [desde,hasta] of [[1,8],[9,16]]){
    const s=D.slideBase(`${txt(m.nombre_mipyme)}: evaluación ambiental (${desde===1?1:2}/2)`,'CUESTIONARIO GUARDADO · RESPUESTAS Y OBSERVACIONES');
    D.banda(s,.52,1.49,12.29,.46,`Preguntas ${desde} a ${hasta} de la evaluación`);
    const filas=[];
    for(let n=desde;n<=hasta;n++){
      const registro=obj(respuestas[String(n)]);
      filas.push([String(n),txt(obj(mapPreg.get(n)).texto),serial(registro.valor),txt(registro.observacion)]);
    }
    D.tabular(s,['N.º','Pregunta registrada','Respuesta / selección','Observación de la visita'],filas,2.13,[.65,6.45,2.37,2.83],.465);
    if(desde===9){const labs=[1,3,4,5];
      labs.forEach((n,j)=>D.banda(s,.52+j*2.54,6.36,2.37,.55,`Bloque ${n}: ${txt(puntajes[String(n)])}`));
      D.banda(s,10.7,6.36,2.08,.55,`AD-07: ${txt(evaluacion.indice_ad07)}`);
    }
    D.nota(s,`Estado: ${txt(evaluacion.estado)}. Versión: ${txt(evaluacion.version_formulario)}. Los campos sin registro se muestran como N/D.`);t();
  }
  for(const n of Array.from({length:16},(_,i)=>i+1)){
    const r=obj(respuestas[String(n)]),preg=txt(obj(mapPreg.get(n)).texto);
    if(preg.length>80||serial(r.valor).length>40||txt(r.observacion).length>50){
      respaldo(`Evaluación ambiental: pregunta ${n}`,`Pregunta oficial: ${preg}\nRespuesta guardada: ${serial(r.valor)}\nObservación: ${txt(r.observacion)}`);
    }
  }
  observacion('Evaluación ambiental: observación general',evaluacion.observacion_general);

  // 7-8. Diagnósticos reales de IA. El detalle completo se conserva en respaldos.
  const resumenFacturas=facturas.map(f=>`${txt(f.tipo)} (${fecha(f.periodo_fin)}): ${unir(f.consumo,f.unidad)} / ${dinero(f.valor)}`).join('\n')||'No hay facturas guardadas';
  if(!diags.length){const s=D.slideBase(`${txt(m.nombre_mipyme)}: diagnóstico IA`,'SIN RESULTADOS DE IA DISPONIBLES');D.caja(s,.52,1.50,12.29,4.9,'Resultado del diagnóstico');D.T(s,'No se encontró un diagnóstico de IA guardado para esta empresa.',.83,2.35,11.5,1.2,{fontSize:18});t();}
  for(const [i,d] of diags.entries()){
    const prob=obj(d.problema),bene=obj(d.beneficios),met=obj(d.metricas);
    const s=D.slideBase(`Diagnóstico IA ${i+1}/${diags.length}: ${corto(d.titulo,72)}`,'RESUMEN PARA SOCIALIZAR · SUJETO A REVISIÓN TÉCNICA');
    const bloques=[['Problema identificado',unir(prob.resumen,prob.detalle)],['Beneficio y oportunidad',unir(bene.resumen,bene.detalle)],['Consumos y costos registrados',resumenFacturas],['Alternativas y recomendaciones',serial(met.activos)||ND]];
    for(let j=0;j<4;j++){
      const x=j%2===0?.52:6.77,y=j<2?1.50:4.01;
      D.caja(s,x,y,6.05,2.25,bloques[j][0]);D.T(s,corto(bloques[j][1],720),x+.24,y+.75,5.54,1.28,{fontSize:13.1,valign:'top'});
    }
    D.nota(s,'Los resultados IA son estimaciones o hallazgos no verificados. No garantizan ahorros ni sustituyen auditorías.');t();
    respaldo(`Diagnóstico ${txt(d.id_diagnostico)}: problema y beneficios`,
      `Título: ${txt(d.titulo)}\nFecha: ${fecha(d.created_at)}\nProblema: ${serial(d.problema)}\nBeneficios: ${serial(d.beneficios)}`);
    respaldo(`Diagnóstico ${txt(d.id_diagnostico)}: métricas y alternativas`,
      `Métricas y oportunidades sugeridas: ${serial(d.metricas)}\nEvidencia de catálogo: ${serial(d.evidencia_catalogo)}`);
  }
  // Respaldo general: origen de datos y advertencias, siguiendo la última diapositiva de la plantilla.
  {
    const s=D.slideBase(`${txt(m.nombre_mipyme)}: respaldo y limitaciones`,'CONTROL DE CALIDAD · SEPARAR DATOS, DECLARACIONES Y ESTIMACIONES');
    D.caja(s,.52,1.55,12.29,3.0,'Alcance del informe');
    D.T(s,`Empresa: ${txt(m.nombre_mipyme)}\nFacturas registradas: ${facturas.length}\nActivos registrados: ${activos.length}\nEvaluación ambiental: ${Object.keys(evaluacion).length?'Registrada':'No registrada'}\nDiagnósticos IA: ${diags.length}\nFecha de exportación: ${fecha(data.fechaExportacion)}`,.79,2.26,11.70,1.94,{fontSize:15,valign:'top'});
    D.caja(s,.52,4.76,6.04,1.75,'Fuentes y evidencia');
    D.T(s,'Registros de Finanzas Verdes: información de empresa, facturas, fichas, fotografías, evaluación y diagnósticos guardados.',.74,5.43,5.55,.83,{fontSize:12.4,valign:'top'});
    D.caja(s,6.77,4.76,6.04,1.75,'Limitaciones');
    D.T(s,`N/D significa no disponible. IA y proyecciones no equivalen a mediciones verificadas. Fotos inaccesibles: ${avisos.length?'revisar advertencias':'ninguna detectada'}.`,6.99,5.43,5.55,.83,{fontSize:12.4,valign:'top'});t();
  }
  for(const aviso of avisos)respaldo('Advertencia de evidencia',aviso);
  progreso('Guardando presentación PowerPoint');
  await p.writeFile({fileName:rutaSalida,compression:true});
  const stat=await fs.stat(rutaSalida);
  if(!stat.size||stat.size>60*1024*1024){await fs.unlink(rutaSalida).catch(()=>{});throw Error('Archivo PowerPoint demasiado grande; requiere exportación segmentada.');}
  return {diapositivas:D.paginas,advertencias:avisos};
}
module.exports={generarPresentacionEmpresa};
