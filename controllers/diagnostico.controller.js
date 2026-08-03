const pool = require('../db');
const { askAIStructured, AIServiceError } = require('../services/iaService');


async function generarYSyncDiagnosticos(req, res) {
  const {
    id_mipyme,
    empresa = null,
    activos = [],
    facturas = [],
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!id_mipyme) {
      return res.status(400).json({
        error: 'id_mipyme es obligatorio',
      });
    }

    if (!req.user?.id_usuario) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const mipymeExists = await client.query(
      `SELECT id_mipyme FROM mipyme WHERE id_mipyme = $1`,
      [id_mipyme]
    );

    if (mipymeExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada',
      });
    }

    // ✅ catálogo filtrado
    const catalogo = await obtenerCatalogoRelevante(client, activos);

    const contextoIA = {
      empresa,
      activos,
      facturas,
      catalogo,
    };

    const diagnosticoIA = await generarDiagnosticoConIA(contextoIA);

    // ✅ verificar si ya existe uno
    const existente = await client.query(
      `
      SELECT id_diagnostico
      FROM diagnostico
      WHERE id_mipyme = $1
        AND COALESCE(estado, 'activo') != 'eliminado'
      LIMIT 1
      `,
      [id_mipyme]
    );

    let result;

    if (existente.rows.length === 0) {
      // ✅ CREATE
      result = await client.query(
        `
        INSERT INTO diagnostico (
          titulo,
          problema,
          beneficios,
          id_mipyme,
          estado,
          created_at,
          created_by
        )
        VALUES ($1,$2,$3,$4,'activo',NOW(),$5)
        RETURNING *
        `,
        [
          diagnosticoIA.titulo,
          diagnosticoIA.problema,
          diagnosticoIA.beneficios,
          id_mipyme,
          req.user.id_usuario
        ]
      );
    } else {
      // ✅ UPDATE
      result = await client.query(
        `
        UPDATE diagnostico
        SET
          titulo = $1,
          problema = $2,
          beneficios = $3,
          updated_at = NOW(),
          updated_by = $5
        WHERE id_diagnostico = $4
        RETURNING *
        `,
        [
          diagnosticoIA.titulo,
          diagnosticoIA.problema,
          diagnosticoIA.beneficios,
          existente.rows[0].id_diagnostico,
          req.user.id_usuario
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Diagnóstico generado correctamente',
      diagnostico: result.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error generarDiagnosticos:', err);

    if (err instanceof AIServiceError) {
      return res.status(422).json({
        error: 'Error IA',
        ai_error: {
          code: err.code,
          message_user: err.messageUser,
        },
      });
    }

    return res.status(500).json({
      error: 'Error interno',
    });
  } finally {
    client.release();
  }
}


async function generarDiagnosticoConIA(contexto) {

  const response = await askAIStructured({
    role: `
Eres un consultor especializado en sostenibilidad, innovación, nuevas tecnologías, finanzas verdes, eficiencia de recursos y optimización operativa para micro y pequeñas empresas.
Tu función es analizar información empresarial, consumos históricos, activos operativos y soluciones disponibles para identificar oportunidades de mejora que reduzcan costos, consumo de recursos y huella ambiental.
Debes actuar como un consultor técnico objetivo y fundamentar todas tus conclusiones utilizando exclusivamente la información proporcionada.
    `,
    taskDescription: `
Analiza la información suministrada sobre:
  - La empresa.
  - Las facturas de servicios públicos.
  - Los activos identificados.
  - El catálogo de productos o soluciones disponibles.
Identifica las principales oportunidades de mejora para la organización.
Debes:
1. Analizar patrones de consumo.
2. Identificar posibles causas de ineficiencia.
3. Relacionar dichas causas con los activos observados.
4. Detallar activos culpables de posibles sobrecostos, de alto impacto ambiental, antiguos, con poca eficiencia o en general identificar los activos cuyo cambio generaría un impacto mayor.
5. Explicar detalladamente las condiciones actuales de cada activo, su consumo, su nivel de alerta y su impacto tanto ambiental como económico. Todo en palabras ejecutivas y no técnicas.
6. Explicar detalladamente las oportunidades de mejora para cada activo, basado en el catalogo de proveedores. Indicando mejoras en consumo, costos, eficiencia, gastos e impacto.
    `,
    contextData: contexto,
    outputSchemaExample: {
      titulo: 'Optimización del consumo eléctrico',
      problema: {
        resumen: 'Se detecta un consumo eléctrico superior al esperado en ciertos activos de refrigeración.',
        detalle: 'El activo A genera un consumo de 200khw al mes, este consumo cumple con los estándares de calidad actuales para este tipo de activo, es eficiente y reduce la huella de carbono. El activo B tiene un consumo desmedido para su categoría, según la información proporcionada es un elemento altamente ineficiente generando un impacto aproximado de 200kgCO2e, es un activo de cuidado prioritario. El activo C no reporta datos técnicos y en las fotos se evidencia como un insumo antiguo, es recomendable validar la posibilidad de reemplazarlo ya que no conocemos sus datos y los modelos antiguos son poco eficientes energéticamente..., El gasto total para los activos de la categoria x es de 500kwh, que se traduce en un costo de 300000, relacionado con la factura presentada, representa un 75% del valor.',
      },
      beneficios: {
        resumen: 'Los proveedores ofrecen potenciales mejoras para varios de los activos analizados, aproximando una reducción de consumo de agua en 40m3 y de energía en 50khw por mes',
        detalle: 'El activo A no requiere modificación, ya es altamente eficiente y los proveedores no ofrecen algo mejor. El activo B puede ser reemplazado por algún producto del catalogo, todas las alternativas ofrecen reducción de aproximadamente 30khw y 15m3 en consumo de energía y agua, lo que se traduce en una reducción de costos importante y mostrando este cambio como prioritario. Los proveedores tienen varios candidatos potenciales para reemplazar el activo C, y todas las opciones son modernas y eficientes, rondando costos de entre 1000000 y 2500000 pesos',
      },
    },
    rules: [
      'Basa todas las conclusiones en la información proporcionada.',
      "No inventes consumos, costos ni características técnicas.",
      "Si los datos son insuficientes para determinar una causa específica, indícalo explícitamente.",
      `
      Prioriza oportunidades con:
        - Mayor impacto potencial.
        - Mayor reducción de consumo.
        - Mayor reducción de costos.
        - Mayor alineación con el catálogo disponible.
      `,
      `
      El campo problema debe explicar:
        - Qué se observó.
        - Por qué representa un problema o riesgo.
        - Qué evidencia respalda la conclusión.
        - Esto debe ser a manera general para toda la información generada, y uno por uno para cada activo o item diagnosticado.
      `,
      `
      El campo beneficios debe explicar:
        - Qué acción se recomienda.
        - Cómo resuelve el problema identificado.
        - Qué beneficios puede generar, tanto ambientales como economicos.
        - La inversion requerida para solucionar los problemas, tanto individual por activo como de manera general para todo el diagnosticio. 
      `,
      "Utiliza lenguaje profesional orientado a empresarios no técnicos.",
      "El contenido debe ser muy detallado, pasando uno por uno por todos los activos presentados, analizándolos a profundidad, diagnosticando su estado con detalles y mostrando explícitamente los amrgenes de mejora. Debes explicar con datos toda la información presentada, no importa que tan amplio quede el campo de detalle. Debe ser orientado al cambio y accionable.",
      "La respuesta debe contener únicamente un JSON válido.",
      `
      No generes campos adicionales.
      Los campos de resumen deben ser extremadamente resumidos, una síntesis de 1 o 2 líneas máximo.
      Los campos de detalle deben ser extremadamente detallados, derrámate explicando todos los hallazgos y las posibles mejoras que encuentres
      `,
    ],
    imagePaths: [],
  });

  return {
    titulo: response.titulo,
    problema: response.problema ?? {},
    beneficios: response.beneficios ?? {},
  };
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function esTipoElectrodomestico(activo) {
  const tipo = normalizeText(activo?.tipo);
  const nombre = normalizeText(activo?.nombre);
  const descripcion = normalizeText(activo?.descripcion);

  const palabrasClave = [
    'electrodomestico',
    'electrodoméstico',
    'nevera',
    'refrigerador',
    'congelador',
    'lavadora',
    'secadora',
    'microondas',
    'televisor',
    'aire acondicionado',
    'ventilador',
    'horno',
    'cafetera',
    'licuadora',
  ];

  return palabrasClave.some(
    (kw) =>
      tipo.includes(kw) ||
      nombre.includes(kw) ||
      descripcion.includes(kw)
  );
}

function esTipoServicio(activo) {
  const tipo = normalizeText(activo?.tipo);
  return tipo.includes('servicio');
}

function validarContextoDiagnostico({
  empresa,
  activos = [],
  facturas = [],
  diagnosticos = [],
}) {
  const errores = [];
  const warnings = [];

  const hayEmpresa = empresa && Object.keys(empresa).length > 0;
  const hayActivos = Array.isArray(activos) && activos.length > 0;
  const hayFacturas = Array.isArray(facturas) && facturas.length > 0;
  const hayDiagnosticos =
    Array.isArray(diagnosticos) && diagnosticos.length > 0;

  if (!hayEmpresa && !hayActivos && !hayFacturas && !hayDiagnosticos) {
    errores.push(
      'Debes enviar al menos una fuente de contexto: empresa, activos, facturas o diagnosticos.'
    );
  }

  const activosElectrodomesticos = (activos || []).filter(
    esTipoElectrodomestico
  );

  if (activosElectrodomesticos.length > 0 && !hayFacturas) {
    errores.push(
      'No se puede generar diagnóstico porque hay activos de tipo electrodoméstico y no se recibieron facturas.'
    );
  }

  const activosServicios = (activos || []).filter(esTipoServicio);

  if (
    activosServicios.length > 0 &&
    activosElectrodomesticos.length === 0 &&
    !hayFacturas
  ) {
    warnings.push(
      'Se permite continuar sin facturas porque los activos recibidos parecen corresponder a servicios.'
    );
  }

  if (hayFacturas && !hayActivos) {
    warnings.push(
      'Se recibieron facturas sin activos. El diagnóstico se basará principalmente en consumos.'
    );
  }

  return {
    ok: errores.length === 0,
    errores,
    warnings,
    resumen: {
      hayEmpresa,
      hayActivos,
      hayFacturas,
      hayDiagnosticos,
      activosElectrodomesticos: activosElectrodomesticos.length,
      activosServicios: activosServicios.length,
    },
  };
}

async function syncDiagnosticosDeMipyme(
  client,
  idMipyme,
  diagnosticosIA,
  userId
) {
  const existingResult = await client.query(
    `
    SELECT id_diagnostico, titulo, problema, beneficios
    FROM diagnostico
    WHERE id_mipyme = $1
      AND COALESCE(estado, 'activo') != 'eliminado'
    `,
    [idMipyme]
  );

  const existentes = existingResult.rows;

  const mapExistentes = {};
  for (const row of existentes) {
    mapExistentes[row.titulo.trim().toLowerCase()] = row;
  }

  const resultados = [];

  for (const diag of diagnosticosIA) {
    const titulo = diag.titulo?.trim();
    if (!titulo) continue;

    const problema = diag.problema ?? {};
    const beneficios = diag.beneficios ?? {};

    const existente = mapExistentes[titulo.toLowerCase()];

    if (!existente) {
      const created = await client.query(
        `
        INSERT INTO diagnostico (
          titulo,
          problema,
          beneficios,
          id_mipyme,
          estado,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, 'activo', NOW(), NULL, $5, NULL)
        RETURNING *
        `,
        [titulo, problema, beneficios, idMipyme, userId]
      );

      resultados.push({
        accion: 'create',
        data: created.rows[0],
      });

      continue;
    }

    const anterior = JSON.stringify({
      problema: existente.problema,
      beneficios: existente.beneficios,
    });

    const nuevo = JSON.stringify({
      problema,
      beneficios,
    });

    if (anterior === nuevo) {
      resultados.push({
        accion: 'sin_cambios',
        data: existente,
      });
      continue;
    }

    const updated = await client.query(
      `
      UPDATE diagnostico
      SET
        problema = $1,
        beneficios = $2,
        updated_at = NOW(),
        updated_by = $4
      WHERE id_diagnostico = $3
      RETURNING *
      `,
      [problema, beneficios, existente.id_diagnostico, userId]
    );

    resultados.push({
      accion: 'update',
      data: updated.rows[0],
    });
  }

  return resultados;
}

async function getMisDiagnosticos(req, res) {

  const idUsuario = req.user?.id_usuario;

  try {

    if (!idUsuario) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const mipymeResult = await pool.query(
      `
      SELECT m.id_mipyme
      FROM mipyme_usuario mu
      INNER JOIN mipyme m ON m.id_mipyme = mu.id_mipyme
      WHERE mu.id_usuario = $1
      `,
      [idUsuario]
    );

    const idMipyme = mipymeResult.rows[0]?.id_mipyme;

    const result = await pool.query(
      `
      SELECT *
      FROM diagnostico
      WHERE id_mipyme = $1
      AND COALESCE(estado, 'activo') != 'eliminado'
      LIMIT 1
      `,
      [idMipyme]
    );

    return res.status(200).json({
      diagnostico: result.rows[0] || null,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Error interno' });
  }
}

async function obtenerCatalogoRelevante(client, activos = []) {
  if (!Array.isArray(activos) || activos.length === 0) {
    return [];
  }

  // ✅ helper local
  const clean = (value) =>
    (value || '')
      .toString()
      .trim()
      .toLowerCase();

  // ✅ palabras clave por tipo
  const tipos = [
    ...new Set(
      activos
        .map((a) => clean(a.tipo))
        .filter((v) => v !== '')
    ),
  ];

  // ✅ palabras clave por nombre / marca / modelo
  const keywords = [
    ...new Set(
      activos
        .flatMap((a) => [
          clean(a.nombre),
          clean(a.marca),
          clean(a.modelo),
        ])
        .filter((v) => v !== '')
    ),
  ];

  // ✅ si no hay contexto, no buscar nada
  if (tipos.length === 0 && keywords.length === 0) {
    return [];
  }

  const result = await client.query(
    `
    SELECT
      ic.id_item,
      ic.tipo_item,
      ic.nombre,
      ic.descripcion,
      ic.especificaciones,
      ic.precio_base,
      ic.disponible,
      ic.id_proveedor
    FROM item_catalogo ic
    WHERE ic.disponible = true
      AND (
        EXISTS (
          SELECT 1
          FROM unnest($1::text[]) AS t
          WHERE LOWER(COALESCE(ic.tipo_item, '')) LIKE '%' || t || '%'
        )
        OR
        EXISTS (
          SELECT 1
          FROM unnest($2::text[]) AS k
          WHERE LOWER(COALESCE(ic.nombre, '')) LIKE '%' || k || '%'
             OR LOWER(COALESCE(ic.descripcion, '')) LIKE '%' || k || '%'
        )
      )
    ORDER BY ic.precio_base ASC NULLS LAST, ic.nombre ASC
    `,
    [tipos, keywords]
  );

  return result.rows;
}

module.exports = {
  generarYSyncDiagnosticos,
  getMisDiagnosticos,
};