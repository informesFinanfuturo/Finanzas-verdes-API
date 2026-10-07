// controllers/catalogo.controller.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { uploadImagenActivo } = require('./activo.controller');
const {
  extractCatalogLaPipa,
  removeDuplicates,
} = require('../services/catalogos/laPipaCrawler');

const {
  runWithSyncLogContext,
  withSyncStage,
  getSyncLogStats,
} = require(
  '../services/catalogos/syncExecutionLogger'
);

const {
  extractCatalogComercialCaldas,
  procesarFichasPorLotesAPowerAutomate,
} = require(
  '../services/catalogos/comercialCaldasCrawler'
);

// GET /api/catalogo
async function createItem(req, res) {
  const {
    tipo_item,
    nombre,
    descripcion,
    especificaciones, // ✅ JSON
    precio_base,
    disponible,
    id_proveedor,
    estado,
    created_by,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /// ✅ VALIDACIONES
    if (!nombre || !tipo_item || !precio_base || !id_proveedor || !created_by) {
      return res.status(400).json({
        error: 'Campos obligatorios faltantes',
      });
    }

    /// ✅ VALIDAR JSON
    let specsParsed = null;
    if (especificaciones) {
      try {
        specsParsed =
          typeof especificaciones === 'string'
            ? JSON.parse(especificaciones)
            : especificaciones;
      } catch (e) {
        return res.status(400).json({
          error: 'especificaciones debe ser un JSON válido',
        });
      }
    }

    /// ✅ INSERT
    const result = await client.query(
      `
      INSERT INTO item_catalogo (
        tipo_item,
        nombre,
        descripcion,
        especificaciones,
        precio_base,
        disponible,
        id_proveedor,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        NOW(), NULL, $9, NULL
      )
      RETURNING *
      `,
      [
        tipo_item,
        nombre,
        descripcion || null,
        specsParsed,
        precio_base,
        disponible ?? true,
        id_proveedor,
        estado || 'activo',
        created_by,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Item creado correctamente',
      item: result.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error createItem:', err);

    return res.status(500).json({
      error: 'Error al crear item',
    });
  } finally {
    client.release();
  }
}


async function getItemsMyCatalog(req, res) {
  const idUsuario = req.user.id_usuario;

  try {
    const proveedorResult = await pool.query(
      `SELECT id_proveedor FROM proveedor WHERE id_usuario = $1`,
      [idUsuario]
    );

    const idProveedor = proveedorResult.rows[0]?.id_proveedor;

    if (!idProveedor) {
      return res.status(404).json({
        error: 'Proveedor no encontrado',
      });
    }

    const result = await pool.query(
      `
      SELECT
        i.*,

        -- ✅ IMÁGENES
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id_archivo', ar.id_archivo,
                'nombre_original', ar.nombre_original,
                'nombre_fisico', ar.nombre_fisico,
                'extension', ar.extension,
                'mime', ar.mime,
                'ubicacion', ar.ubicacion
              )
            )
            FROM item_catalogo_archivo ia
            LEFT JOIN archivo ar
              ON ar.id_archivo = ia.id_archivo
            WHERE ia.id_item_catalogo = i.id_item
          ),
          '[]'::jsonb
        ) AS imagenes

      FROM item_catalogo i
      WHERE i.id_proveedor = $1
      ORDER BY i.created_at DESC
      `,
      [idProveedor]
    );

    return res.json({ items: result.rows });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: 'Error al obtener catálogo',
    });
  }
}

async function getItemById(req, res) {
  const idItem = Number(req.params.id);

  try {
    // ✅ validar ID
    if (Number.isNaN(idItem)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    // ✅ consulta
    const result = await pool.query(
  `
  SELECT
    i.id_item,
    i.tipo_item,
    i.nombre,
    i.descripcion,
    i.especificaciones,
    i.precio_base,
    i.disponible,
    i.id_proveedor,
    i.estado,
    i.created_at,
    i.updated_at,
    i.created_by,
    i.updated_by,

    -- ✅ IMÁGENES DEL ITEM
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id_archivo', ar.id_archivo,
            'nombre_original', ar.nombre_original,
            'nombre_fisico', ar.nombre_fisico,
            'extension', ar.extension,
            'mime', ar.mime,
            'ubicacion', ar.ubicacion
          )
        )
        FROM item_catalogo_archivo ia
        LEFT JOIN archivo ar
          ON ar.id_archivo = ia.id_archivo
        WHERE ia.id_item_catalogo = i.id_item
      ),
      '[]'::jsonb
    ) AS imagenes

  FROM item_catalogo i
  WHERE i.id_item = $1
  `,
  [idItem]
);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Item no encontrado',
      });
    }

    return res.status(200).json({
      item: result.rows[0],
    });

  } catch (err) {
    console.error('Error al obtener item:', err);

    return res.status(500).json({
      error: 'Error interno al obtener item',
    });
  }
}

async function updateItem(req, res) {
  const idItem = Number(req.params.id);

  const {
    tipo_item,
    nombre,
    descripcion,
    especificaciones,
    precio_base,
    disponible,
    estado,
    id_proveedor,
    updated_by,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ validar ID
    if (Number.isNaN(idItem)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // ✅ validar existencia
    const exists = await client.query(
      `SELECT id_item FROM item_catalogo WHERE id_item = $1`,
      [idItem]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Item no encontrado',
      });
    }

    /// ✅ VALIDAR JSON
    let specsParsed = undefined;

    if (especificaciones !== undefined) {
      try {
        specsParsed =
          typeof especificaciones === 'string'
            ? JSON.parse(especificaciones)
            : especificaciones;
      } catch (e) {
        return res.status(400).json({
          error: 'especificaciones debe ser un JSON válido',
        });
      }
    }

    /// ✅ UPDATE DINÁMICO
    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    if (tipo_item !== undefined) add('tipo_item', tipo_item);
    if (nombre !== undefined) add('nombre', nombre);
    if (descripcion !== undefined) add('descripcion', descripcion || null);
    if (specsParsed !== undefined) add('especificaciones', specsParsed);
    if (precio_base !== undefined) add('precio_base', precio_base);
    if (disponible !== undefined) add('disponible', disponible);
    if (estado !== undefined) add('estado', estado);
    if (id_proveedor !== undefined) add('id_proveedor', id_proveedor);

    // ✅ auditoría SIEMPRE
    add('updated_by', updated_by);
    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await client.query(
      `
      UPDATE item_catalogo
      SET ${fields.join(', ')}
      WHERE id_item = $${index}
      RETURNING *
      `,
      [...values, idItem]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Item actualizado correctamente',
      item: result.rows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updateItem:', err);

    return res.status(500).json({
      error: 'Error al actualizar item',
    });
  } finally {
    client.release();
  }
}

