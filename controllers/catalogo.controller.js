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
  createdBy
) {

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    const urlsCatalogo =
      products.map(
        p => p.url
      );

    for (const product of products) {

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
          $1,$2,$3,$4,$5,$6,$7,
          'activo',
          $8,
          NOW(),
          $9
        )
        ON CONFLICT (url_origen)
        DO UPDATE SET
          nombre = EXCLUDED.nombre,
          descripcion = EXCLUDED.descripcion,
          especificaciones = EXCLUDED.especificaciones,
          precio_base = EXCLUDED.precio_base,
          disponible = EXCLUDED.disponible,
          updated_at = NOW()
        `,
        [
          product.categoria,
          product.nombre,
          product.descripcion,
          product.especificaciones,
          product.precio,
          product.disponible,
          idProveedor,
          product.url,
          createdBy,
        ]
      );

    }

    // Productos que ya no existen
    await client.query(
      `
      UPDATE item_catalogo
      SET disponible = false,
          updated_at = NOW()
      WHERE id_proveedor = $1
      AND url_origen NOT IN (
        SELECT UNNEST($2::text[])
      )
      `,
      [
        idProveedor,
        urlsCatalogo,
      ]
    );

    await client.query(
      "COMMIT"
    );

  } catch (error) {

    await client.query(
      "ROLLBACK"
    );

    throw error;

  } finally {

    client.release();

  }
}

async function syncLaPipa() {

  let products =
    await extractCatalogLaPipa();

  products =
    removeDuplicates(
      products
    );

  await syncCatalogProducts(
    products,
    5, // id proveedor La Pipa
    1  // usuario sistema
  );

  return products;

}

async function syncComercialCaldas() {
  /*
   * 1. Extraer y depurar productos.
   */
  let products =
    await extractCatalogComercialCaldas();

  products =
    removeDuplicates(products);

  /*
   * 2. Seleccionar productos que realmente
   * tienen un PDF descargado.
   */
  const productsConPdf =
    products.filter(
      producto =>
        producto.pdfContenido &&
        producto.pdfContenido.length > 0
    );

  console.log(
    `Productos encontrados: ${products.length}`
  );

  console.log(
    `Productos con PDF: ${productsConPdf.length}`
  );

  let especificacionesPorUrl =
    new Map();

  /*
   * 3. Procesar los PDF en lotes.
   */
  if (productsConPdf.length > 0) {
    especificacionesPorUrl =
      await procesarFichasPorLotesAPowerAutomate(
        productsConPdf,
        10
      );
  } else {
    console.warn(
      'No se encontraron productos con PDF. Se omite Power Automate.'
    );
  }

  /*
   * 4. Si enviamos documentos pero no se
   * relacionó ninguno, detenemos el proceso.
   */
  if (
    productsConPdf.length > 0 &&
    especificacionesPorUrl.size === 0
  ) {
    throw new Error(
      'Power Automate no devolvió especificaciones para ningún producto'
    );
  }

  /*
   * 5. Verificar que todos los productos
   * enviados recibieron una respuesta.
   */
  if (
    especificacionesPorUrl.size !==
    productsConPdf.length
  ) {
    throw new Error(
      'No todos los productos enviados a Power Automate recibieron especificaciones'
    );
  }

  /*
   * 6. Combinar productos y resultados.
   */
  const productsConSpecs =
    products.map(
      producto => {
        const datosIA =
          especificacionesPorUrl.get(
            producto.url
          );

        /*
         * Los productos sin PDF se conservan,
         * pero no tienen información de IA.
         */
        if (!datosIA) {
          return {
            ...producto,

            descripcion:
              producto.descripcion ||
              '',

            especificaciones:
              null,
          };
        }

        /*
         * Extraemos la descripción y dejamos
         * el resto de campos como especificaciones.
         */
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

        /*
         * Eliminar valores nulos o vacíos antes
         * de guardar el JSON de especificaciones.
         */
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
            ).length > 0
              ? especificacionesLimpias
              : null,
        };
      }
    );

  /*
   * 7. Comprobar cuántos productos terminaron
   * con información de IA.
   */
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
   * 8. Mostrar una muestra antes de escribir
   * en la base de datos.
   */
  const muestra =
    productsConSpecs.find(
      producto =>
        producto.especificaciones
    );

  if (muestra) {
    console.log(
      'Muestra antes de guardar:',
      JSON.stringify(
        {
          nombre:
            muestra.nombre,
          descripcion:
            muestra.descripcion,
          especificaciones:
            muestra.especificaciones,
        },
        null,
        2
      )
    );
  }

  /*
   * 9. Guardar solamente cuando todos los
   * lotes terminaron correctamente.
   */
  await syncCatalogProducts(
    productsConSpecs,
    6,
    1
  );

  /*
   * 10. Retirar Base64 de la respuesta.
   */
  return productsConSpecs.map(
    ({
      pdfContenido,
      ...producto
    }) => producto
  );
}

async function syncTodosLosCatalogos(
  req,
  res
) {

  try {

    const laPipa =
      await syncLaPipa();
    
    const comercialCaldas =
      await syncComercialCaldas();

    const catalogo = [

      ...laPipa,
      comercialCaldas

    ];

    // return res.status(200).json({

    //   total_productos:
    //     catalogo.length,
    //   productos: catalogo,
    //   sincronizados: true,

    // });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });

  }

}

module.exports = {
  createItem,
  getItemsMyCatalog,
  getItemById,
  updateItem,
  uploadImagenItem,
  deleteImagenItem,
  obtenerProductosLaPipa,
  syncTodosLosCatalogos,
  syncComercialCaldas
};