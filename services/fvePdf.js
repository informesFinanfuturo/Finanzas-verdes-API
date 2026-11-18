'use strict';
// Generador PDF basico sin dependencias externas ni archivos temporales.
// Cada PDF representa una propuesta ya congelada. No es un comprobante de credito.
const { createHash } = require('node:crypto');
function limpiar(valor) {
  return String(valor == null ? '' : valor).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[\u2010-\u2015]/g,'-')
    .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\u0020-\u007e\u00a0-\u00ff]/g,'?').trim();
}
function formatoPesos(v) {return '$ '+Number(v||0).toLocaleString('es-CO',{maximumFractionDigits:0});}
function generarPdfPropuesta(propuesta) {
  const d=propuesta.detalle || propuesta;
  const lineas=Array.isArray(d.lineas)?d.lineas:[];
  const paginas=[];let ops=[],y=780;
  function txt(str,x=45,size=10,bold=false){
    const s=limpiar(str).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
    ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
    y-=size+7;
  }
  function fin(){paginas.push(Buffer.from(ops.join('\n'),'latin1'));ops=[];y=780;}
  function nuevapagina(){fin();cabecera(false);}
  function cabecera(inicial=true){
    txt('FINANFUTURO | FINANZAS VERDES',45,13,true);
    txt('Propuesta comercial ambiental - Piloto',45,11,true);
    txt(`Proceso #${propuesta.id_proceso || d.id_proceso || '-'} | Version ${propuesta.numero_version || d.numero_version || '-'}`,45,10);
    if(inicial){txt(`Diagnostico #${d.id_diagnostico || '-'} | Empresa ${d.nombre_mipyme || '-'}`);txt(`Preparada: ${d.fecha_corte || '-'}`);}
    y-=10;ops.push(`0.20 0.39 0.29 RG 45 ${y} m 550 ${y} l S`);y-=20;
  }
  function linea(txtVal,espacio=0){
    const palabras=limpiar(txtVal).split(' ');let tramo='';
    for(const palabra of palabras){
      const nuevo=(tramo?tramo+' ':'')+palabra;
      if(nuevo.length>78 && tramo){if(y<90)nuevapagina();txt(tramo);tramo=palabra;}
      else tramo=nuevo;
    }
    if(tramo){if(y<90)nuevapagina();txt(tramo);}
    y-=espacio;
  }
  cabecera(true);
  linea('PRODUCTOS Y VALORES',8);
  for(let i=0;i<lineas.length;i++){
    const l=lineas[i];
    linea(`${i+1}. ${limpiar(l.activo_nombre).slice(0,67)}  ->  ${limpiar(l.producto_nombre).slice(0,68)}`,2);
    linea(`Proveedor: ${limpiar(l.proveedor_nombre).slice(0,86)}`);
    linea(`Unidades: ${l.cantidad}    Unitario: ${formatoPesos(l.precio_unitario)}    Subtotal: ${formatoPesos(l.subtotal)}`,8);
    linea(`Evaluacion ambiental: ${limpiar(l.estado_ambiental || 'pendiente_dato')}`);
    if(l.ahorro_estimado_anual != null) linea(`Ahorro tecnico estimado: ${l.ahorro_estimado_anual} ${limpiar(l.unidad_ahorro || '')}/ano`);
    y-=7;
  }
  if(y<190)nuevapagina();
  linea(`TOTAL INVERSION ESTIMADA: ${formatoPesos(d.total_inversion)}`,12);
  linea('OBSERVACIONES Y CONDICIONES',8);
  linea('Precios del catalogo sujetos a disponibilidad y verificacion al presentar.');
  linea('Los ahorros son estimaciones tecnicas y pueden requerir datos adicionales.');
  linea('No incluye transporte, instalacion o impuestos no consignados en el catalogo.');
  linea('No constituye aprobacion de credito, contrato ni desembolso.');
  linea('La elegibilidad ambiental de cada articulo figura en el detalle.');
  if(d.observacion) linea(`Observacion: ${limpiar(d.observacion).slice(0,105)}`);
  fin();
  const objetos=[];
  const poner = s => {objetos.push(Buffer.isBuffer(s)?s:Buffer.from(s,'latin1'));return objetos.length;};
  poner('<< /Type /Catalog /Pages 2 0 R >>');
  const pageCount=paginas.length;
  poner(`<< /Type /Pages /Kids [${paginas.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  poner('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  poner('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  for(const pg of paginas){
    const contentId=objetos.length+2;
    poner(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    poner(Buffer.concat([Buffer.from(`<< /Length ${pg.length} >>\nstream\n`,'latin1'),pg,Buffer.from('\nendstream','latin1')]));
  }
  let pdf=Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1');const offsets=[0];
  for(let i=0;i<objetos.length;i++){
    offsets.push(pdf.length);
    pdf=Buffer.concat([pdf,Buffer.from(`${i+1} 0 obj\n`,'latin1'),objetos[i],Buffer.from('\nendobj\n','latin1')]);
  }
  const start=pdf.length;
  pdf=Buffer.concat([pdf,Buffer.from(`xref\n0 ${objetos.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objetos.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`,'latin1')]);
  return {buffer:pdf,sha256:createHash('sha256').update(pdf).digest('hex'),paginas:pageCount};
}
module.exports={generarPdfPropuesta,formatoPesos};