async function uploadImagenItem(req, res) {
  const {
    id_item_catalogo,
    created_by
  } = req.body;

  try {
    // ✅ 1. Validaciones
    if (!req.file) {
      return res.status(400).json({
        error: 'La imagen es obligatoria',
      });
    }

    if (!id_item_catalogo || !created_by) {
      return res.status(400).json({
        error: 'id_item_catalogo y created_by son obligatorios',
      });
    }

    // ✅ 2. Verificar item (CORRECTO)
    const itemExists = await pool.query(
      'SELECT id_item FROM item_catalogo WHERE id_item = $1',
      [id_item_catalogo] 
    );

    if (itemExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Item no encontrado',
      });
    }

    const file = req.file;

    const extension = path.extname(file.originalname).replace('.', '');

    // ✅ 3. Guardar archivo
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
      VALUES ($1,$2,$3,$4,$5,'activo',NOW(),NULL,$6,NULL)
      RETURNING id_archivo, nombre_original, nombre_fisico, ubicacion
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

    const archivo = archivoResult.rows[0];

    // ✅ 4. Relación CORRECTA
    await pool.query(
      `
      INSERT INTO item_catalogo_archivo (
        id_item_catalogo,
        id_archivo
      )
      VALUES ($1,$2)
      `,
      [
        id_item_catalogo,
        archivo.id_archivo
      ]
    );

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


async function deleteImagenItem(req, res) {
  const { id_archivo } = req.params;

  try {
    // 1️⃣ Validar
    if (!id_archivo) {
      return res.status(400).json({
        error: 'id_archivo es obligatorio',
      });
    }

    // 2️⃣ Obtener archivo
    const archivoResult = await pool.query(
      'SELECT * FROM archivo WHERE id_archivo = $1',
      [id_archivo]
    );

    if (archivoResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Archivo no encontrado',
      });
    }

    const archivo = archivoResult.rows[0];

    // ✅ Ruta física
    const filePath = path.join(__dirname, '..', archivo.ubicacion);

    // 3️⃣ Eliminar relaciones
    await pool.query(
      'DELETE FROM item_catalogo_archivo WHERE id_archivo = $1',
      [id_archivo]
    );

    // 4️⃣ Eliminar registro archivo
    await pool.query(
      'DELETE FROM archivo WHERE id_archivo = $1',
      [id_archivo]
    );

    // 5️⃣ Eliminar archivo físico (si existe)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 6️⃣ Respuesta
    return res.status(200).json({
      message: 'Imagen eliminada correctamente',
    });

  } catch (err) {
    console.error('Error al eliminar imagen:', err);

    return res.status(500).json({
      error: 'Error interno al eliminar imagen',
    });
  }
}

async function obtenerProductosLaPipa(
  req,
  res
) {

  try {

    const products =
      await syncLaPipa();

    return res.status(200).json({

      total_productos:
        products.length,

      productos: products,

      sincronizados: true,

    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });

  }

}

