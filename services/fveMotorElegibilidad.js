'use strict';

// Entrega 03: evaluacion EX ANTE por activo REEMPLAZADO.
// No calcula aprobacion crediticia, compra verificada ni ahorro ex post.
const VERSION_MOTOR = 'FVE03-1.0.0';
const CATEGORIAS = new Set(['LUMINARIAS', 'GRIFERIA', 'REDUCTORES_CAUDAL']);

function numeroPositivo(valor, maximo = Number.POSITIVE_INFINITY) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > maximo) return null;
  return valor;
}
function enteroPositivo(valor, maximo) {
  const n = numeroPositivo(valor, maximo);
  return n !== null && Number.isInteger(n) ? n : null;
}
function limpiar(txt) {
  return String(txt ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
function redondear(v, digitos = 6) {
  return v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digitos));
}
function verificarParams(p) {
  const umbral = Number(p?.umbral_ahorro);
  const banda = Number(p?.banda_incertidumbre);
  const dias = Number(p?.dias_operacion_default);
  if (!Number.isFinite(umbral) || umbral <= 0 || umbral >= 1 ||
      !Number.isFinite(banda) || banda < 0 || banda >= 1 ||
      !Number.isInteger(dias) || dias < 1 || dias > 366 ||
      !p?.version_parametro) {
    throw new Error('Configuracion FVE 03 inexistente o invalida');
  }
  return { umbral, banda, dias, version: String(p.version_parametro),
    aprobacion: String(p.estado_aprobacion || 'provisional') };
}

/**
 * anterior: datos_tecnicos de fve_activo_caracterizacion, nunca del producto nuevo.
 * nuevo: datos tecnicos del producto que se propone instalar.
 * fuenteProducto: evidencia aportada por asesor, no implica verificacion del fabricante.
 * intervencion: reemplazo o adquisicion_nueva.
 */
