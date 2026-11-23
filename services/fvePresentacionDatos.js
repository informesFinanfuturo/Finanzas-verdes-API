'use strict';
// Lecturas acotadas por id_mipyme, sin escritura de datos ni consultas IA nuevas.
const { accesoMipyme } = require('./accesoMipyme');
const entero = x => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
const obtener = async (db, sql, params) => (await db.query(sql, params)).rows;

async function cargarDatosPresentacion(db, idMipyme, idUsuario) {
  const id = entero(idMipyme), usuario = entero(idUsuario);
  if (!id || !usuario) { const e = new Error('Identificadores invalidos'); e.status = 400; throw e; }
  if (!await accesoMipyme(db, id, usuario)) {
    const e = new Error('No autorizado para esta empresa'); e.status = 403; throw e;
  }
  const empresas = await obtener(db, `SELECT id_mipyme,nombre_mipyme,nit,sector_economico,direccion,
      departamento,municipio,barrio,estrato,tipo_factura,horario_operacion,
      descripcion_empresa,cantidad_empleados,ingresos,egresos,codigo_ciiu,
      tipo_persona,tipo_empresa
    FROM public.mipyme WHERE id_mipyme=$1 AND estado IS DISTINCT FROM 'eliminado'`, [id]);
  if (!empresas.length) { const e = new Error('Empresa no encontrada'); e.status = 404; throw e; }
  const empresa = empresas[0];
  // Las fotografías se leen exclusivamente de asociaciones confirmadas en BD.
  const [contactos, asesores, activos, facturas, evaluaciones, diagnosticos] = await Promise.all([
    obtener(db, `SELECT u.id_usuario,u.nombre_usuario,u.telefono,u.email
      FROM public.mipyme_usuario mu JOIN public.usuario u ON u.id_usuario=mu.id_usuario
      WHERE mu.id_mipyme=$1 ORDER BY u.id_usuario LIMIT 3`, [id]),
    obtener(db, `SELECT nombre_usuario FROM public.usuario WHERE id_usuario=$1 LIMIT 1`, [usuario]),
    obtener(db, `SELECT a.id_activo,a.nombre,a.tipo,a.marca,a.modelo,a.descripcion,a.datos,
        a.cantidad,a.observacion_ia,a.created_at,a.updated_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('nombre_fisico',ar.nombre_fisico,
          'mime',ar.mime,'nombre_original',ar.nombre_original) ORDER BY ar.id_archivo)
          FROM public.archivo_activo aa JOIN public.archivo ar ON ar.id_archivo=aa.id_archivo
          WHERE aa.id_activo=a.id_activo),'[]'::jsonb) AS imagenes
      FROM public.activo a WHERE a.id_mipyme=$1 AND a.estado IS DISTINCT FROM 'eliminado'
      ORDER BY a.id_activo LIMIT 301`, [id]),
    obtener(db, `SELECT c.id_consumo,c.tipo,c.proveedor,c.periodo_inicio,c.periodo_fin,
        c.valor,c.consumo,c.unidad,c.costo_unitario,c.observaciones,c.observacion_ia,
        c.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('nombre_fisico',ar.nombre_fisico,
          'mime',ar.mime,'nombre_original',ar.nombre_original) ORDER BY ar.id_archivo)
          FROM public.consumo_archivo ca JOIN public.archivo ar ON ar.id_archivo=ca.id_archivo
          WHERE ca.id_consumo=c.id_consumo),'[]'::jsonb) AS imagenes
      FROM public.consumo c WHERE c.id_mipyme=$1 AND c.estado IS DISTINCT FROM 'eliminado'
      ORDER BY c.periodo_fin DESC NULLS LAST,c.id_consumo DESC LIMIT 301`, [id]),
    obtener(db, `SELECT * FROM public.fve_visita_ambiental WHERE id_mipyme=$1
      ORDER BY (CASE WHEN lower(COALESCE(estado,'')) IN ('finalizada','finalizado','completada')
         THEN 0 ELSE 1 END),created_at DESC,id_visita DESC LIMIT 1`, [id]),
    obtener(db, `SELECT id_diagnostico,titulo,problema,beneficios,metricas,evidencia_catalogo,
        created_at,updated_at FROM public.diagnostico
      WHERE id_mipyme=$1 AND estado IS DISTINCT FROM 'eliminado'
      ORDER BY created_at DESC,id_diagnostico DESC LIMIT 101`, [id]),
  ]);
  if (activos.length > 300 || facturas.length > 300 || diagnosticos.length > 100) {
    const e = new Error('El informe excede el limite seguro de registros; se requiere exportacion segmentada.');
    e.status = 413; throw e;
  }
  // Exigir que las tablas auxiliares funcionen: no producir un informe aparentemente completo si fallan.
  const [fichas, preguntas] = await Promise.all([
    activos.length ? obtener(db, `SELECT id_activo,codigo_taxonomia,datos_tecnicos,estado_datos,
        observaciones FROM public.fve_activo_caracterizacion
      WHERE id_mipyme=$1 AND id_activo=ANY($2::int[])`, [id, activos.map(a=>a.id_activo)]) : [],
    evaluaciones.length ? obtener(db, `SELECT numero,texto,bloque,tipo FROM public.fve_pregunta_ambiental
      WHERE codigo_formulario=$1 ORDER BY numero`, [evaluaciones[0].version_formulario]) : [],
  ]);
  const mapaFichas = new Map(fichas.map(f=>[String(f.id_activo), f]));
  for (const activo of activos) activo.ficha_fve = mapaFichas.get(String(activo.id_activo)) || null;
  const fotografias = [...activos,...facturas].reduce((n,x)=>n+(Array.isArray(x.imagenes)?x.imagenes.length:0),0);
  if (fotografias > 600) { const e = new Error('Hay mas de 600 fotografias; requiere exportacion por partes para proteger el servidor.'); e.status=413; throw e; }
  return { empresa, contactos, asesor: asesores[0] || null, activos, facturas,
    evaluacion: evaluaciones[0] || null, preguntas, diagnosticos, totalFotografias: fotografias,
    fechaExportacion: new Date().toISOString() };
}
module.exports={cargarDatosPresentacion};