async function syncCatalogProducts(
  products,
  idProveedor,
  updatedBy,
  {
    permitirDesactivacion =
      true,
  } = {},
) {

  if (
    !Array.isArray(
      products
    ) ||
    products.length === 0
  ) {

    throw new Error(
      'La fuente no devolvió productos. ' +
      'La sincronización fue cancelada para proteger el catálogo.',
    );

  }


  const normalizedProducts =
    products.filter(
      product =>
        product &&
        product.url &&
        product.nombre,
    );


  if (
    normalizedProducts.length ===
    0
  ) {

    throw new Error(
      'La fuente no devolvió productos válidos.',
    );

  }


  const client =
    await pool.connect();


  const report = {

    encontrados:
      normalizedProducts.length,

    creados:
      0,

    actualizados:
      0,

    sin_cambios:
      0,

    desactivados:
      0,

    desactivacion_omitida:
      !permitirDesactivacion,

  };


  try {

    await client.query(
      'BEGIN'
    );


    const urlsCatalogo = [
      ...new Set(
        normalizedProducts.map(
          product =>
            product.url
              .toString()
              .trim(),
        ),
      ),
    ];


    const currentResult =
      await client.query(
        `
        SELECT
          url_origen

        FROM item_catalogo

        WHERE
          id_proveedor = $1

          AND url_origen =
            ANY(
              $2::text[]
            )
        `,
        [
          idProveedor,
          urlsCatalogo,
        ],
      );


    const existingUrls =
      new Set(
        currentResult
          .rows
          .map(
            row =>
              row.url_origen,
          ),
      );


    for (
      const product
      of normalizedProducts
    ) {

      const productUrl =
        product.url
          .toString()
          .trim();


      const existedBefore =
        existingUrls.has(
          productUrl
        );


      /*
       * Cuando Power Automate falla para un
       * producto ya existente, conservamos
       * descripción y especificaciones previas.
       */
      const preservarEnriquecimiento =
        product
          .preservar_enriquecimiento ===
        true;


      const upsertResult =
        await client.query(
          `
          INSERT INTO item_catalogo (
            tipo_item,
            nombre,
            descripcion,
            especificaciones,
            precio_base,
            disponible,
            id_proveedor,
            estado,
            url_origen,
            created_at,
            created_by
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            'activo',
            $8,
            NOW(),
            $9
          )


          ON CONFLICT (
            url_origen
          )

          DO UPDATE SET

            tipo_item =
              EXCLUDED.tipo_item,

            nombre =
              EXCLUDED.nombre,

            descripcion =
              CASE

                WHEN $10::boolean
                THEN
                  item_catalogo
                    .descripcion

                ELSE
                  EXCLUDED.descripcion

              END,

            especificaciones =
              CASE

                WHEN $10::boolean
                THEN
                  item_catalogo
                    .especificaciones

                ELSE
                  EXCLUDED
                    .especificaciones

              END,

            precio_base =
              EXCLUDED.precio_base,

            disponible =
              EXCLUDED.disponible,

            estado =
              'activo',

            id_proveedor =
              EXCLUDED.id_proveedor,

            updated_at =
              NOW(),

            updated_by =
              EXCLUDED.created_by


          WHERE

            item_catalogo
              .tipo_item
              IS DISTINCT FROM
              EXCLUDED.tipo_item

            OR item_catalogo
              .nombre
              IS DISTINCT FROM
              EXCLUDED.nombre

            OR (
              NOT $10::boolean

              AND item_catalogo
                .descripcion
                IS DISTINCT FROM
                EXCLUDED.descripcion
            )

            OR (
              NOT $10::boolean

              OR item_catalogo.especificaciones::jsonb
                IS DISTINCT FROM
                EXCLUDED.especificaciones::jsonb
            )

            OR item_catalogo
              .precio_base
              IS DISTINCT FROM
              EXCLUDED.precio_base

            OR item_catalogo
              .disponible
              IS DISTINCT FROM
              EXCLUDED.disponible

            OR item_catalogo
              .estado
              IS DISTINCT FROM
              'activo'

            OR item_catalogo
              .id_proveedor
              IS DISTINCT FROM
              EXCLUDED.id_proveedor


          RETURNING
            id_item
          `,
          [
            product.categoria ||
              product.tipo_item ||
              'Sin categoría',

            product.nombre,

            product.descripcion ||
              null,

            product.especificaciones ||
              null,

            product.precio ??
              product.precio_base ??
              0,

            product.disponible ??
              true,

            idProveedor,

            productUrl,

            updatedBy,

            preservarEnriquecimiento,
          ],
        );


      if (
        !existedBefore
      ) {

        report.creados++;

      } else if (
        upsertResult.rowCount >
        0
      ) {

        report.actualizados++;

      } else {

        report.sin_cambios++;

      }

    }


    /*
     * Solo desactivamos productos cuando
     * sabemos que la extracción fue completa.
     */
    if (
      permitirDesactivacion
    ) {

      const inactiveResult =
        await client.query(
          `
          UPDATE item_catalogo

          SET
            disponible = false,
            updated_at = NOW(),
            updated_by = $3

          WHERE
            id_proveedor = $1

            AND url_origen
              IS NOT NULL

            AND disponible =
              true

            AND NOT (
              url_origen =
                ANY(
                  $2::text[]
                )
            )

          RETURNING
            id_item
          `,
          [
            idProveedor,
            urlsCatalogo,
            updatedBy,
          ],
        );


      report.desactivados =
        inactiveResult.rowCount;

    } else {

      console.warn(
        `Se omite la desactivación automática del proveedor ${idProveedor} ` +
        'porque la extracción presentó errores.'
      );

    }


    await client.query(
      'COMMIT'
    );


    return report;

  } catch (error) {

    await client.query(
      'ROLLBACK'
    );

    throw error;

  } finally {

    client.release();

  }

}

async function syncLaPipa() {

  /*
   * Toda salida de consola producida aquí
   * quedará marcada como EXTRACCION.
   */
  let products =
    await withSyncStage(
      'EXTRACCION',
      () =>
        extractCatalogLaPipa(),
    );


  /*
   * Si hubo errores de categoría o producto,
   * no podemos asumir que el catálogo recibido
   * representa el 100 % del proveedor.
   */
  const extractionStats =
    getSyncLogStats();


  products =
    removeDuplicates(
      products,
    );


  console.log(
    `La Pipa: ${products.length} productos únicos obtenidos`
  );


  const report =
    await withSyncStage(
      'BASE_DATOS',
      () =>
        syncCatalogProducts(
          products,
          5,
          1,
          {
            permitirDesactivacion:
              extractionStats
                .errors === 0,
          },
        ),
    );


  const finalStats =
    getSyncLogStats();


  return {

    id_proveedor:
      5,

    proveedor:
      'La Pipa',

    estado_fuente:
      finalStats.errors >
      0
        ? 'parcial'
        : 'completada',

    errores_detectados:
      finalStats.errors,

    advertencias_detectadas:
      finalStats.warnings,

    ...report,

  };

}

