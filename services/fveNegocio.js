
'use strict';

function id(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function monto(v) {
  const n = Number(v);

  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12) {
    throw new Error('Monto invalido o fuera de rango');
  }

  return n;
}

function cantidad(v) {
  const n = Number(v);

  if (!Number.isSafeInteger(n) || n < 1 || n > 10000) {
    throw new Error('Cantidad invalida');
  }

  return n;
}

function texto(s, max = 1600) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

function validarModalidad(body, total) {
  const modalidad = String(body?.modalidad || '');

  if (!['recursos_propios', 'credito_finanfuturo', 'mixta'].includes(modalidad)) {
    throw new Error('Modalidad financiera invalida');
  }

  const recursos_propios = monto(body?.recursos_propios ?? 0);
  const credito_solicitado = monto(body?.credito_solicitado ?? 0);

  if (recursos_propios + credito_solicitado !== total) {
    throw new Error('La suma de recursos propios y credito debe coincidir con el valor de la propuesta');
  }

  if (
    modalidad === 'recursos_propios' &&
    (recursos_propios !== total || credito_solicitado !== 0)
  ) {
    throw new Error('Los recursos propios deben cubrir la propuesta');
  }

  if (
    modalidad === 'credito_finanfuturo' &&
    (credito_solicitado !== total || recursos_propios !== 0)
  ) {
    throw new Error('El credito debe cubrir la propuesta');
  }

  if (
    modalidad === 'mixta' &&
    !(recursos_propios > 0 && credito_solicitado > 0)
  ) {
    throw new Error('La modalidad mixta requiere ambas fuentes');
  }

  return {
    modalidad,
    recursos_propios,
    credito_solicitado
  };
}

function validarViabilidad(body, fin) {
  const creditoEstado = String(body?.estado_credito || 'no_aplica');
  const propio = body?.recursos_propios_confirmados === true;

  if (!['no_aplica', 'pendiente', 'aprobado', 'rechazado'].includes(creditoEstado)) {
    throw new Error('Estado crediticio invalido');
  }

  if (fin.credito_solicitado > 0 && creditoEstado === 'no_aplica') {
    throw new Error('Indica resultado del credito');
  }

  if (fin.credito_solicitado === 0 && creditoEstado !== 'no_aplica') {
    throw new Error('Esta modalidad no incluye credito');
  }

  const aprobado = monto(body?.monto_credito_aprobado ?? 0);

  if (aprobado > fin.credito_solicitado) {
    throw new Error('El monto aprobado excede el solicitado');
  }

  if (creditoEstado !== 'aprobado' && aprobado !== 0) {
    throw new Error('Monto aprobado solo corresponde a credito aprobado');
  }

  const referencia = texto(body?.referencia_soporte, 200);

  if (fin.credito_solicitado > 0 && creditoEstado === 'aprobado' && !referencia) {
    throw new Error('Falta referencia de evidencia de aprobacion');
  }

  const viable =
    (!fin.recursos_propios || propio) &&
    (!fin.credito_solicitado || (creditoEstado === 'aprobado' && aprobado >= fin.credito_solicitado));

  return {
    estado: viable ? 'viable' : creditoEstado === 'rechazado' ? 'no_viable' : 'pendiente',
    recursos_propios_confirmados: propio,
    estado_credito: creditoEstado,
    monto_credito_aprobado: aprobado,
    referencia_soporte: referencia,
    observacion: texto(body?.observacion, 1500)
  };
}

function crearDetalle(lineas, {
  id_proceso,
  id_diagnostico,
  nombre_mipyme,
  observacion
} = {}) {
  if (!Array.isArray(lineas) || !lineas.length || lineas.length > 100) {
    throw new Error('Seleccion de productos vacia o demasiado grande');
  }

  const procesadas = [];
  let total = 0;

  for (const l of lineas) {
    const precio = Number(l.precio_unitario);
    const cnt = cantidad(l.cantidad);

    if (!Number.isSafeInteger(precio) || precio < 0 || precio > 1e12) {
      throw new Error('Precio del catalogo invalido');
    }

    if (!id(l.id_activo) || !id(l.id_item)) {
      throw new Error('Activo o producto sin identificador');
    }

    const subtotal = precio * cnt;

    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) {
      throw new Error('Valor monetario fuera de rango');
    }

    total += subtotal;

    procesadas.push({
      id_activo: id(l.id_activo),
      activo_nombre: texto(l.activo_nombre, 300),
      id_item: id(l.id_item),
      producto_nombre: texto(l.producto_nombre, 300),
      id_proveedor: id(l.id_proveedor),
      proveedor_nombre: texto(l.proveedor_nombre, 300),
      cantidad: cnt,
      precio_unitario: precio,
      subtotal,
      estado_ambiental: texto(l.estado_ambiental, 60) || 'pendiente_dato',
      id_evaluacion: id(l.id_evaluacion),
      ahorro_estimado_anual: l.ahorro_estimado_anual ?? null,
      unidad_ahorro: texto(l.unidad_ahorro, 40),
      version_regla: texto(l.version_regla, 100)
    });
  }

  return {
    id_proceso,
    id_diagnostico,
    nombre_mipyme: texto(nombre_mipyme, 300),
    total_inversion: total,
    moneda: 'COP',
    lineas: procesadas,
    fecha_corte: new Date().toISOString(),
    observacion: texto(observacion, 1500),
    advertencias: [
      'La propuesta no implica aprobacion financiera.',
      'Las tecnologias sin evaluacion elegible no estan certificadas como verdes.'
    ]
  };
}

function cambioPrecio(snapshot, filas) {
  const m = new Map(filas.map(f => [Number(f.id_item), f]));

  for (const l of snapshot.lineas || []) {
    const item = m.get(l.id_item);

    if (
      !item ||
      item.disponible !== true ||
      item.estado !== 'activo' ||
      item.proveedor_estado !== 'activo' ||
      Number(item.precio_base) !== l.precio_unitario
    ) {
      return `Producto ${l.id_item}: precio o disponibilidad cambio, regenera el borrador`;
    }
  }

  return null;
}

module.exports = {
  id,
  monto,
  cantidad,
  texto,
  validarModalidad,
  validarViabilidad,
  crearDetalle,
  cambioPrecio
};