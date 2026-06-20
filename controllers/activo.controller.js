// controllers/roles.controller.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// POST /api/roles

async function createActivo(req, res) {
  const {
    nombre,
    tipo,
    descripcion, // ✅ opcional
    datos,       // ✅ opcional
    estado_activo,
    id_mipyme,
    created_by,
  } = req.body;

  try {

    // ✅ VALIDACIONES REALES (ajustadas)
    if (!nombre || !tipo || !id_mipyme || !created_by) {
      return res.status(400).json({
        error: 'nombre, tipo, id_mipyme y created_by son obligatorios',
      });
    }

    // ✅ verificar mipyme
    const exists = await pool.query(
      'SELECT id_mipyme FROM mipyme WHERE id_mipyme = $1',
      [id_mipyme]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada',
      });
    }

    // ✅ INSERT
    const result = await pool.query(
      `
      INSERT INTO activo (
        nombre,
        tipo,
        descripcion,
        datos,
        estado,
        id_mipyme,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        NOW(),
        NULL,
        $7,
        NULL
      )
      RETURNING *
      `,
      [
        nombre,
        tipo,
        descripcion ?? null,
        datos ?? null,
        estado_activo ?? 'activo',
        id_mipyme,
        created_by
      ]
    );

    return res.status(201).json({
      message: 'Activo creado correctamente',
      activo: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear activo:', err);

    return res.status(500).json({
      error: 'Error interno al crear activo',
    });
  }
}

async function getActivoById(req, res) {
  const idActivo = Number(req.params.id);

  try {
    // ✅ validar ID
    if (Number.isNaN(idActivo)) {
      return res.status(400).json({
        error: 'El id del activo debe ser numérico',
      });
    }

    // ✅ consulta directa
    const result = await pool.query(
      `
      SELECT
        a.id_activo,
        a.nombre,
        a.tipo,
        a.descripcion,
        a.datos,
        a.estado,
        a.id_mipyme,
        a.created_at,
        a.updated_at,
        a.created_by,
        a.updated_by,

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

      FROM activo a
      LEFT JOIN archivo_activo aa
        ON aa.id_activo = a.id_activo
      LEFT JOIN archivo ar
        ON ar.id_archivo = aa.id_archivo

      WHERE a.id_activo = $1
      GROUP BY a.id_activo 
      `,
      [idActivo]
    );


    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Activo no encontrado',
      });
    }

    return res.status(200).json({
      activo: result.rows[0],
    });

  } catch (err) {
    console.error('Error al obtener activo:', err);

    return res.status(500).json({
      error: 'Error interno al obtener activo',
    });
  }
}

async function updateActivo(req, res) {
  const idActivo = Number(req.params.id);

  const {
    nombre,
    tipo,
    descripcion,
    datos,
    estado_activo,
    updated_by,
  } = req.body;

  try {
    // ✅ validar id
    if (Number.isNaN(idActivo)) {
      return res.status(400).json({
        error: 'El id del activo debe ser numérico',
      });
    }

    // ✅ validar auditoría
    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // ✅ verificar existencia
    const exists = await pool.query(
      'SELECT id_activo FROM activo WHERE id_activo = $1',
      [idActivo]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Activo no encontrado',
      });
    }

    // ✅ construcción dinámica
    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    if (nombre !== undefined) add('nombre', nombre);
    if (tipo !== undefined) add('tipo', tipo);
    if (descripcion !== undefined) add('descripcion', descripcion);
    if (datos !== undefined) add('datos', datos);
    if (estado_activo !== undefined) add('estado_activo', estado_activo);

    // ✅ auditoría siempre
    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    if (fields.length === 1) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await pool.query(
      `
      UPDATE activo
      SET ${fields.join(', ')}
      WHERE id_activo = $${index}
      RETURNING *
      `,
      [...values, idActivo]
    );

    return res.status(200).json({
      message: 'Activo actualizado correctamente',
      activo: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar activo:', err);

    return res.status(500).json({
      error: 'Error interno al actualizar activo',
    });
  }
}

async function uploadImagenActivo(req, res) {
  const {
    id_activo,
    created_by
  } = req.body;

  try {
    // 1️⃣ Validaciones
    if (!req.file) {
      return res.status(400).json({
        error: 'La imagen es obligatoria',
      });
    }

    if (!id_activo || !created_by) {
      return res.status(400).json({
        error: 'id_activo y created_by son obligatorios',
      });
    }

    // 2️⃣ Verificar activo
    const activoExists = await pool.query(
      'SELECT id_activo FROM activo WHERE id_activo = $1',
      [id_activo]
    );

    if (activoExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Activo no encontrado',
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
      VALUES ($1,$2,$3,$4,$5,'activo',NOW(),NULL,$6,NULL)
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

    // 5️⃣ Relacionar con activo
    await pool.query(
      `
      INSERT INTO archivo_activo (
        id_archivo,
        id_activo
      )
      VALUES ($1,$2)
      `,
      [
        archivo.id_archivo,
        id_activo
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

async function deleteImagenActivo(req, res) {
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
      'DELETE FROM archivo_activo WHERE id_archivo = $1',
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
  createActivo,
  getActivoById,
  updateActivo,
  uploadImagenActivo,
  deleteImagenActivo,
};