async function syncComercialCaldas() {

  /*
   * =======================================================
   * 1. EXTRACCIÓN
   * =======================================================
   */

  let products =
    await withSyncStage(
      'EXTRACCION',
      () =>
        extractCatalogComercialCaldas(),
    );


  /*
   * Guardamos el estado inmediatamente después
   * de la extracción. Los errores posteriores de
   * Power Automate no deben decidir si podemos
   * desactivar productos desaparecidos.
   */
  const extractionStats =
    getSyncLogStats();


  products =
    removeDuplicates(
      products,
    );


  console.log(
    `Productos encontrados: ${products.length}`
  );


  const productsConPdf =
    products.filter(
      producto =>
        producto.pdfContenido &&
        producto.pdfContenido.length >
        0
    );


  console.log(
    `Productos con PDF: ${productsConPdf.length}`
  );


  /*
   * =======================================================
   * 2. POWER AUTOMATE
   * =======================================================
   */

  let especificacionesPorUrl =
    new Map();


  if (
    productsConPdf.length >
    0
  ) {

    especificacionesPorUrl =
      await withSyncStage(
        'POWER_AUTOMATE',

        () =>
          procesarFichasPorLotesAPowerAutomate(
            productsConPdf,
            10
          ),
      );

  } else {

    console.warn(
      'No se encontraron productos con PDF. Se omite Power Automate.'
    );

  }


  /*
   * Ya NO detenemos todo el proveedor.
   */
  if (
    productsConPdf.length >
      0 &&
    especificacionesPorUrl.size ===
      0
  ) {

    console.error(
      'Power Automate no devolvió especificaciones para ningún producto. ' +
      'Se conservará la información existente y continuará la sincronización.'
    );

  } else if (
    especificacionesPorUrl.size !==
    productsConPdf.length
  ) {

    console.error(
      'Power Automate procesó parcialmente las fichas. ' +
      `Esperadas: ${productsConPdf.length}. ` +
      `Recibidas: ${especificacionesPorUrl.size}.`
    );

  }


  /*
   * =======================================================
   * 3. COMBINAR RESULTADOS
   * =======================================================
   */

  const productsConSpecs =
    products.map(
      producto => {

        const datosIA =
          especificacionesPorUrl.get(
            producto.url
          );


        /*
         * Si Power Automate no devolvió
         * información para este producto,
         * NO debemos borrar especificaciones
         * que ya existieran en PostgreSQL.
         */
        if (!datosIA) {

          return {

            ...producto,

            descripcion:
              producto.descripcion ||
              null,

            especificaciones:
              null,

            preservar_enriquecimiento:
              true,

          };

        }


        const {
          descripcion,
          Descripcion,
          NombreArchivo,
          nombreArchivo,
          Referencia,
          referencia,
          url,
          ...especificaciones
        } = datosIA;


        const descripcionFinal =
          descripcion ??
          Descripcion ??
          producto.descripcion ??
          '';


        const especificacionesLimpias =
          Object.fromEntries(
            Object.entries(
              especificaciones
            ).filter(
              ([, value]) =>
                value !== null &&
                value !== undefined &&
                value !== ''
            )
          );


        return {

          ...producto,

          descripcion:
            descripcionFinal,

          especificaciones:
            Object.keys(
              especificacionesLimpias
            ).length >
            0
              ? especificacionesLimpias
              : null,

          preservar_enriquecimiento:
            false,

        };

      }
    );


  const productosConEspecificaciones =
    productsConSpecs.filter(
      producto =>
        producto.especificaciones !==
        null
    ).length;


  console.log(
    'Productos con especificaciones listas para guardar:',
    productosConEspecificaciones
  );


  /*
   * =======================================================
   * 4. BASE DE DATOS
   * =======================================================
   */

  const report =
    await withSyncStage(
      'BASE_DATOS',

      () =>
        syncCatalogProducts(
          productsConSpecs,
          6,
          1,
          {
            /*
             * Solo depende de la integridad
             * del crawler, no de Power Automate.
             */
            permitirDesactivacion:
              extractionStats
                .errors === 0,
          },
        ),
    );


  const finalStats =
    getSyncLogStats();


  return {

    id_proveedor:
      6,

    proveedor:
      'Comercial Caldas',

    estado_fuente:
      finalStats.errors >
      0
        ? 'parcial'
        : 'completada',

    errores_detectados:
      finalStats.errors,

    advertencias_detectadas:
      finalStats.warnings,

    productos_con_pdf:
      productsConPdf.length,

    productos_con_especificaciones:
      productosConEspecificaciones,

    ...report,

  };

}

async function ejecutarFuenteSegura(
  source,
  idSincronizacion,
) {

  return runWithSyncLogContext(
    {
      idSincronizacion,

      idProveedor:
        source.idProveedor,

      proveedor:
        source.nombre,

      etapa:
        'PROVEEDOR',
    },

    async () => {

      const sourceStartedAt =
        new Date();


      console.log(
        `===== INICIO ${source.nombre} =====`
      );


      try {

        /*
         * Aunque esta función lance una excepción,
         * ejecutarFuenteSegura la absorbe y devuelve
         * un reporte. Nunca rompe la siguiente fuente.
         */
        const result =
          await source.execute();


        const sourceFinishedAt =
          new Date();


        const {
          estado_fuente,
          ...resultData
        } =
          result;


        const status =
          estado_fuente ||
          'completada';


        console.log(
          `===== FIN ${source.nombre} · ${status} =====`
        );


        return {

          ...resultData,

          estado:
            status,

          inicio:
            sourceStartedAt
              .toISOString(),

          fin:
            sourceFinishedAt
              .toISOString(),

          duracion_segundos:
            Math.round(
              (
                sourceFinishedAt -
                sourceStartedAt
              ) /
              1000,
            ),

          error:
            null,

        };

      } catch (error) {

        const sourceFinishedAt =
          new Date();


        console.error(
          `Error sincronizando ${source.nombre}:`,
          error
        );


        console.warn(
          `La ejecución continuará con las demás fuentes aunque ${source.nombre} haya fallado.`
        );


        return {

          id_proveedor:
            source.idProveedor,

          proveedor:
            source.nombre,

          estado:
            'fallida',

          encontrados:
            0,

          creados:
            0,

          actualizados:
            0,

          sin_cambios:
            0,

          desactivados:
            0,

          inicio:
            sourceStartedAt
              .toISOString(),

          fin:
            sourceFinishedAt
              .toISOString(),

          duracion_segundos:
            Math.round(
              (
                sourceFinishedAt -
                sourceStartedAt
              ) /
              1000,
            ),

          error:
            error.message ||
            'Error desconocido',

        };

      }

    },
  );

}


