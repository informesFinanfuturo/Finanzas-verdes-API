'use strict';

// La clasificacion del activo existente es deterministica; una sugerencia de IA no la altera.
function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

const FICHAS = Object.freeze({
  NEVERAS_REFRIGERACION: [
    ['anio_equipo_anterior', 'Año del equipo', 'entero', true],
    ['consumo_actual_kwh_mes', 'Consumo actual (kWh/mes)', 'numero', true],
    ['capacidad_actual_l', 'Capacidad actual (litros)', 'numero', false],
  ],
  AIRES_ACONDICIONADOS: [
    ['potencia_anterior_w', 'Potencia actual (W)', 'numero', true],
    ['horas_dia', 'Horas de uso al día', 'numero', true],
    ['dias_anio', 'Días de uso al año', 'entero', true],
  ],
  LUMINARIAS: [
    ['tecnologia_anterior', 'Tecnología actual', 'texto', true],
    ['potencia_anterior_w', 'Potencia actual (W)', 'numero', true],
    ['horas_dia', 'Horas de uso al día', 'numero', true],
    ['dias_anio', 'Días de uso al año', 'entero', true],
  ],
  LAVADORAS: [
    ['consumo_actual_kwh_ciclo', 'Consumo actual (kWh/ciclo)', 'numero', true],
    ['ciclos_semana', 'Ciclos por semana', 'numero', true],
  ],
  HORNOS: [
    ['energia_anterior', 'Fuente de energía actual', 'texto', true],
    ['consumo_actual_kwh_mes', 'Consumo actual (kWh/mes), si es eléctrico', 'numero', false],
    ['horas_dia', 'Horas de uso al día', 'numero', true],
  ],
  SANITARIOS: [
    ['descarga_anterior_l', 'Litros por descarga actual', 'numero', true],
    ['descargas_dia', 'Descargas por día', 'numero', false],
  ],
  GRIFERIA: [
    ['caudal_anterior_l_min', 'Caudal actual (L/min)', 'numero', true],
    ['minutos_dia', 'Minutos de uso al día', 'numero', true],
  ],
  REDUCTORES_CAUDAL: [
    ['caudal_anterior_l_min', 'Caudal actual (L/min)', 'numero', true],
    ['minutos_dia', 'Minutos de uso al día', 'numero', true],
  ],
});

function clasificarActivo(tipo, nombre) {
  const t = normalizar(tipo);
  const n = normalizar(nombre);
  if (t === 'neveras' || t === 'refrigeracion') return 'NEVERAS_REFRIGERACION';
  if (t === 'hornos') return /microondas/.test(n) ? null : 'HORNOS';
  if (t === 'iluminacion' || t === 'luminarias') return 'LUMINARIAS';
  if (t === 'lavadoras') return 'LAVADORAS';
  if (t === 'sanitarios') return 'SANITARIOS';
  if (t === 'reductores de caudal' || t === 'reductores') return 'REDUCTORES_CAUDAL';
  if (t === 'grifos' || t === 'griferia') {
    return /reductor|aireador/.test(n) ? 'REDUCTORES_CAUDAL' : 'GRIFERIA';
  }
  if (t === 'climatizacion') {
    return /\baire\b|acondicionad|minisplit|mini.?split|\bsplit\b|\bvrf\b/i.test(n)
      ? 'AIRES_ACONDICIONADOS' : null;
  }
  // No inferir desde cualquier nombre de un tipo no compatible.
  return null;
}

function camposExistentes(codigo) {
  return (FICHAS[codigo] || []).map(([codigo, etiqueta, tipo, requerido]) =>
    ({ codigo, etiqueta, tipo, requerido }));
}

