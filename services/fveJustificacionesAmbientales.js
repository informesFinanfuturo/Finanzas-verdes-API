'use strict';

const BLOQUES = Object.freeze(['1', '3', '4', '5']);

function validarJustificaciones(valor) {
  if (valor === null || valor === undefined) return {};
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('Las justificaciones por bloque deben ser un objeto');
  }
  const salida = {};
  for (const [bloque, nota] of Object.entries(valor)) {
    if (!BLOQUES.includes(bloque)) {
      throw new Error(`No se admiten justificaciones para el bloque ${bloque}`);
    }
    if (typeof nota !== 'string' || nota.length > 1200) {
      throw new Error(`Justificacion invalida en bloque ${bloque} (maximo 1200 caracteres)`);
    }
    const texto = nota.trim();
    if (texto) salida[bloque] = texto;
  }
  return salida;
}

module.exports = { validarJustificaciones };
