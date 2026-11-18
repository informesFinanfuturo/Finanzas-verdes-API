'use strict';
// FVE_ALTERNATIVA_TRAZABLE_V1
const { resolverSugerencia } = require('./diagnosticoSugerenciaCatalogo');

// Clasificacion conservadora. No equiparar categorias comerciales generales
// con dispositivos concretos si el nombre del producto no lo respalda.
function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function claseActivo(activo) {
  const tipo = normalizar(activo?.tipo);
  const nombre = normalizar(activo?.nombre);
  const s = `${nombre} ${tipo}`;
  if (/microondas/.test(s)) return 'microondas';
  if (/lavavajillas|lava vajillas/.test(s)) return 'lavavajillas';
  if (/reductor(?:es)? de caudal|aireador/.test(s)) return 'reductor';
  if (/grifos?|griferia|llaves? de agua/.test(s)) return 'griferia';
  if (/sanitarios?|inodoros?|retretes?|cisternas?/.test(s)) return 'sanitario';
  if (/secadoras?/.test(s)) return 'secadora';
  if (/lavadoras?/.test(s)) return 'lavadora';
  if (/aires? acondicionados?|minisplit|mini split/.test(s)) return 'aire';
  if (/ventiladores?/.test(s)) return 'ventilador';
  if (/congeladores?|freezers?/.test(s)) return 'congelador';
  if (/neveras?|refrigeradores?|refrigeracion|frigorificos?/.test(s)) return 'nevera';
  if (/vitrinas?/.test(s)) return 'vitrina';
  if (/iluminacion|luminarias?|bombillos?|lamparas?|focos? led/.test(s)) return 'iluminacion';
  if (/hornos?/.test(s)) return 'horno';
  if (/televisores?|\btv\b|pantallas? de tv/.test(s)) return 'televisor';
  if (/cafeteras?/.test(s)) return 'cafetera';
  if (/licuadoras?/.test(s)) return 'licuadora';
  return null;
}

const especificos = new Set([
  'nevera','congelador','aire','ventilador','microondas','horno','lavadora',
  'secadora','sanitario','griferia','reductor','iluminacion','lavavajillas',
  'televisor','cafetera','licuadora','vitrina'
]);

function claseProducto(item) {
  const tipo = normalizar(item?.tipo_item);
  const nombre = normalizar(item?.nombre);
  // Las clasificaciones de la ficha de producto tienen prioridad si son
  // especificas; 'Electrodomestico' necesita informacion en el nombre.
  if (/\bservicio\b|\binstalacion\b|\bmantenimiento\b/.test(tipo)) return null;
  const desdeNombre = claseActivo({nombre, tipo:''});
  if (desdeNombre) return desdeNombre;
  const desdeTipo = claseActivo({nombre:'', tipo});
  if (desdeTipo && especificos.has(desdeTipo)) return desdeTipo;
  return null;
}

function alternativasCompatibles(activo, items) {
  const categoria = claseActivo(activo);
  if (!categoria) return [];
  return items.filter(item => claseProducto(item) === categoria);
}