// Los valores libres de la IA solo se usan para sugerencias revisables.
// No convertir potencia en consumo ni inferir la unidad de un valor ambiguo.
const ALIASES = Object.freeze({
  anio_equipo_anterior: ['ano del equipo', 'ano de fabricacion', 'anio fabricacion'],
  potencia_anterior_w: ['potencia (w)', 'potencia w', 'potencia nominal w'],
  consumo_actual_kwh_mes: ['consumo (kwh/mes)', 'consumo kwh mes', 'consumo mensual (kwh)'],
  consumo_actual_kwh_ciclo: ['consumo (kwh/ciclo)'],
  capacidad_actual_l: ['capacidad (litros)', 'capacidad l'],
  caudal_anterior_l_min: ['caudal (l/min)', 'caudal l min'],
  descarga_anterior_l: ['litros por descarga', 'descarga (l)'],
  tecnologia_anterior: ['tecnologia actual', 'tecnologia anterior'],
  energia_anterior: ['fuente de energia', 'energia anterior'],
});

function sugerenciasDesdeDatos(datos, campos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return {};
  const entradas = new Map(Object.entries(datos).map(([k, v]) => [normalizar(k), v]));
  const sugerencias = {};
  for (const f of campos) {
    const claves = [normalizar(f.codigo), ...(ALIASES[f.codigo] || [])];
    const raw = claves.map(k => entradas.get(k)).find(v => v !== undefined && v !== null && v !== '');
    if (raw === undefined) continue;
    if (typeof raw === 'object') continue;
    if (f.tipo === 'numero' || f.tipo === 'entero') {
      const valor = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
      if (!Number.isFinite(valor) || valor < 0 || (f.tipo === 'entero' && !Number.isInteger(valor))) continue;
      sugerencias[f.codigo] = valor;
    } else if (typeof raw === 'string' && raw.trim().length <= 200) {
      sugerencias[f.codigo] = raw.trim();
    }
  }
  return sugerencias;
}

function validarDatosExistentes(datos, campos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return { error: 'Los datos tecnicos deben ser un objeto' };
  }
  const permitidos = new Map(campos.map(c => [c.codigo, c]));
  const normalizados = {};
  for (const [clave, raw] of Object.entries(datos)) {
    const f = permitidos.get(clave);
    if (!f) return { error: `Campo no permitido: ${clave}` };
    if (raw === null || raw === '') continue;
    if (f.tipo === 'numero' || f.tipo === 'entero') {
      const valor = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(valor) || valor < 0 || (f.tipo === 'entero' && !Number.isInteger(valor))) {
        return { error: `Valor no valido: ${f.etiqueta}` };
      }
      if (clave === 'anio_equipo_anterior' && (valor < 1900 || valor > new Date().getFullYear() + 1)) {
        return { error: 'Año del equipo fuera de rango' };
      }
      normalizados[clave] = valor;
    } else {
      if (typeof raw !== 'string' || raw.trim().length > 200) return { error: `Texto no valido: ${f.etiqueta}` };
      if (raw.trim()) normalizados[clave] = raw.trim();
    }
  }
  return { normalizados, pendientes: campos.filter(f => f.requerido && normalizados[f.codigo] === undefined).map(f => f.codigo) };
}

// Solo valores de la IA con evidencia explicita pasan a la precarga automatica.
function sugerenciasIAConfirmablesDesdeDatos(datos, campos) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return {};
  const sugeridas = datos.fve_sugerencias_ia;
  if (!sugeridas || typeof sugeridas !== "object" || Array.isArray(sugeridas)) return {};
  const resultado = {};
  for (const c of campos) {
    const item = sugeridas[c.codigo];
    if (!item || item.estado !== "sugerido" || !item.fuente || !item.evidencia) continue;
    const valido = validarDatosExistentes({ [c.codigo]: item.valor }, [c]);
    if (!valido.error && Object.hasOwn(valido.normalizados, c.codigo)) {
      resultado[c.codigo] = valido.normalizados[c.codigo];
    }
  }
  return resultado;
}
module.exports = { FICHAS, clasificarActivo, camposExistentes, sugerenciasDesdeDatos, sugerenciasIAConfirmablesDesdeDatos, validarDatosExistentes };