async function ejecutarSincronizacionCatalogos(
  idSincronizacion = null,
) {

  const startedAt =
    new Date();


  const sources = [

    {
      idProveedor:
        5,

      nombre:
        'La Pipa',

      execute:
        syncLaPipa,
    },

    {
      idProveedor:
        6,

      nombre:
        'Comercial Caldas',

      execute:
        syncComercialCaldas,
    },

  ];


  const reports = [];


  /*
   * Se mantienen secuenciales para no ejecutar
   * dos navegadores pesados simultáneamente,
   * pero cada proveedor es completamente aislado.
   */
  for (
    const source
    of sources
  ) {

    const report =
      await ejecutarFuenteSegura(
        source,
        idSincronizacion,
      );


    reports.push(
      report,
    );

  }


  const finishedAt =
    new Date();


  const failedSources =
    reports.filter(
      report =>
        report.estado ===
        'fallida',
    ).length;


  const partialSources =
    reports.filter(
      report =>
        report.estado ===
        'parcial',
    ).length;


  const completedSources =
    reports.filter(
      report =>
        report.estado ===
        'completada',
    ).length;


  let status =
    'completada';


  if (
    failedSources ===
    reports.length
  ) {

    status =
      'fallida';

  } else if (
    failedSources >
      0 ||
    partialSources >
      0
  ) {

    status =
      'completada_con_errores';

  }


  const sum =
    key =>
      reports.reduce(
        (
          total,
          report,
        ) =>
          total +
          Number(
            report[key] ??
            0
          ),
        0,
      );


  return {

    estado:
      status,

    inicio:
      startedAt.toISOString(),

    fin:
      finishedAt.toISOString(),

    duracion_segundos:
      Math.round(
        (
          finishedAt -
          startedAt
        ) /
        1000,
      ),

    total_fuentes:
      reports.length,

    /*
     * Compatibilidad con el reporte anterior.
     * Parcial sigue significando que la fuente
     * produjo información utilizable.
     */
    fuentes_exitosas:
      completedSources +
      partialSources,

    fuentes_completas:
      completedSources,

    fuentes_parciales:
      partialSources,

    fuentes_fallidas:
      failedSources,

    resumen: {

      encontrados:
        sum(
          'encontrados'
        ),

      creados:
        sum(
          'creados'
        ),

      actualizados:
        sum(
          'actualizados'
        ),

      sin_cambios:
        sum(
          'sin_cambios'
        ),

      desactivados:
        sum(
          'desactivados'
        ),

    },

    proveedores:
      reports,

  };

}


async function ejecutarSincronizacionCatalogos(
  idSincronizacion = null,
) {

  const startedAt =
    new Date();


  const sources = [

    {
      idProveedor:
        5,

      nombre:
        'La Pipa',

      execute:
        syncLaPipa,
    },

    {
      idProveedor:
        6,

      nombre:
        'Comercial Caldas',

      execute:
        syncComercialCaldas,
    },

  ];


  const reports = [];


  /*
   * Se mantienen secuenciales para no ejecutar
   * dos navegadores pesados simultáneamente,
   * pero cada proveedor es completamente aislado.
   */
  for (
    const source
    of sources
  ) {

    const report =
      await ejecutarFuenteSegura(
        source,
        idSincronizacion,
      );


    reports.push(
      report,
    );

  }


  const finishedAt =
    new Date();


  const failedSources =
    reports.filter(
      report =>
        report.estado ===
        'fallida',
    ).length;


  const partialSources =
    reports.filter(
      report =>
        report.estado ===
        'parcial',
    ).length;


  const completedSources =
    reports.filter(
      report =>
        report.estado ===
        'completada',
    ).length;


  let status =
    'completada';


  if (
    failedSources ===
    reports.length
  ) {

    status =
      'fallida';

  } else if (
    failedSources >
      0 ||
    partialSources >
      0
  ) {

    status =
      'completada_con_errores';

  }


  const sum =
    key =>
      reports.reduce(
        (
          total,
          report,
        ) =>
          total +
          Number(
            report[key] ??
            0
          ),
        0,
      );


  return {

    estado:
      status,

    inicio:
      startedAt.toISOString(),

    fin:
      finishedAt.toISOString(),

    duracion_segundos:
      Math.round(
        (
          finishedAt -
          startedAt
        ) /
        1000,
      ),

    total_fuentes:
      reports.length,

    /*
     * Compatibilidad con el reporte anterior.
     * Parcial sigue significando que la fuente
     * produjo información utilizable.
     */
    fuentes_exitosas:
      completedSources +
      partialSources,

    fuentes_completas:
      completedSources,

    fuentes_parciales:
      partialSources,

    fuentes_fallidas:
      failedSources,

    resumen: {

      encontrados:
        sum(
          'encontrados'
        ),

      creados:
        sum(
          'creados'
        ),

      actualizados:
        sum(
          'actualizados'
        ),

      sin_cambios:
        sum(
          'sin_cambios'
        ),

      desactivados:
        sum(
          'desactivados'
        ),

    },

    proveedores:
      reports,

  };

}

async function crearEjecucionSincronizacion({
  origen,
  solicitadoPor = null,
}) {
  /*
   * Si el servidor se detuvo durante una
   * ejecución, esta no debe bloquear todas
   * las sincronizaciones futuras.
   */
  await pool.query(
    `
    UPDATE catalogo_sincronizacion

    SET
      estado = 'fallida',
      fin = NOW(),
      updated_at = NOW(),
      error = COALESCE(
        error,
        'La ejecución fue interrumpida'
      )

    WHERE estado IN (
      'pendiente',
      'procesando'
    )
      AND created_at <
        NOW() - INTERVAL '6 hours'
    `,
  );

  try {
    const result =
      await pool.query(
        `
        INSERT INTO
          catalogo_sincronizacion (
            origen,
            estado,
            solicitado_por,
            created_at
          )
        VALUES (
          $1,
          'pendiente',
          $2,
          NOW()
        )

        RETURNING
          id_sincronizacion,
          origen,
          estado,
          solicitado_por,
          created_at
        `,
        [
          origen,
          solicitadoPor,
        ],
      );

    return {
      creada: true,
      ejecucion:
        result.rows[0],
    };
  } catch (error) {
    /*
     * 23505 corresponde a una violación
     * de índice único en PostgreSQL.
     */
    if (
      error.code ===
      '23505'
    ) {
      const activeResult =
        await pool.query(
          `
          SELECT
            id_sincronizacion,
            origen,
            estado,
            solicitado_por,
            inicio,
            created_at,
            updated_at

          FROM catalogo_sincronizacion

          WHERE estado IN (
            'pendiente',
            'procesando'
          )

          ORDER BY
            created_at DESC

          LIMIT 1
          `,
        );

      return {
        creada: false,
        ejecucion:
          activeResult.rows[0] ??
          null,
      };
    }

    throw error;
  }
}