const idValido = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function crearObtenerAlternativas({ db, accesoMipyme }) {
  return async function obtenerAlternativas(req, res) {
    const idDiagnostico = idValido(req.params.idDiagnostico);
    const idActivo = idValido(req.params.idActivo);
    const idUsuario = idValido(req.user?.id_usuario);
    if (!idDiagnostico || !idActivo) {
      return res.status(400).json({error: 'Identificadores de diagnóstico o activo inválidos'});
    }
    if (!idUsuario) return res.status(401).json({error: 'Usuario no autenticado'});
    try {
      const diagnostico = await db.query(`
        SELECT id_diagnostico, id_mipyme, metricas, beneficios
        FROM public.diagnostico
        WHERE id_diagnostico = $1 AND estado IS DISTINCT FROM 'eliminado'
      `, [idDiagnostico]);
      if (!diagnostico.rowCount) return res.status(404).json({error: 'Diagnóstico no encontrado'});
      const { id_mipyme: idMipyme, metricas } = diagnostico.rows[0];
      if (!await accesoMipyme(db, idMipyme, idUsuario)) {
        return res.status(403).json({error: 'No autorizado para esta empresa'});
      }
      // Un activo debe figurar en el diagnóstico, no solamente pertenecer
      // a la misma empresa. Evita mezclar propuestas de diagnósticos distintos.
      const incluidos = Array.isArray(metricas?.activos) ? metricas.activos : [];
      if (!incluidos.some(a => idValido(a?.id_activo) === idActivo)) {
        return res.status(404).json({error: 'Activo no incluido en el diagnóstico'});
      }
      const activo = await db.query(`
        SELECT id_activo, id_mipyme, nombre, tipo, marca, modelo, cantidad
        FROM public.activo
        WHERE id_activo = $1 AND id_mipyme = $2
          AND estado IS DISTINCT FROM 'eliminado'
      `, [idActivo, idMipyme]);
      if (!activo.rowCount) {
        // Diagnosticos antiguos pueden contener un ID de activo que no
        // existe en el inventario vigente. Se ofrecen candidatos SOLO
        // de la empresa autorizada; NO se asigna un ID automaticamente.
        const vinculos = require('./diagnosticoVinculos').crearControlador({db,acceso:accesoMipyme});
        const pendiente = await vinculos.consultarPendiente({
          idDiagnostico,idActivo,idMipyme,metricas
        });
        return res.status(409).json(pendiente || {error:'No se pudo verificar la referencia del activo.'});
      }
      const actual = activo.rows[0];
      const categoria = claseActivo(actual);
      if (!categoria) {
        return res.status(200).json({
          activo: actual, alternativas: [],
          aviso: 'El tipo de activo requiere clasificacion especifica para comparar productos.'
        });
      }
      const catalogo = await db.query(`
        SELECT
          i.id_item, i.tipo_item, i.nombre, i.descripcion,
          i.especificaciones, i.precio_base, i.disponible,
          i.id_proveedor, i.url_origen,
          p.razon_social AS nombre_proveedor
        FROM public.item_catalogo i
        JOIN public.proveedor p ON p.id_proveedor = i.id_proveedor
        WHERE i.disponible IS TRUE
          AND i.estado = 'activo'
          AND p.estado = 'activo'
        ORDER BY i.nombre ASC, i.id_item ASC
      `);
      const alternativas = alternativasCompatibles(actual, catalogo.rows).map(item => {
        const { nombre_proveedor: nombreProveedor, ...campos } = item;
        return {
          ...campos,
          proveedor: {id_proveedor: item.id_proveedor, nombre: nombreProveedor}
        };
      });
      // La IA no selecciona productos comercialmente. Solo senala la coincidencia univoca.
      const sugerencia = resolverSugerencia({
        diagnostico: diagnostico.rows[0], idActivo, alternativas
      });
      // FVE_METRICAS_ALTERNATIVA_V1: adjuntar las metricas del diagnostico SOLAMENTE al
      // producto con coincidencia unica. Nunca son ahorros ni elegibilidad.
      const alternativasConProyeccion = alternativas.map(item => {
        if (!sugerencia || Number(item.id_item) !== Number(sugerencia.id_item)) return item;
        return {
          ...item,
          proyeccion_ia: {
            consumo_energia_proyectado_mes: sugerencia.consumo_energia_proyectado_mes,
            consumo_agua_proyectado_mes: sugerencia.consumo_agua_proyectado_mes,
          },
          consumo_referencia_ia: sugerencia.consumo_referencia_ia,
          origen_recomendacion: sugerencia.origen,
        };
      });
      return res.status(200).json({
        activo: actual, alternativas: alternativasConProyeccion, sugerencia_ia: sugerencia
      });
    } catch (err) {
      console.error('Error consultar alternativas de diagnóstico:', err);
      return res.status(500).json({error: 'No se pudieron consultar las alternativas disponibles'});
    }
  };
}

module.exports = {normalizar, claseActivo, claseProducto, alternativasCompatibles, crearObtenerAlternativas};
