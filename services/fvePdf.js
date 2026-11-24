'use strict';
// PDF comercial FVE, conforme a la maqueta HTML institucional aprobada.
// Preview y emision usan el mismo generador, nunca un HTML simulado en Flutter.
const { createHash } = require('node:crypto');
const { cssAprobado, logoDataUri } = require('./fvePropuestaPlantilla');

const VERDE = '#256446';
let browserPromise = null;
let renderizacionesActivas = 0;

function texto(valor) {
  return valor == null ? '' : String(valor);
}
function html(valor) {
  return texto(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function nSeguro(valor) {
  if (valor == null || (typeof valor === 'string' && !valor.trim())) return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function formatoPesos(valor) {
  const n = nSeguro(valor);
  return n === null ? 'Por confirmar' : '$ ' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
}
function fechaDocumento(valor) {
  if (!valor) return 'No registrada';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return 'No registrada';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Bogota' }).format(d);
}
function estadoAmbiental(estado) {
  switch (texto(estado).trim().toLowerCase()) {
    case 'elegible': return 'Elegible seg\u00fan evaluaci\u00f3n ambiental registrada';
    case 'no_elegible': return 'No elegible seg\u00fan evaluaci\u00f3n registrada';
    case 'fuera_alcance': return 'Fuera del alcance de la evaluaci\u00f3n actual';
    case 'pendiente_validacion': return 'Pendiente de validaci\u00f3n ambiental';
    default: return 'Evaluaci\u00f3n pendiente de informaci\u00f3n t\u00e9cnica';
  }
}
function ahorroSustentado(linea) {
  const val = Number(linea.ahorro_estimado_anual);
  if (texto(linea.estado_ambiental).toLowerCase() !== 'elegible' ||
      linea.ahorro_estimado_anual == null || !Number.isFinite(val) || val <= 0 ||
      !texto(linea.unidad_ahorro).trim()) return '';
  const unidad = texto(linea.unidad_ahorro).trim().replace(/\/anio$/i, '/a\u00f1o');
  return `Ahorro t\u00e9cnico estimado, no verificado: ${val.toLocaleString('es-CO', {maximumFractionDigits: 3})} ${unidad}`;
}
function construirHtmlPropuesta(propuesta) {
  if (!propuesta || typeof propuesta !== 'object') throw new Error('Propuesta no v\u00e1lida');
  const d = propuesta.detalle || propuesta;
  const lineas = Array.isArray(d.lineas) ? d.lineas : [];
  if (!lineas.length || lineas.length > 100) throw new Error('Propuesta sin reemplazos v\u00e1lidos');
  const proceso = nSeguro(propuesta.id_proceso || d.id_proceso);
  const version = nSeguro(propuesta.numero_version || d.numero_version);
  const diagnostico = nSeguro(d.id_diagnostico);
  const empresa = texto(d.nombre_mipyme).trim() || 'Empresa no identificada';
  const fecha = fechaDocumento(d.fecha_corte || propuesta.created_at);
  const unidades = lineas.reduce((acc, l) => acc + (nSeguro(l.cantidad) || 0), 0);
  const numero = lineas.length;
  const resumen = numero === 1
    ? `Como parte del proceso de Finanzas Verdes se propone reemplazar el equipo registrado como <strong>${html(lineas[0].activo_nombre || 'activo del diagn\u00f3stico')}</strong>. Se presenta el producto seleccionado, su proveedor, la inversi\u00f3n y la evaluaci\u00f3n ambiental disponible.`
    : `Como parte del proceso de Finanzas Verdes se proponen intervenciones sobre <strong>${numero} equipos del diagn\u00f3stico</strong>. El documento resume los productos elegidos, sus proveedores, el valor de la inversi\u00f3n y las evaluaciones ambientales disponibles.`;

  const filas = lineas.map(l => {
    const cant = nSeguro(l.cantidad);
    const unitario = nSeguro(l.precio_unitario);
    const sub = nSeguro(l.subtotal);
    const proveedor = texto(l.proveedor_nombre).trim();
    return `<tr><td><strong>${html(l.activo_nombre || 'Equipo sin nombre')}</strong></td>
      <td><strong>${html(l.producto_nombre || 'Producto sin nombre')}</strong>
        ${proveedor ? `<div class="small">Proveedor: ${html(proveedor)}</div>` : ''}</td>
      <td>${cant === null ? 'Por confirmar' : cant}</td>
      <td class="money"><strong>${html(formatoPesos(sub))}</strong>
        <div class="small">Unitario: ${html(formatoPesos(unitario))}</div></td></tr>`;
  }).join('\n');

  const lineasAmbientales = lineas.map((l, i) => {
    const ahorro = ahorroSustentado(l);
    const estado = estadoAmbiental(l.estado_ambiental);
    return `<p><span class="label-inline">${html(l.activo_nombre || `Equipo ${i + 1}`)}:</span>
      ${html(estado)}.${ahorro ? `<br>${html(ahorro)}.` : ''}</p>`;
  }).join('\n');

  const observacion = texto(d.observacion).trim();
  const observacionesHtml = observacion
    ? `<section class="section observaciones"><h2>Observaciones registradas</h2><p>${html(observacion)}</p></section>` : '';

  const footerId = `Proceso N.&ordm; ${html(proceso ?? '-')}`;
  const versionTxt = `V${html(version ?? '-')}`;
  const tituloDiagnostico = texto(propuesta.diagnostico_titulo || '').trim();
  const datoDiagnostico = diagnostico === null ? 'No registrado' :
    `N.&ordm; ${diagnostico}${tituloDiagnostico ? `<div class="small">${html(tituloDiagnostico)}</div>` : ''}`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light"><title>Propuesta de inversi\u00f3n - ${html(empresa)}</title>
    <style>${cssAprobado}</style></head>
    <body><main class="sheet">
      <header class="head"><img class="logo" alt="Finanfuturo" src="${logoDataUri}">
        <div class="head-right"><strong>FINANZAS VERDES</strong>
          Propuesta comercial<br>Documento para revisi\u00f3n</div></header>
      <hr class="accent">
      <div class="eyebrow">Propuesta comercial ambiental</div>
      <h1>Propuesta de inversi\u00f3n</h1>
      <p class="subtitle">Una alternativa concreta para la renovaci\u00f3n de equipos de la empresa.</p>
      <div class="metadata">
        <div><span class="meta-label">Empresa</span><div class="meta-value">${html(empresa)}</div></div>
        <div><span class="meta-label">Proceso</span><div class="meta-value">${footerId}</div></div>
        <div><span class="meta-label">Diagn\u00f3stico</span><div class="meta-value">${datoDiagnostico}</div></div>
        <div><span class="meta-label">Fecha &middot; Versi\u00f3n</span><div class="meta-value">${html(fecha)} &middot; ${versionTxt}</div></div>
      </div>
      <section class="overview"><div class="copy"><h2>Resumen</h2><p>${resumen}</p></div>
        <div class="amount"><div class="title">Inversi\u00f3n total estimada</div>
          <div class="value">${html(formatoPesos(d.total_inversion))}</div>
          <div class="desc">${numero} reemplazo${numero === 1 ? '' : 's'} propuesto${numero === 1 ? '' : 's'} &middot; ${unidades} unidad${unidades === 1 ? '' : 'es'}</div></div>
      </section>
      <section class="section"><h2>Reemplazos propuestos</h2>
        <table aria-label="Detalle de la inversi\u00f3n"><thead><tr>
          <th style="width:26%">Equipo actual</th><th style="width:41%">Producto seleccionado</th>
          <th style="width:10%">Cant.</th><th style="width:23%">Valor (COP)</th>
        </tr></thead><tbody>${filas}</tbody></table>
        <div class="total"><span>Total estimado de la propuesta</span>
          <strong>${html(formatoPesos(d.total_inversion))}</strong></div></section>
      <div class="mini-rule"></div><div class="twocol">
        <section class="section"><h2>Evaluaci\u00f3n ambiental</h2>${lineasAmbientales}
          <p>Las estimaciones no equivalen a ahorros verificados ni a certificaciones ambientales.</p></section>
        <section class="section"><h2>Condiciones</h2>
          <p>Los precios provienen del cat\u00e1logo consultado y est\u00e1n sujetos a confirmaci\u00f3n de disponibilidad.</p>
          <p>Los servicios y costos no incluidos expresamente requieren validaci\u00f3n adicional. Este documento no constituye aprobaci\u00f3n de cr\u00e9dito.</p>
        </section></div>
      ${observacionesHtml}
      </main></body></html>`;
}

async function obtenerNavegador() {
  if (!browserPromise) {
    browserPromise = (async () => {
      // Playwright es dependencia existente del backend. No se agregan servicios externos.
      const { chromium } = require('playwright');
      const launch = { headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] };
      if (process.env.FVE_PDF_CHROMIUM_PATH) launch.executablePath = process.env.FVE_PDF_CHROMIUM_PATH;
      const browser = await chromium.launch(launch);
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    })().catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}
async function generarPdfPropuesta(propuesta) {
  if (renderizacionesActivas >= 2) {
    const err = new Error('Generador ocupado, intenta de nuevo'); err.status = 503; throw err;
  }
  renderizacionesActivas++;
  let pagina;
  try {
    const contenido = construirHtmlPropuesta(propuesta);
    const browser = await obtenerNavegador();
    pagina = await browser.newPage({ viewport: {width: 1100, height: 1500}, deviceScaleFactor: 1 });
    // Impide peticiones HTTP/HTTPS desde contenido de la empresa (SSRF, tracking).
    await pagina.route(/^https?:\/\//, route => route.abort());
    await pagina.setContent(contenido, {waitUntil: 'load', timeout: 20000});
    await pagina.evaluate(() => document.fonts.ready);
    const d = propuesta.detalle || propuesta;
    const pId = nSeguro(propuesta.id_proceso || d.id_proceso) || '-';
    const ver = nSeguro(propuesta.numero_version || d.numero_version) || '-';
    const pie = `<div style="width:100%;display:flex;justify-content:space-between;align-items:flex-end;
      padding:0 19mm;color:#7d8580;font:9px Arial,Helvetica,sans-serif;border-top:1px solid #d9deda;">
      <span><strong style="color:#4d5951">Finanfuturo &middot; Finanzas Verdes</strong><br>Propuesta comercial</span>
      <span>Proceso N.&ordm; ${pId} &middot; Versi\u00f3n ${ver}<br>
        P\u00e1gina <span class="pageNumber"></span> de <span class="totalPages"></span></span>
      </div>`;
    const buffer = await pagina.pdf({ format: 'A4', printBackground: true,
      preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>', footerTemplate: pie, timeout: 45000 });
    if (buffer.length < 100 || buffer.length > 8 * 1024 * 1024 ||
        buffer.subarray(0, 4).toString() !== '%PDF') {
      throw new Error('PDF resultante no v\u00e1lido');
    }
    // Numero de paginas via marcadores de la estructura PDF generada por Chromium.
    const pdfTxt = buffer.toString('latin1');
    const paginas = (pdfTxt.match(/\/Type\s*\/Page\b/g) || []).length;
    return { buffer, sha256: createHash('sha256').update(buffer).digest('hex'), paginas };
  } catch (error) {
    if (!error.status) error.status = 503;
    throw error;
  } finally {
    if (pagina) await pagina.close().catch(() => {});
    renderizacionesActivas--;
  }
}
module.exports = { generarPdfPropuesta, construirHtmlPropuesta, formatoPesos };