async function procesarEjecucionSincronizacion(
  idSincronizacion,
) {

  return runWithSyncLogContext(
    {
      idSincronizacion,

      proveedor:
        null,

      idProveedor:
        null,

      etapa:
        'SINCRONIZACION',
    },

    async () => {

      try {

        await pool.query(
          `
          UPDATE catalogo_sincronizacion

          SET
            estado = 'procesando',
            inicio = NOW(),
            updated_at = NOW(),
            error = NULL

          WHERE
            id_sincronizacion = $1
          `,
          [
            idSincronizacion,
          ],
        );


        console.log(
          `Iniciando sincronización #${idSincronizacion}`
        );


        const report =
          await ejecutarSincronizacionCatalogos(
            idSincronizacion,
          );


        await pool.query(
          `
          UPDATE catalogo_sincronizacion

          SET
            estado = $2,
            reporte = $3::jsonb,
            fin = NOW(),
            updated_at = NOW(),
            error = NULL

          WHERE
            id_sincronizacion = $1
          `,
          [
            idSincronizacion,

            report.estado,

            JSON.stringify(
              report,
            ),
          ],
        );


        console.log(
          `Sincronización #${idSincronizacion} finalizada con estado ${report.estado}`
        );


        return report;

      } catch (error) {

        console.error(
          `Error general procesando sincronización #${idSincronizacion}:`,
          error
        );


        await pool.query(
          `
          UPDATE catalogo_sincronizacion

          SET
            estado = 'fallida',
            fin = NOW(),
            updated_at = NOW(),
            error = $2

          WHERE
            id_sincronizacion = $1
          `,
          [
            idSincronizacion,

            error.message ||
              'Error desconocido',
          ],
        );


        throw error;

      }

    },
  );

}

async function iniciarSincronizacionAutomatica() {
  const creation =
    await crearEjecucionSincronizacion({
      origen:
        'automatico',

      solicitadoPor:
        null,
    });

  if (!creation.creada) {
    console.log(
      'La sincronización automática no se inició ' +
      'porque ya existe una ejecución activa.',
    );

    return {
      omitida: true,
      ejecucion:
        creation.ejecucion,
    };
  }

  const idSincronizacion =
    creation
      .ejecucion
      .id_sincronizacion;

  const report =
    await procesarEjecucionSincronizacion(
      idSincronizacion,
    );

  return {
    omitida: false,
    id_sincronizacion:
      idSincronizacion,
    reporte:
      report,
  };
}

async function iniciarSincronizacionManual(
  req,
  res,
) {
  try {
    const userId =
      req.user?.id_usuario ??
      null;

    const creation =
      await crearEjecucionSincronizacion({
        origen:
          'manual',

        solicitadoPor:
          userId,
      });

    if (!creation.creada) {
      return res.status(409).json({
        error:
          'Ya existe una sincronización en curso',

        sincronizacion:
          creation.ejecucion,
      });
    }

    const execution =
      creation.ejecucion;

    /*
     * La respuesta no espera al crawler.
     * El proceso continúa en segundo plano.
     */
    setImmediate(
      async () => {
        try {
          await procesarEjecucionSincronizacion(
            execution
              .id_sincronizacion,
          );
        } catch (error) {
          /*
           * El error ya quedó almacenado
           * en catalogo_sincronizacion.
           */
          console.error(
            'Sincronización manual fallida:',
            error,
          );
        }
      },
    );

    return res.status(202).json({
      message:
        'La sincronización fue iniciada',

      sincronizacion: {
        id_sincronizacion:
          execution
            .id_sincronizacion,

        origen:
          execution.origen,

        estado:
          execution.estado,

        created_at:
          execution.created_at,
      },
    });
  } catch (error) {
    console.error(
      'Error iniciando sincronización:',
      error,
    );

    return res.status(500).json({
      error:
        'No fue posible iniciar la sincronización',
    });
  }
}

async function getSincronizacionById(
  req,
  res,
) {
  const idSincronizacion =
    Number.parseInt(
      req.params.id,
      10,
    );

  if (
    Number.isNaN(
      idSincronizacion,
    ) ||
    idSincronizacion <= 0
  ) {
    return res.status(400).json({
      error:
        'El id de sincronización no es válido',
    });
  }

  try {
    const result =
      await pool.query(
        `
        SELECT
          cs.id_sincronizacion,
          cs.origen,
          cs.estado,
          cs.solicitado_por,
          cs.inicio,
          cs.fin,
          cs.reporte,
          cs.error,
          cs.created_at,
          cs.updated_at,

          u.nombre_usuario
            AS solicitado_por_nombre,

          u.email
            AS solicitado_por_email

        FROM catalogo_sincronizacion cs

        LEFT JOIN usuario u
          ON u.id_usuario =
            cs.solicitado_por

        WHERE
          cs.id_sincronizacion =
            $1
        `,
        [
          idSincronizacion,
        ],
      );

    if (
      result.rows.length === 0
    ) {
      return res.status(404).json({
        error:
          'Sincronización no encontrada',
      });
    }

    return res.status(200).json({
      sincronizacion:
        result.rows[0],
    });
  } catch (error) {
    console.error(
      'Error consultando sincronización:',
      error,
    );

    return res.status(500).json({
      error:
        'Error al consultar la sincronización',
    });
  }
}

