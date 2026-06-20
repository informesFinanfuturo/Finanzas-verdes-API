const jwt = require('jsonwebtoken');
const pool = require('../db');
const path = require('path');
const fs = require('fs');

async function createConsumo(req, res) {
  const {
    tipo,              // ✅ obligatorio
    proveedor,
    periodo,
    valor,
    consumo,
    unidad,
    observaciones,
    estado,
    id_mipyme,
    created_by
  } = req.body;

  try {
    // 1️⃣ Validación mínima
    if (!tipo) {
      return res.status(400).json({
        error: 'tipo es obligatorio',
      });
    }

    // 2️⃣ Insert flexible
    const result = await pool.query(
      `
      INSERT INTO consumo (
        tipo,
        proveedor,
        periodo,
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        NOW(),
        NULL,
        $10,
        NULL
      )
      RETURNING *
      `,
      [
        tipo,
        proveedor ?? null,
        periodo ?? null,
        valor ?? null,
        consumo ?? null,
        unidad ?? null,
        observaciones ?? null,
        estado ?? 'consumo',
        id_mipyme ?? null,
        created_by ?? null
      ]
    );

    return res.status(201).json({
      message: 'Consumo creado correctamente',
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

  const {
    tipo,
    proveedor,
    periodo,
    valor,
    consumo,
    unidad,
    observaciones,
    estado,
    updated_by,
  } = req.body;

  try {
    // 1️⃣ Validar ID
    if (Number.isNaN(idConsumo)) {
      return res.status(400).json({
        error: 'El id del consumo debe ser numérico',
      });
    }

    // 2️⃣ Validar auditoría
    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // 3️⃣ Verificar existencia
    const exists = await pool.query(
      'SELECT id_consumo FROM consumo WHERE id_consumo = $1',
      [idConsumo]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    // 4️⃣ Construcción dinámica
    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    if (tipo !== undefined) add('tipo', tipo);
    if (proveedor !== undefined) add('proveedor', proveedor);
    if (periodo !== undefined) add('periodo', periodo);
    if (valor !== undefined) add('valor', valor);
    if (consumo !== undefined) add('consumo', consumo);
    if (unidad !== undefined) add('unidad', unidad);
    if (observaciones !== undefined) add('observaciones', observaciones);
    if (estado !== undefined) add('estado', estado);

    // ✅ auditoría SIEMPRE
    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    if (fields.length === 1) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    // 5️⃣ Ejecutar query
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
    // 1️⃣ Validar ID
    if (Number.isNaN(idConsumo)) {
      return res.status(400).json({
        error: 'El id del consumo debe ser numérico',
      });
    }

    // 2️⃣ Consultar
    const result = await pool.query(
      `
      SELECT 
        c.id_consumo,
        c.tipo,
        c.proveedor,
        c.periodo,
        c.valor,
        c.consumo,
        c.unidad,
        c.observaciones,
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

      WHERE c.id_consumo = $1
      GROUP BY c.id_consumo
      `,
      [idConsumo]
    );

    // 3️⃣ Validar existencia
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Consumo no encontrado',
      });
    }

    // 4️⃣ Respuesta
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

async function deleteImagenConsumo(req, res) {
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
      'DELETE FROM consumo_archivo WHERE id_archivo = $1',
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


module.exports = {
createConsumo,
updateConsumo,
getConsumoById,
uploadImagenConsumo,
deleteImagenConsumo,
};