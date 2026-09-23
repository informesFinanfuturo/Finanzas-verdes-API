const jwt = require('jsonwebtoken');
const pool = require('../db');
const path = require('path');
const fs = require('fs');
const { askAIWithImages, askAIStructured } = require('../services/iaService');

async function createConsumo(req, res) {
  const {
    tipo,
    proveedor,
    periodo_inicio,
    periodo_fin,
    valor,

    // ✅ NUEVOS CAMPOS
    consumo_actual,
    consumo_promedio,
    consumo_anteriores,

    unidad,
    observaciones,
    estado,
    id_mipyme,
    created_by
  } = req.body;

  try {
    // ✅ 1. Validación mínima
    if (!tipo) {
      return res.status(400).json({
        error: 'tipo es obligatorio',
      });
    }

    // ✅ 2. Construir JSON consumo
    let consumo = null;

    if (
      consumo_actual !== undefined ||
      consumo_promedio !== undefined ||
      consumo_anteriores !== undefined
    ) {
      // ✅ Validar lista de anteriores
      let anteriores = null;

      if (consumo_anteriores !== undefined) {
        if (!Array.isArray(consumo_anteriores)) {
          return res.status(400).json({
            error: 'consumo_anteriores debe ser una lista de números',
          });
        }

        anteriores = consumo_anteriores.map((v) => Number(v)).filter((v) => !isNaN(v));
      }

      consumo = {
        actual: consumo_actual !== undefined ? Number(consumo_actual) : null,
        promedio: consumo_promedio !== undefined ? Number(consumo_promedio) : null,
        anteriores,
      };
    }

    // ✅ 3. Insert
    const result = await pool.query(
      `
      INSERT INTO consumo (
        tipo,
        proveedor,
        periodo_inicio,
        periodo_fin,
        valor,
        consumo,
        unidad,
        observaciones,
        estado,
        id_mipyme,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        NOW(),
        NULL,
        $11,
        NULL
      )
      RETURNING *
      `,
      [
        tipo,
        proveedor ?? null,
        periodo_inicio ?? null,
        periodo_fin ?? null,
        valor ?? null,
        consumo ?? null, // ✅ JSON completo
        unidad ?? null,
        observaciones ?? null,
        estado ?? 'activo',
        id_mipyme ?? null,
        created_by ?? null
      ]
    );

    return res.status(201).json({
      message: 'Consumo creado correctamente',
      id_consumo: result.rows[0].id_consumo,
      consumo: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear consumo:', err);

    return res.status(500).json({
      error: 'Error interno al crear consumo',
    });
  }
}

async function updateConsumo(req, res) {
  const idConsumo = Number(req.params.id);

  const updated_by = req.user?.id_usuario;

  const {
    tipo,
    proveedor,
    periodo_inicio,
    periodo_fin,
    valor,
    consumo_actual,
    consumo_promedio,
    consumo_anteriores,
    unidad,
    observaciones,
    estado,
  } = req.body;

  try {
    if (Number.isNaN(idConsumo)) {
      return res.status(400).json({
        error: 'El id del consumo debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const exists = await pool.query(
      'SELECT id_consumo FROM consumo WHERE id_consumo = $1',
      [idConsumo]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    const fields = [];
    const values = [];
    let index = 1;

    // ✅ NORMALIZADOR (CLAVE 🔥)
    const normalize = (value) => {
      if (typeof value === 'string' && value.trim() === '') {
        return null;
      }
      return value;
    };

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(normalize(value));
      index++;
    };

    // ✅ CAMPOS SIMPLES
    if (tipo !== undefined) add('tipo', tipo);
    if (proveedor !== undefined) add('proveedor', proveedor);
    if (valor !== undefined) add('valor', valor);
    if (periodo_inicio !== undefined) add('periodo_inicio', periodo_inicio);
    if (periodo_fin !== undefined) add('periodo_fin', periodo_fin);
    if (unidad !== undefined) add('unidad', unidad);
    if (observaciones !== undefined) add('observaciones', observaciones);
    if (estado !== undefined) add('estado', estado);

    // ✅ CONSUMO JSON
    if (
      consumo_actual !== undefined ||
      consumo_promedio !== undefined ||
      consumo_anteriores !== undefined
    ) {

      let anteriores = null;

      if (consumo_anteriores !== undefined) {
        if (!Array.isArray(consumo_anteriores)) {
          return res.status(400).json({
            error: 'consumo_anteriores debe ser una lista de números',
          });
        }

        anteriores = consumo_anteriores
          .map((v) => Number(v))
          .filter((v) => !isNaN(v));
      }

      const consumoObj = {
        actual:
          consumo_actual !== undefined
            ? Number(consumo_actual) || null
            : null,

        promedio:
          consumo_promedio !== undefined
            ? Number(consumo_promedio) || null
            : null,

        anteriores,
      };

      add('consumo', consumoObj);
    }

    // ✅ auditoría
    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    if (fields.length === 1) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await pool.query(
      `
      UPDATE consumo
      SET ${fields.join(', ')}
      WHERE id_consumo = $${index}
      RETURNING *
      `,
      [...values, idConsumo]
    );

    return res.status(200).json({
      message: 'Consumo actualizado correctamente',
      consumo: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar consumo:', err);

    return res.status(500).json({
      error: 'Error interno al actualizar consumo',
    });
  }
}

async function getConsumoById(req, res) {
  const idConsumo = Number(req.params.id);

  try {
    // ✅ 1. Validar ID
    if (Number.isNaN(idConsumo)) {
      return res.status(400).json({
        error: 'El id del consumo debe ser numérico',
      });
    }

    // ✅ 2. Consultar
    const result = await pool.query(
      `
      SELECT 
        c.id_consumo,
        c.tipo,
        c.proveedor,

        c.periodo_inicio,
        c.periodo_fin,

        c.valor,
        c.consumo,
        c.unidad,
        c.observaciones,
        c.observacion_ia,
        c.created_at,
        c.updated_at,
        c.created_by,
        c.updated_by,

        COALESCE(
          json_agg(
            json_build_object(
              'id_archivo', ar.id_archivo,
              'nombre_original', ar.nombre_original,
              'nombre_fisico', ar.nombre_fisico,
              'extension', ar.extension,
              'mime', ar.mime,
              'ubicacion', ar.ubicacion
            )
          ) FILTER (WHERE ar.id_archivo IS NOT NULL),
          '[]'
        ) AS imagenes

      FROM consumo c
      LEFT JOIN consumo_archivo ca
        ON ca.id_consumo = c.id_consumo
      LEFT JOIN archivo ar
        ON ar.id_archivo = ca.id_archivo

      WHERE 
        c.id_consumo = $1
        AND COALESCE(c.estado, 'activo') != 'eliminado' -- ✅ importante

      GROUP BY c.id_consumo
      `,
      [idConsumo]
    );

    // ✅ 3. Validar existencia
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    return res.status(200).json({
      consumo: result.rows[0],
    });

  } catch (err) {
    console.error('Error al obtener consumo:', err);

    return res.status(500).json({
      error: 'Error interno al obtener consumo',
    });
  }
}

async function uploadImagenConsumo(req, res) {
  const {
    id_consumo,
    created_by
  } = req.body;

  try {
    // 1️⃣ Validaciones
    if (!req.file) {
      return res.status(400).json({
        error: 'La imagen es obligatoria',
      });
    }

    if (!id_consumo || !created_by) {
      return res.status(400).json({
        error: 'id_consumo y created_by son obligatorios',
      });
    }

    // 2️⃣ Verificar consumo
    const consumoExists = await pool.query(
      'SELECT id_consumo FROM consumo WHERE id_consumo = $1',
      [id_consumo]
    );

    if (consumoExists.rows.length === 0) {
      return res.status(404).json({
        error: 'consumo no encontrado',
      });
    }

    // ✅ IMPORTANTE: multer ya guardó el archivo
    const file = req.file;

    // 3️⃣ Procesar datos del archivo
    const extension = path.extname(file.originalname).replace('.', '');

    // 4️⃣ Insertar en tabla archivo
    const archivoResult = await pool.query(
      `
      INSERT INTO archivo (
        nombre_original,
        nombre_fisico,
        extension,
        mime,
        ubicacion,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES ($1,$2,$3,$4,$5,'consumo',NOW(),NULL,$6,NULL)
      RETURNING
        id_archivo,
        nombre_original,
        nombre_fisico,
        ubicacion
      `,
      [
        file.originalname,           // ✅ nombre original
        file.filename,               // ✅ generado por multer
        extension,
        file.mimetype,               // ✅ tipo MIME
        `uploads/${file.filename}`, // ✅ ruta
        created_by
      ]
    );

    const archivo = archivoResult.rows[0];

    // 5️⃣ Relacionar con consumo
    await pool.query(
      `
      INSERT INTO consumo_archivo (
        id_archivo,
        id_consumo
      )
      VALUES ($1,$2)
      `,
      [
        archivo.id_archivo,
        id_consumo
      ]
    );

    // 6️⃣ Respuesta
    return res.status(201).json({
      message: 'Imagen subida correctamente',
      archivo
    });

  } catch (err) {
    console.error('Error al subir imagen:', err);

    return res.status(500).json({
      error: 'Error interno al subir imagen',
    });
  }
}

async function uploadDocumentoConsumo(req, res) {

  const {
    id_consumo,
    created_by
  } = req.body;

  try {

    if (!req.file) {
      return res.status(400).json({
        error: 'El documento es obligatorio',
      });
    }

    if (!id_consumo || !created_by) {
      return res.status(400).json({
        error: 'id_consumo y created_by son obligatorios',
      });
    }

    const consumoExists =
      await pool.query(
        `
        SELECT id_consumo
        FROM consumo
        WHERE id_consumo = $1
        `,
        [id_consumo]
      );

    if (
      consumoExists.rows.length === 0
    ) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    const file = req.file;

    const extension =
      path
        .extname(
          file.originalname
        )
        .replace('.', '')
        .toLowerCase();

    const extensionesPermitidas = [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'csv'
    ];

    if (
      !extensionesPermitidas.includes(
        extension
      )
    ) {

      return res.status(400).json({
        error:
          'Tipo de documento no permitido',
      });

    }

    const archivoResult =
      await pool.query(
        `
        INSERT INTO archivo (
          nombre_original,
          nombre_fisico,
          extension,
          mime,
          ubicacion,
          estado,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'documento_consumo',
          NOW(),
          NULL,
          $6,
          NULL
        )
        RETURNING
          id_archivo,
          nombre_original,
          nombre_fisico,
          extension,
          mime,
          ubicacion
        `,
        [
          file.originalname,
          file.filename,
          extension,
          file.mimetype,
          `uploads/${file.filename}`,
          created_by
        ]
      );

    const archivo =
      archivoResult.rows[0];

    await pool.query(
      `
      INSERT INTO consumo_archivo (
        id_archivo,
        id_consumo
      )
      VALUES ($1,$2)
      `,
      [
        archivo.id_archivo,
        id_consumo
      ]
    );

    return res.status(201).json({

      message:
        'Documento subido correctamente',

      archivo,

    });

  } catch (err) {

    console.error(
      'Error al subir documento:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al subir documento',
    });

  }

}

async function deleteArchivoConsumo(req, res) {

  const { id_archivo } = req.params;

  try {

    if (!id_archivo) {
      return res.status(400).json({
        error: 'id_archivo es obligatorio',
      });
    }

    const archivoResult =
      await pool.query(
        `
        SELECT *
        FROM archivo
        WHERE id_archivo = $1
        `,
        [id_archivo]
      );

    if (
      archivoResult.rows.length === 0
    ) {
      return res.status(404).json({
        error:
          'Archivo no encontrado',
      });
    }

    const archivo =
      archivoResult.rows[0];

    const filePath =
      path.join(
        __dirname,
        '..',
        archivo.ubicacion
      );

    await pool.query(
      `
      DELETE FROM consumo_archivo
      WHERE id_archivo = $1
      `,
      [id_archivo]
    );

    await pool.query(
      `
      DELETE FROM archivo
      WHERE id_archivo = $1
      `,
      [id_archivo]
    );

    if (
      fs.existsSync(filePath)
    ) {
      fs.unlinkSync(filePath);
    }

    return res.status(200).json({
      message:
        'Archivo eliminado correctamente',
    });

  } catch (err) {

    console.error(
      'Error al eliminar archivo:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al eliminar archivo',
    });

  }

}

async function analizarConsumo(req, res) {
  const idConsumo = Number(req.params.id);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ 1. Validar ID
    if (Number.isNaN(idConsumo)) {
      return res.status(400).json({
        error: 'El id del consumo debe ser numérico',
      });
    }

    // ✅ 2. Obtener consumo completo
    const consumoResult = await client.query(
      `
      SELECT 
        c.id_consumo,
        c.tipo,
        c.proveedor,
        c.periodo_inicio,
        c.periodo_fin,
        c.valor,
        c.consumo,
        c.unidad,
        c.observaciones,
        c.estado,
        c.id_mipyme,
        c.created_at,
        c.updated_at,
        c.created_by,
        c.updated_by,

        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id_archivo', ar.id_archivo,
              'nombre_original', ar.nombre_original,
              'nombre_fisico', ar.nombre_fisico,
              'extension', ar.extension,
              'mime', ar.mime,
              'ubicacion', ar.ubicacion
            )
          ) FILTER (WHERE ar.id_archivo IS NOT NULL),
          '[]'::jsonb
        ) AS imagenes

      FROM consumo c
      LEFT JOIN consumo_archivo ca
        ON ca.id_consumo = c.id_consumo
      LEFT JOIN archivo ar
        ON ar.id_archivo = ca.id_archivo

      WHERE 
        c.id_consumo = $1
        AND COALESCE(c.estado, 'activo') != 'eliminado'

      GROUP BY c.id_consumo
      `,
      [idConsumo]
    );

    if (consumoResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    const consumoActual = consumoResult.rows[0];

    // ✅ 3. Preparar imágenes para IA
    const archivos =
  consumoActual.imagenes || [];

const imagePaths = archivos
  .filter(img =>
    [
      'jpg',
      'jpeg',
      'png',
      'webp'
    ].includes(
      (img.extension || '')
        .toLowerCase()
    )
  )
  .map(img =>
    path.join(
      __dirname,
      '..',
      img.ubicacion
    )
  );

const documentPaths = archivos
  .filter(img =>
    [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'csv'
    ].includes(
      (img.extension || '')
        .toLowerCase()
    )
  )
  .map(img =>
    path.join(
      __dirname,
      '..',
      img.ubicacion
    )
  );

    // ✅ 4. IA genérica + configurable por endpoint
    const datosIA = await askAIStructured({
      modelo: "gemini-3.1-flash-lite",
      role: `
      Eres un analista experto en interpretación de facturas de servicios públicos domiciliarios de Colombia (energía eléctrica, agua potable y gas natural).
      Tu función es analizar una o varias fotografías de una factura y extraer exclusivamente la información visible en el documento.
      Debes comportarte como un extractor documental preciso y conservador. No debes asumir, deducir ni inventar información que no sea claramente identificable.
      `,
      taskDescription:
      `
      Analiza las imágenes proporcionadas y extrae la siguiente información de la factura:
      - Proveedor o empresa prestadora del servicio.
      - Fecha de inicio del período facturado.
      - Fecha de fin del período facturado.
      - Valor asociado al consumo del período el pesos colombianos.
      - Consumo actual del período.
      - Consumo promedio reportado por la factura.
      - Consumo de los 6 periodos anteriores.
      - Costo unitario del servicio (valor del m3 o kwh)
      - Unidad de medida del consumo.
      Utiliza los datos presentes en la factura y los valores de contexto proporcionados como ayuda para identificar información ambigua o validar resultados.
      Cuando existan múltiples valores candidatos para un mismo campo, selecciona únicamente aquel que corresponda claramente al período de facturación actual.
      `,
      contextData: {
        tipo: consumoActual.tipo,
        proveedor: consumoActual.proveedor,
        periodo_inicio: consumoActual.periodo_inicio,
        periodo_fin: consumoActual.periodo_fin,
        valor: consumoActual.valor,
        consumo: {
          actual: consumoActual.consumo,
          promedio: null,
          anteriores: [],
        },
        unidad: consumoActual.unidad,
        observaciones: consumoActual.observaciones,
      },
      outputSchemaExample: {
        "tipo" : `Enum(
          "Agua",
          "Energía"
        )`,
        "proveedor": `Enum(
          "Chec",
          "Aguas de Manizales",
          "Efigas",
          "Aquamaná",
          "Empocaldas",
          "Otro"
        )`,
        "periodo_inicio": "YYYY-MM-DD | null",
        "periodo_fin": "YYYY-MM-DD | null",
        "valor": 0,
        "consumo": {
          "actual": 0,
          "promedio": 0,
          "anteriores": []
        },
        "unidad": "String | null",
        "observacion_ia": "String | null",
        "costo_unitario" : "double | null"
      },
      rules: [
        "Extrae únicamente datos visibles o claramente identificables en la factura.",
        "Nunca inventes valores.",
        "Si un dato no puede determinarse con suficiente confianza, devuelve null.",
        "Si existen diferencias entre la factura y el ContextData, prioriza siempre la información de la factura.",
        `
        Para el campo valor sigue estrictamente este orden:
        1. Busca primero el valor asociado exclusivamente al consumo del servicio principal facturado (Agua, Energía o Gas).
        2. Excluye explícitamente:
          - Alumbrado público.
          - Aseo.
          - Aprovechamiento.
          - Tasa ambiental.
          - Sobretasas.
          - Contribuciones.
          - Intereses.
          - Financiaciones.
          - Otros conceptos distintos al servicio principal.
        3. Si la factura discrimina cargos:
          - Utiliza únicamente los conceptos relacionados con el servicio principal.
        4. Si existe una línea llamada:
          - Valor servicio.
          - Total servicio.
          - Servicio energía.
          - Servicio acueducto.
          - Total período actual.
          - Consumo del período.
          utiliza preferentemente ese valor.
        5. Solo si NO es posible aislar el costo del servicio principal utiliza el total factura.
        6. Si se usa el total factura porque no existe desglose suficiente, registra esta situación en observacion_ia.
        `,
        "Si la factura discrimina cargos como: cargo fijo, consumo, subsidios, contribuciones o impuestos, intenta aislar el valor del consumo.",
        "Si solo está disponible el valor total de la factura y no se puede separar el consumo, usa el valor total y registra una observación indicando esta situación.",
        "Para el campo consumo, selecciona el consumo correspondiente al período actual facturado.",
        "Para el cálculo del costo unitario utiliza únicamente los cargos asociados directamente al suministro o prestación de servicio. Excluye explícitamente tasas, contribuciones, subsidios, entre otros cobros no relacionados con el consumo del servicio. En facturas de agua considera unicamente los costos de acueducto y alcantarillado. Si existen varios costos unitarios debes calcular el costo unitario como el promedio unicamente entre los costos válidos, no utilices tasas para calcular el costo unitario.",
        "Si existe un consumo promedio explícito en la factura, extráelo como consumo promedio.",
        "Extrae siempre los consumos históricos visibles de tablas, gráficos o listados, asegurándote de que sean los pertenecientes a meses anteriores, no promedios ni el mes actual. Nunca inventes los consumos, si solo hay 4 o 5 meses anteriores no inventes para completar 6. Siempre extrae el consumo unitario (en m3 o kwh), nunca otros datos históricos.",
        `
        Cuando extraigas consumos históricos:

        1. Identifica primero la referencia temporal asociada a cada consumo:
          - mes,
          - período,
          - fecha,
          - etiqueta del eje horizontal.
        2. Nunca determines el orden únicamente por la posición visual de los valores dentro de la imagen.
        3. Reconstruye primero pares:
          (periodo, consumo)
        4. Ordena los consumos utilizando la fecha o período identificado y no la ubicación gráfica.
        5. Si existe ambigüedad sobre el orden cronológico, registra la situación en observacion_ia.
        `,
        "Normaliza todas las fechas al formato YYYY-MM-DD.",
        "Normaliza todos los valores numéricos sin símbolos monetarios, sin separadores de miles y usando punto decimal.",
        "La unidad debe ser exactamente uno de los siguientes valores cuando corresponda: kWh, m3, m³, Litros, Galones, Otro.",
        "Si detectas información incompleta, inconsistente o baja calidad visual, regístralo en el campo observaciones.",
        "La respuesta debe ser exclusivamente un objeto JSON válido.",
        "No incluyas explicaciones, comentarios ni texto adicional.",
        "En el campo de observacion_ia, explica qué datos utilizaste o qué aproximaciones hiciste para llegar las conclusiones y a los indicadores. Unicamente en este campo este campo debes usar formato de moneda para representar los costos"
      ],
      imagePaths,
      documentPaths
    });

    // ✅ 5. Normalizadores
    const normalizeNumber = (value) => {
      if (value === null || value === undefined || value === '') return null;

      if (typeof value === 'number') return value;

      const cleaned = String(value)
        .replace(/[^\d,.-]/g, '')
        .replace(/\.(?=.*\.)/g, '')
        .replace(',', '.');

      const parsed = Number(cleaned);
      return Number.isNaN(parsed) ? null : parsed;
    };

    
    const normalizeConsumoObject = (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

      const anteriores = Array.isArray(value.anteriores)
        ? value.anteriores
            .map((v) => normalizeInt(v))
            .filter((v) => v !== null)
        : [];

      return {
        actual: normalizeInt(value.actual),
        promedio: normalizeInt(value.promedio),
        anteriores,
      };
    };

    
    const normalizeInt = (value) => {
      if (value === null || value === undefined || value === '') return null;

      if (typeof value === 'number') return Math.round(value);

      const cleaned = String(value)
        .replace(/[^\d,.-]/g, '')
        .replace(/\.(?=.*\.)/g, '')
        .replace(',', '.');

      const parsed = Number(cleaned);
      return Number.isNaN(parsed) ? null : Math.round(parsed);
    };



    const normalizeString = (value) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };

    // ✅ 6. Mezclar IA + valores actuales
    const finalData = {
        tipo:
            normalizeString(datosIA.tipo) ?? consumoActual.tipo ?? null,
        proveedor:
            normalizeString(datosIA.proveedor) ?? consumoActual.proveedor ?? null,

        periodo_inicio:
            normalizeString(datosIA.periodo_inicio) ??
            consumoActual.periodo_inicio ??
            null,

        periodo_fin:
            normalizeString(datosIA.periodo_fin) ??
            consumoActual.periodo_fin ??
            null,

        valor: normalizeInt(datosIA.valor) ?? consumoActual.valor ?? null,

        consumo:
            normalizeConsumoObject(datosIA.consumo) ??
            consumoActual.consumo ??
            null,

        unidad: normalizeString(datosIA.unidad) ?? consumoActual.unidad ?? null,

        observacion_ia:
            normalizeString(datosIA.observacion_ia) ??
            null,
        
        costo_unitario:
            normalizeNumber(datosIA.costo_unitario) ??
            consumoActual.costo_unitario ??
            null,
      };

    // ✅ 7. Actualizar consumo
    const updateResult = await client.query(
      `
      UPDATE consumo
      SET
        tipo = $1,
        proveedor = $2,
        periodo_inicio = $3,
        periodo_fin = $4,
        valor = $5,
        consumo = $6,
        unidad = $7,
        observacion_ia = $8,
        costo_unitario = $9,
        updated_at = NOW()
      WHERE id_consumo = $10
      RETURNING *
      `,
      [
        finalData.tipo,
        finalData.proveedor,
        finalData.periodo_inicio,
        finalData.periodo_fin,
        finalData.valor,
        finalData.consumo,
        finalData.unidad,
        finalData.observacion_ia,
        finalData.costo_unitario,
        idConsumo,
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Consumo analizado y actualizado correctamente',
      consumo: updateResult.rows[0],
      analisis: finalData,
      imagenes_enviadas: imagePaths.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error analizando consumo:', err);

    return res.status(500).json({
      error: err.message || 'Error interno al analizar consumo',
    });
  } finally {
    client.release();
  }
}

async function deleteConsumo(req, res) {
  const idConsumo = Number(req.params.id);

  // ✅ USAR TOKEN
  const updated_by = req.user?.id_usuario;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (Number.isNaN(idConsumo)) {
      return res.status(400).json({
        error: 'El id del consumo debe ser numérico',
      });
    }

    // ✅ VALIDAR usuario
    if (!updated_by) {
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    const consumoResult = await client.query(
      `SELECT id_consumo FROM consumo WHERE id_consumo = $1`,
      [idConsumo]
    );

    if (consumoResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    // ✅ resto igual...

    const updated = await client.query(
      `
      UPDATE consumo
      SET estado = 'eliminado',
          updated_at = NOW(),
          updated_by = $1
      WHERE id_consumo = $2
      RETURNING *
      `,
      [updated_by, idConsumo]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Consumo eliminado correctamente',
      consumo: updated.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error eliminando consumo:', err);

    return res.status(500).json({
      error: 'Error interno al eliminar consumo',
    });
  } finally {
    client.release();
  }
}


module.exports = {
  createConsumo,
  updateConsumo,
  getConsumoById,
  uploadImagenConsumo,
  uploadDocumentoConsumo,
  deleteArchivoConsumo,
  analizarConsumo,
  deleteConsumo,
};