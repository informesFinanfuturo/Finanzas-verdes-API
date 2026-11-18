'use strict';

const { claseActivo, claseProducto } = require('./diagnosticoAlternativas');

function id(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function lista(v) { return Array.isArray(v) ? v : []; }
function validarIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('Selecciona entre 1 y 100 activos.');
  }
  const ids = value.map(id);
  if (ids.some(x => x === null) || new Set(ids).size !== ids.length) {
    throw new Error('Los activos seleccionados deben tener identificadores validos y unicos.');
  }
  return ids;
}
function validarAlternativas(value, ids) {
  if (!Array.isArray(value) || value.length !== ids.length) {
    throw new Error('Debes seleccionar un producto para cada activo incluido.');
  }
  const usados = new Set();
  return value.map((raw) => {
    const a = id(raw?.id_activo), item = id(raw?.id_item);
    if (!a || !item || !ids.includes(a) || usados.has(a)) {
      throw new Error('Hay alternativas repetidas, invalidas o ajenas a la seleccion.');
    }
    if (raw?.fuente === 'ia') throw new Error('La recomendacion de IA requiere confirmacion del asesor.');
    usados.add(a);
    return {id_activo: a, id_item: item, fuente: 'usuario'};
  });
}
function validarResumen(value) {
  if (value === undefined || value === null) return {};
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Resumen de diagnostico invalido.');
  }
  const permitted = ['ahorro_economico_mensual','inversion_total_requerida',
    'reduccion_energia','reduccion_agua','reduccion_carbono','roi','payback'];
  const result = {};
  for (const key of permitted) {
    const v = value[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error('Valor invalido en el resumen: ' + key);
    }
    result[key] = v;
  }
  return result;
}
function validarLineas(value, {confirmar=false}={}) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('La negociacion debe incluir entre 1 y 100 activos.');
  }
  const vistos = new Set();
  return value.map((raw) => {
    const a = id(raw?.id_activo), producto = raw?.id_item == null ? null : id(raw.id_item);
    const cantidad = Number(raw?.cantidad);
    if (!a || vistos.has(a) || !Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 10000) {
      throw new Error('Activos o cantidades invalidos en la seleccion.');
    }
    if (raw?.id_item != null && producto === null) throw new Error('Producto invalido.');
    if (confirmar && !producto) throw new Error('Selecciona el producto de cada activo antes de continuar.');
    vistos.add(a);
    return {id_activo:a, id_item:producto, cantidad};
  });
}
function verificarCompatibilidad(activo, producto) {
  const claseA = claseActivo(activo), claseP = claseProducto(producto);
  // El reductor se instala en griferia existente sin reemplazarla.
  if (claseA === 'griferia' && claseP === 'reductor') return true;
  return !!claseA && claseA === claseP;
}
function contextoSeleccion(contextoInicio, metricasActuales) {
  const snapshot = objeto(objeto(contextoInicio).diagnostico);
  const metFoto = objeto(snapshot.metricas);
  const metVivo = objeto(metricasActuales);
  const idsFoto = lista(metFoto.activos_seleccionados);
  const idsVivos = lista(metVivo.activos_seleccionados);
  // Nunca usar todo el inventario como seleccion por defecto.
  // Los activos de una seleccion reparada tienen prioridad sobre los IDs
  // antiguos del snapshot. El snapshot historico permanece intacto.
  const ids = idsVivos.length ? idsVivos : idsFoto;
  const alternativasFoto = lista(metFoto.alternativas_seleccionadas);
  const alternativasVivas = lista(metVivo.alternativas_seleccionadas);
  const mapa = new Map();
  for (const a of alternativasFoto) {
    if (id(a?.id_activo) && id(a?.id_item)) mapa.set(id(a.id_activo), {id_item:id(a.id_item), origen:'diagnostico_inicial'});
  }
  for (const a of alternativasVivas) {
    if (id(a?.id_activo) && id(a?.id_item)) {
      mapa.set(id(a.id_activo), {id_item:id(a.id_item), origen:'recuperado_diagnostico_actual'});
    }
  }
  const vistos = new Set();
  return ids.map(id).filter(n => n && !vistos.has(n) && vistos.add(n)).map(a => ({
    id_activo:a, id_item:mapa.get(a)?.id_item ?? null,
    origen:mapa.get(a)?.origen ?? 'pendiente', cantidad:1,
  }));
}
module.exports = {id,objeto,lista,validarIds,validarAlternativas,validarResumen,validarLineas,verificarCompatibilidad,contextoSeleccion};