async function getHistorialSincronizaciones(
  req,
  res,
) {
  const requestedLimit =
    Number.parseInt(
      req.query.limite,
      10,
    );

  const limit =
    Math.min(
      Math.max(
        requestedLimit || 20,
        1,
      ),
      100,
    );

  try {
    const result =
      await pool.query(
        `
        SELECT
          cs.id_sincronizacion,
          cs.origen,
          cs.estado,
          cs.solicitado_por,
          cs.inicio,
          cs.fin,
          cs.reporte,
          cs.error,
          cs.created_at,
          cs.updated_at,

          u.nombre_usuario
            AS solicitado_por_nombre

        FROM catalogo_sincronizacion cs

        LEFT JOIN usuario u
          ON u.id_usuario =
            cs.solicitado_por

        ORDER BY
          cs.created_at DESC

        LIMIT $1
        `,
        [
          limit,
        ],
      );

    return res.status(200).json({
      sincronizaciones:
        result.rows,
    });
  } catch (error) {
    console.error(
      'Error consultando historial:',
      error,
    );

    return res.status(500).json({
      error:
        'Error al consultar el historial',
    });
  }
}

async function syncTodosLosCatalogos(
  req,
  res,
) {
  try {
    const report =
      await ejecutarSincronizacionCatalogos();

    return res.status(200).json({
      message:
        report.estado ===
        'completada'
          ? 'Catálogos sincronizados correctamente'
          : 'La sincronización terminó con novedades',

      sincronizacion:
        report,
    });
  } catch (error) {
    console.error(
      'Error syncTodosLosCatalogos:',
      error,
    );

    return res.status(500).json({
      error:
        error.message ||
        'Error al sincronizar los catálogos',
    });
  }
}

/**
 * GET /api/catalogo/admin
 *
 * Consulta administrativa del catálogo almacenado.
 * Esta función NO ejecuta crawlers.
 */
async function getCatalogoAdmin(
  req,
  res
) {
  try {
    const {
      buscar,
      id_proveedor,
      tipo_item,
      estado,
      disponible,
      pagina = '1',
      limite = '24',
    } = req.query;

    const pageNumber =
      Math.max(
        Number.parseInt(
          pagina,
          10,
        ) || 1,
        1,
      );

    const limitNumber =
      Math.min(
        Math.max(
          Number.parseInt(
            limite,
            10,
          ) || 24,
          1,
        ),
        100,
      );

    const offset =
      (pageNumber - 1) *
      limitNumber;

    const conditions = [];
    const values = [];

    const addCondition = (
      expression,
      value,
    ) => {
      values.push(value);

      conditions.push(
        expression.replace(
          '?',
          `$${values.length}`,
        ),
      );
    };

    /*
     * Búsqueda general.
     */
    if (
      buscar &&
      buscar.toString().trim()
    ) {
      addCondition(
        `
        (
          i.nombre ILIKE ?
          OR COALESCE(
            i.descripcion,
            ''
          ) ILIKE ?
          OR COALESCE(
            p.razon_social,
            ''
          ) ILIKE ?
          OR COALESCE(
            p.nit,
            ''
          ) ILIKE ?
        )
        `,
        `%${buscar.toString().trim()}%`,
      );

      /*
       * La condición anterior necesita el mismo
       * valor en cuatro posiciones diferentes.
       */
      const searchValue =
        `%${buscar.toString().trim()}%`;

      values.push(
        searchValue,
        searchValue,
        searchValue,
      );

      const lastCondition =
        conditions.length - 1;

      conditions[lastCondition] =
        conditions[lastCondition]
          .replace(
            '?',
            `$${values.length - 2}`,
          )
          .replace(
            '?',
            `$${values.length - 1}`,
          )
          .replace(
            '?',
            `$${values.length}`,
          );
    }

    if (id_proveedor !== undefined) {
      const providerId =
        Number.parseInt(
          id_proveedor,
          10,
        );

      if (
        Number.isNaN(providerId) ||
        providerId <= 0
      ) {
        return res.status(400).json({
          error:
            'id_proveedor debe ser un número válido',
        });
      }

      addCondition(
        'i.id_proveedor = ?',
        providerId,
      );
    }

    if (
      tipo_item &&
      tipo_item.toString().trim()
    ) {
      addCondition(
        'LOWER(i.tipo_item) = LOWER(?)',
        tipo_item.toString().trim(),
      );
    }

    if (
      estado &&
      estado.toString().trim()
    ) {
      const normalizedState =
        estado
          .toString()
          .trim()
          .toLowerCase();

      if (
        ![
          'activo',
          'inactivo',
        ].includes(
          normalizedState,
        )
      ) {
        return res.status(400).json({
          error:
            'El estado debe ser activo o inactivo',
        });
      }

      addCondition(
        'LOWER(i.estado) = ?',
        normalizedState,
      );
    }

    if (disponible !== undefined) {
      const normalizedAvailable =
        disponible
          .toString()
          .trim()
          .toLowerCase();

      if (
        ![
          'true',
          'false',
        ].includes(
          normalizedAvailable,
        )
      ) {
        return res.status(400).json({
          error:
            'disponible debe ser true o false',
        });
      }

      addCondition(
        'i.disponible = ?',
        normalizedAvailable ===
          'true',
      );
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(
            ' AND ',
          )}`
        : '';

    /*
     * Resumen del catálogo aplicando
     * los mismos filtros.
     */
    const summaryResult =
      await pool.query(
        `
        SELECT
          COUNT(i.id_item)::int
            AS total_productos,

          COUNT(i.id_item)
            FILTER (
              WHERE i.disponible = true
            )::int
            AS disponibles,

          COUNT(i.id_item)
            FILTER (
              WHERE i.disponible = false
            )::int
            AS no_disponibles,

          COUNT(i.id_item)
            FILTER (
              WHERE LOWER(i.estado) =
                'activo'
            )::int
            AS activos,

          COUNT(i.id_item)
            FILTER (
              WHERE LOWER(i.estado) =
                'inactivo'
            )::int
            AS inactivos,

          COUNT(
            DISTINCT i.id_proveedor
          )::int
            AS total_proveedores

        FROM item_catalogo i

        LEFT JOIN proveedor p
          ON p.id_proveedor =
            i.id_proveedor

        ${whereClause}
        `,
        values,
      );

    /*
     * Total para la paginación.
     */
    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(i.id_item)::int
            AS total

        FROM item_catalogo i

        LEFT JOIN proveedor p
          ON p.id_proveedor =
            i.id_proveedor

        ${whereClause}
        `,
        values,
      );

    const listValues = [
      ...values,
      limitNumber,
      offset,
    ];

    const limitPosition =
      values.length + 1;

    const offsetPosition =
      values.length + 2;

    /*
     * Productos almacenados.
     */
    const productsResult =
      await pool.query(
        `
        SELECT
          i.id_item,
          i.tipo_item,
          i.nombre,
          i.descripcion,
          i.especificaciones,
          i.precio_base,
          i.disponible,
          i.estado,
          i.url_origen,
          i.created_at,
          i.updated_at,

          i.id_proveedor,

          p.razon_social
            AS nombre_proveedor,

          p.nit
            AS nit_proveedor,

          p.estado
            AS estado_proveedor,

          u.id_usuario
            AS id_usuario_proveedor,

          u.nombre_usuario
            AS usuario_proveedor,

          u.email
            AS email_proveedor,

          COALESCE(
            (
              SELECT
                jsonb_agg(
                  jsonb_build_object(
                    'id_archivo',
                      ar.id_archivo,

                    'nombre_original',
                      ar.nombre_original,

                    'nombre_fisico',
                      ar.nombre_fisico,

                    'extension',
                      ar.extension,

                    'mime',
                      ar.mime,

                    'ubicacion',
                      ar.ubicacion
                  )
                  ORDER BY
                    ar.id_archivo
                )

              FROM
                item_catalogo_archivo ia

              INNER JOIN archivo ar
                ON ar.id_archivo =
                  ia.id_archivo

              WHERE
                ia.id_item_catalogo =
                  i.id_item
            ),
            '[]'::jsonb
          ) AS imagenes

        FROM item_catalogo i

        LEFT JOIN proveedor p
          ON p.id_proveedor =
            i.id_proveedor

        LEFT JOIN usuario u
          ON u.id_usuario =
            p.id_usuario

        ${whereClause}

        ORDER BY
          COALESCE(
            i.updated_at,
            i.created_at
          ) DESC,
          i.id_item DESC

        LIMIT $${limitPosition}
        OFFSET $${offsetPosition}
        `,
        listValues,
      );

    const total =
      countResult.rows[0]?.total ??
      0;

    const totalPages =
      total === 0
        ? 0
        : Math.ceil(
            total /
              limitNumber,
          );

    return res.status(200).json({
      summary:
        summaryResult.rows[0] ?? {
          total_productos: 0,
          disponibles: 0,
          no_disponibles: 0,
          activos: 0,
          inactivos: 0,
          total_proveedores: 0,
        },

      pagination: {
        pagina:
          pageNumber,

        limite:
          limitNumber,

        total_registros:
          total,

        total_paginas:
          totalPages,

        tiene_anterior:
          pageNumber > 1,

        tiene_siguiente:
          pageNumber <
          totalPages,
      },

      productos:
        productsResult.rows,
    });
  } catch (error) {
    console.error(
      'Error getCatalogoAdmin:',
      error,
    );

    return res.status(500).json({
      error:
        'Error interno al consultar el catálogo',
    });
  }
}

