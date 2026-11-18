'use strict';

// Interpreta EXCLUSIVAMENTE el importe total del servicio en pesos colombianos.
// No aplicar a consumos, cantidades, tasas, precios unitarios ni otros decimales.
// Los comprobantes de servicios publicos se facturan en pesos enteros; algunos
// modelos devuelven el separador de miles como punto decimal (362.556 => 362556).
function normalizarImporteCOP(entrada) {
  if (entrada === null || entrada === undefined || entrada === '') return null;

  const comoNumeroSeguro = valor => {
    if (!Number.isFinite(valor)) return null;
    const redondeado = Math.round(valor);
    return Number.isSafeInteger(redondeado) ? redondeado : null;
  };

  if (typeof entrada === 'number') {
    if (!Number.isFinite(entrada)) return null;
    if (Number.isInteger(entrada)) return comoNumeroSeguro(entrada);
    const representacion = String(entrada);
    // La API puede parsear "362.556" como numero 362.556 antes de llegar aqui.
    // Solo tres cifras despues del punto y hasta tres antes: miles COP.
    if (/^-?\d{1,3}\.\d{3}$/.test(representacion)) {
      return comoNumeroSeguro(Number(representacion.replace('.', '')));
    }
    // Decimales de uno o dos lugares representan fraccion de peso.
    if (/^-?\d+\.\d{1,2}$/.test(representacion)) {
      return comoNumeroSeguro(entrada);
    }
    return null; // formato numerico ambiguo; no redondear silenciosamente
  }

  if (typeof entrada !== 'string' || entrada.length > 80) return null;
  const texto = entrada
    .trim()
    .replace(/\b(?:COP|PESOS?)\b/gi, '')
    .replace(/\$/g, '')
    .replace(/[\s\u00a0\u202f]/g, '');

  if (!/^-?\d[\d.,]*$/.test(texto)) return null;

  if (/^-?\d+$/.test(texto)) return comoNumeroSeguro(Number(texto));

  // Puntos o comas en grupos de tres: 362.556, 1.234.567, 487,598.
  if (/^-?\d{1,3}(?:\.\d{3})+$/.test(texto) ||
      /^-?\d{1,3}(?:,\d{3})+$/.test(texto)) {
    return comoNumeroSeguro(Number(texto.replace(/[.,]/g, '')));
  }

  // Mezclas de miles y centavos: 1.234.567,89 o 1,234,567.89.
  if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(texto)) {
    return comoNumeroSeguro(Number(texto.replace(/\./g, '').replace(',', '.')));
  }
  if (/^-?\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(texto)) {
    return comoNumeroSeguro(Number(texto.replace(/,/g, '')));
  }

  // Valor simple con 1 o 2 decimales: 362556,50 / 362556.50.
  if (/^-?\d+[.,]\d{1,2}$/.test(texto)) {
    return comoNumeroSeguro(Number(texto.replace(',', '.')));
  }

  return null;
}

module.exports = { normalizarImporteCOP };
