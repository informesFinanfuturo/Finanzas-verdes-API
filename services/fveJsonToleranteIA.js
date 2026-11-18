'use strict';

function esObjeto(valor) {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor);
}

function quitarEnvolturas(valor) {
  let texto = String(valor ?? '').replace(/^\uFEFF/, '').trim();
  if (/^```(?:json)?\s*\n/i.test(texto)) {
    texto = texto.replace(/^```(?:json)?\s*\n/i, '').replace(/\n?```\s*$/, '').trim();
  }
  return texto;
}

function primerObjetoCompleto(texto) {
  let inicio = -1;
  let profundidad = 0;
  let dentro = false;
  let escapado = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (inicio < 0) {
      if (c !== '{') continue;
      inicio = i;
      profundidad = 1;
      continue;
    }
    if (dentro) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') dentro = false;
      continue;
    }
    if (c === '"') dentro = true;
    else if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (!profundidad) return texto.slice(inicio, i + 1);
    }
  }
  return null;
}

function normalizarSintaxisComun(texto) {
  let resultado = '';
  let dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentro) {
      if (c === '"') {
        dentro = false;
        resultado += c;
      } else if (c === '\\') {
        const siguiente = texto[i + 1];
        if (siguiente === 'u') {
          const hex = texto.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            resultado += texto.slice(i, i + 6);
            i += 5;
          } else resultado += '\\\\';
        } else if (siguiente && /["\\/bfnrt]/.test(siguiente)) {
          resultado += c + siguiente;
          i++;
        } else {
          // Conservar literalmente una barra mal escapada: no inferir contenido.
          resultado += '\\\\';
        }
      } else if (c === '\n') resultado += '\\n';
      else if (c === '\r') resultado += '\\r';
      else if (c === '\t') resultado += '\\t';
      else if (c.charCodeAt(0) < 32) resultado += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
      else resultado += c;
      continue;
    }
    if (c === '"') {
      dentro = true;
      resultado += c;
    } else if (c === ',') {
      let j = i + 1;
      while (j < texto.length && /\s/.test(texto[j])) j++;
      if (texto[j] !== '}' && texto[j] !== ']') resultado += c;
    } else if (c.charCodeAt(0) < 32 && !/[\n\r\t]/.test(c)) {
      // Fuera de cadenas, eliminar controles invisibles no permitidos.
    } else resultado += c;
  }
  return resultado;
}

function leerJsonIA(respuesta) {
  if (esObjeto(respuesta)) return { objeto: respuesta, via: 'OBJETO_DIRECTO' };
  const limpio = quitarEnvolturas(respuesta);
  if (!limpio) throw new Error('RESPUESTA_VACIA');
  if (limpio.length > 1_000_000) throw new Error('RESPUESTA_EXCESIVA');
  const candidatas = [
    ['JSON_DIRECTO', limpio],
    ['OBJETO_EXTRAIDO', primerObjetoCompleto(limpio)],
  ];
  let ultimoError = '';
  const vistos = new Set();
  for (const [via, candidato] of candidatas) {
    if (!candidato || vistos.has(candidato)) continue;
    vistos.add(candidato);
    try {
      const objeto = JSON.parse(candidato);
      if (!esObjeto(objeto)) throw new Error('RESPUESTA_NO_ES_OBJETO');
      return { objeto, via };
    } catch (error) { ultimoError = error.message; }
    const normalizado = normalizarSintaxisComun(candidato);
    if (normalizado !== candidato) {
      try {
        const objeto = JSON.parse(normalizado);
        if (!esObjeto(objeto)) throw new Error('RESPUESTA_NO_ES_OBJETO');
        return { objeto, via: via + '_NORMALIZADO' };
      } catch (error) { ultimoError = error.message; }
    }
  }
  const error = new Error('FORMATO_JSON_IRRECUPERABLE');
  error.detalleTecnico = String(ultimoError).slice(0, 160);
  throw error;
}

module.exports = { leerJsonIA };