async function getSincronizacionLogsById(
  req,
  res,
) {

  const idSincronizacion =
    Number.parseInt(
      req.params.id,
      10,
    );


  if (
    Number.isNaN(
      idSincronizacion,
    ) ||
    idSincronizacion <=
      0
  ) {

    return res.status(
      400
    ).json({
      error:
        'El id de sincronización no es válido',
    });

  }


  try {

    const syncResult =
      await pool.query(
        `
        SELECT
          id_sincronizacion

        FROM
          catalogo_sincronizacion

        WHERE
          id_sincronizacion =
          $1
        `,
        [
          idSincronizacion,
        ],
      );


    if (
      syncResult.rows.length ===
      0
    ) {

      return res.status(
        404
      ).json({
        error:
          'Sincronización no encontrada',
      });

    }


    const result =
      await pool.query(
        `
        SELECT
          id_log,
          id_sincronizacion,
          id_proveedor,
          proveedor,
          nivel,
          etapa,
          mensaje,
          detalle,
          created_at

        FROM
          catalogo_sincronizacion_log

        WHERE
          id_sincronizacion =
          $1

        ORDER BY
          created_at ASC,
          id_log ASC
        `,
        [
          idSincronizacion,
        ],
      );


    return res.status(
      200
    ).json({

      id_sincronizacion:
        idSincronizacion,

      total:
        result.rows.length,

      logs:
        result.rows,

    });

  } catch (error) {

    console.error(
      'Error consultando logs de sincronización:',
      error
    );


    return res.status(
      500
    ).json({
      error:
        'No fue posible consultar el registro técnico',
    });

  }

}

module.exports = {
  createItem,
  getItemsMyCatalog,
  getItemById,
  getCatalogoAdmin,
  updateItem,
  uploadImagenItem,
  deleteImagenItem,
  obtenerProductosLaPipa,

  ejecutarSincronizacionCatalogos,
  iniciarSincronizacionAutomatica,
  iniciarSincronizacionManual,
  getSincronizacionById,
  getHistorialSincronizaciones,
  getSincronizacionLogsById,

  syncTodosLosCatalogos,
  syncComercialCaldas,
};