function evaluarActivo({ categoria, anterior = {}, nuevo = {}, fuenteProducto = null,
                        parametros, intervencion = 'reemplazo' }) {
  if (!CATEGORIAS.has(categoria)) throw new Error('Categoria no implementada en Entrega 03');
  const cfg = verificarParams(parametros);
  const pendientes = [];
  const observaciones = [];
  const supuestos = [];
  const unidades = categoria === 'LUMINARIAS' ? 'kWh/anio' : 'm3/anio';
  const r = {
    version_motor: VERSION_MOTOR,
    version_parametros: cfg.version,
    configuracion_provisional: cfg.aprobacion !== 'aprobado',
    codigo_taxonomia: categoria,
    estado: 'pendiente_dato',
    cumple_criterio_producto: null,
    cumple_umbral_ahorro: null,
    consumo_anterior_anual: null,
    consumo_nuevo_anual: null,
    ahorro_anual_estimado: null,
    ahorro_porcentual_central: null,
    ahorro_porcentual_minimo: null,
    ahorro_porcentual_maximo: null,
    unidad: unidades,
    banda_incertidumbre: cfg.banda,
    umbral_exigido: cfg.umbral,
    nivel_confianza: categoria === 'LUMINARIAS' ? 'alta_condicionada_al_uso' : 'baja_media',
    fuentes: { anterior: 'fve_activo_caracterizacion', nuevo: fuenteProducto },
    supuestos, observaciones, pendientes,
    es_ahorro_verificado: false,
    requiere_verificacion_compra: true,
    requiere_certificado_disposicion: categoria === 'LUMINARIAS',
    puede_reportarse_como_verde_confirmado: false,
  };

  if (intervencion !== 'reemplazo') {
    r.estado = 'fuera_alcance';
    observaciones.push('Adquisicion nueva fuera del MVP: no existe linea base de equipo retirado.');
    return r;
  }

  let antes = null;
  let despues = null;
  let dias = null;
  let cumpleProducto = null;

  if (categoria === 'LUMINARIAS') {
    const techAnterior = limpiar(anterior.tecnologia_anterior);
    const techNuevo = limpiar(nuevo.tecnologia_nueva);
    if (!techAnterior) pendientes.push('tecnologia_anterior');
    if (!techNuevo) pendientes.push('tecnologia_nueva');
    const wAntes = numeroPositivo(anterior.potencia_anterior_w);
    const wNuevo = numeroPositivo(nuevo.potencia_nueva_w);
    const horas = numeroPositivo(anterior.horas_dia, 24);
    dias = enteroPositivo(anterior.dias_anio, 366);
    if (wAntes === null) pendientes.push('potencia_anterior_w');
    if (wNuevo === null) pendientes.push('potencia_nueva_w');
    if (horas === null) pendientes.push('horas_dia');
    if (dias === null) pendientes.push('dias_anio');
    if (techAnterior && techNuevo) {
      const anteriorApta = /incandesc|halogen|fluorescen/.test(techAnterior);
      const tecnologiaNuevaApta = /\bled\b/.test(techNuevo);
      if (!anteriorApta && !/\bled\b/.test(techAnterior)) {
        pendientes.push('tecnologia_anterior_identificable');
      } else {
        cumpleProducto = anteriorApta && tecnologiaNuevaApta;
      }
    }
    if (wAntes !== null && wNuevo !== null && horas !== null && dias !== null) {
      antes = wAntes * horas * dias / 1000;
      despues = wNuevo * horas * dias / 1000;
      supuestos.push({ campo: 'horas_dia', valor: horas, origen: 'inventario_cliente' });
      supuestos.push({ campo: 'dias_anio', valor: dias, origen: 'inventario_cliente' });
    }
  } else {
    const caudalAntes = numeroPositivo(anterior.caudal_anterior_l_min);
    const caudalNuevo = numeroPositivo(nuevo.caudal_nuevo_l_min);
    const minutos = numeroPositivo(anterior.minutos_dia, 1440);
    dias = nuevo.dias_operacion_anio === undefined || nuevo.dias_operacion_anio === null
      ? cfg.dias : enteroPositivo(nuevo.dias_operacion_anio, 366);
    if (caudalAntes === null) pendientes.push('caudal_anterior_l_min');
    if (caudalNuevo === null) pendientes.push('caudal_nuevo_l_min');
    if (minutos === null) pendientes.push('minutos_dia');
    if (dias === null) pendientes.push('dias_operacion_anio');
    if (nuevo.dias_operacion_anio == null) {
      supuestos.push({ campo: 'dias_operacion_anio', valor: cfg.dias,
        origen: 'parametro_provisional', explicacion: 'Se debe ajustar segun dias reales de operacion.' });
    } else if (dias !== null) {
      supuestos.push({ campo: 'dias_operacion_anio', valor: dias, origen: 'declarado_para_la_evaluacion' });
    }
    if (categoria === 'GRIFERIA') {
      if (caudalNuevo !== null) cumpleProducto = caudalNuevo <= 6;
    } else {
      if (typeof nuevo.dispositivo_sobre_griferia_existente === 'boolean') {
        cumpleProducto = nuevo.dispositivo_sobre_griferia_existente;
      } else {
        pendientes.push('dispositivo_sobre_griferia_existente');
      }
    }
    if (caudalAntes !== null && caudalNuevo !== null && minutos !== null && dias !== null) {
      antes = caudalAntes * minutos * dias / 1000;
      despues = caudalNuevo * minutos * dias / 1000;
      supuestos.push({ campo: 'minutos_dia', valor: minutos, origen: 'inventario_cliente' });
    }
  }

  const fuenteValida = fuenteProducto &&
    ['ficha_tecnica', 'etiqueta', 'catalogo_proveedor', 'fabricante', 'medicion'].includes(fuenteProducto.tipo) &&
    typeof fuenteProducto.referencia === 'string' && fuenteProducto.referencia.trim().length > 0 &&
    fuenteProducto.referencia.length <= 1000;
  if (!fuenteValida) pendientes.push('evidencia_tecnica_producto_nuevo');

  // No convertir un dato desconocido en rechazo; tampoco afirmar elegibilidad por IA.
  if (pendientes.length) {
    observaciones.push('Faltan datos o evidencia necesarios para decidir.');
    return r;
  }
  r.cumple_criterio_producto = cumpleProducto;
  if (cumpleProducto === false) {
    r.estado = 'no_elegible';
    observaciones.push('El producto propuesto no cumple el criterio tecnico de esta categoria.');
  }

  // Guardamos las cifras aun cuando el criterio de producto falle, siempre que sean calculables.
  r.consumo_anterior_anual = redondear(antes);
  r.consumo_nuevo_anual = redondear(despues);
  const ahorro = antes - despues;
  const central = ahorro / antes; // antes es positivo por validaciones previas.
  const inferior = central >= 0 ? central * (1 - cfg.banda) : central * (1 + cfg.banda);
  const superior = central >= 0 ? central * (1 + cfg.banda) : central * (1 - cfg.banda);
  r.ahorro_anual_estimado = redondear(ahorro);
  r.ahorro_porcentual_central = redondear(100 * central, 4);
  r.ahorro_porcentual_minimo = redondear(100 * inferior, 4);
  r.ahorro_porcentual_maximo = redondear(100 * superior, 4);
  r.cumple_umbral_ahorro = inferior + 1e-12 >= cfg.umbral;
  if (cumpleProducto === false) return r;
  r.estado = r.cumple_umbral_ahorro ? 'elegible' : 'no_alcanza_umbral';
  if (categoria !== 'LUMINARIAS') {
    observaciones.push('Banda de incertidumbre provisional: decision con su limite inferior.');
  }
  if (r.estado === 'elegible') {
    observaciones.push('Elegibilidad estimada ex ante; faltan verificacion de compra y cierre ambiental aplicable.');
  }
  return r;
}

module.exports = { VERSION_MOTOR, CATEGORIAS, evaluarActivo };
