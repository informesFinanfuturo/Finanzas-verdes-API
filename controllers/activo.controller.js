// controllers/roles.controller.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { askAIStructured, AIServiceError } = require('../services/iaService');
const { requireMipymeAccess } = require('../utils/accessControl');

// POST /api/roles
async function createActivo(req, res) {
  const {
    nombre,
    tipo,
    marca,       
    modelo,      
    descripcion,
    datos,
    estado_activo,
    id_mipyme,
    created_by,
  } = req.body;

  const actorId = req.user?.id_usuario;

  try {

    // ✅ VALIDACIONES
    if (!nombre || !tipo || !id_mipyme) {
      return res.status(400).json({
        error: 'nombre, tipo e id_mipyme son obligatorios',
      });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
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

    await requireMipymeAccess(pool, actorId, id_mipyme);

    // ✅ INSERT (con nuevas columnas)
    const result = await pool.query(
      `
      INSERT INTO activo (
        nombre,
        tipo,
        marca,
        modelo,
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
        $1,$2,$3,$4,$5,$6,$7,$8,
        NOW(),
        NULL,
        $9,
        NULL
      )
      RETURNING *
      `,
      [
        nombre,
        tipo,
        marca,                  // ✅ obligatorio
        modelo ?? null,         // ✅ opcional
        descripcion ?? null,
        datos ?? null,
        estado_activo ?? 'activo',
        id_mipyme,
        actorId
      ]
    );

    return res.status(201).json({
      message: 'Activo creado correctamente',
      activo: result.rows[0],
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }
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
        a.marca,
        a.modelo,
        a.datos,
        a.estado,
        a.observacion_ia,
        a.id_mipyme,
        a.cantidad,
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

    await requireMipymeAccess(
      pool,
      req.user?.id_usuario,
      result.rows[0].id_mipyme,
    );

    return res.status(200).json({
      activo: result.rows[0],
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }
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
    marca,
    modelo,
    estado_activo,
    updated_by,
    cantidad
  } = req.body;

  const actorId = req.user?.id_usuario;

  try {

    if (Number.isNaN(idActivo)) {
      return res.status(400).json({
        error: 'El id del activo debe ser numérico',
      });
    }
    
    if (Number.isNaN(cantidad)) {
      return res.status(400).json({
        error: 'La cantidad del activo debe ser numérica',
      });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const exists = await pool.query(
      `
      SELECT id_activo, id_mipyme
      FROM activo
      WHERE id_activo = $1
      `,
      [idActivo]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Activo no encontrado',
      });
    }

    await requireMipymeAccess(pool, actorId, exists.rows[0].id_mipyme);

    const clean = (value) => {

      if (value === undefined) {
        return undefined;
      }

      if (
        value === null ||
        (
          typeof value === 'string' &&
          value.trim() === ''
        )
      ) {
        return null;
      }

      return typeof value === 'string'
          ? value.trim()
          : value;
    };

    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    // ✅ CAMPOS EDITABLES

    if (nombre !== undefined) {
      add('nombre', clean(nombre));
    }

    if (tipo !== undefined) {
      add('tipo', clean(tipo));
    }

    if (descripcion !== undefined) {
      add('descripcion', clean(descripcion));
    }

    if (marca !== undefined) {
      add('marca', clean(marca));
    }

    if (modelo !== undefined) {
      add('modelo', clean(modelo));
    }
    
    if (cantidad !== undefined) {
      add('cantidad', clean(cantidad));
    }

    if (estado_activo !== undefined) {
      add('estado', clean(estado_activo));
    }

    // ✅ validar que venga al menos un cambio
    if (fields.length == 0) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    // ✅ auditoría
    fields.push('updated_at = NOW()');
    add('updated_by', actorId);

    const result = await pool.query(
      `
      UPDATE activo
      SET ${fields.join(', ')}
      WHERE id_activo = $${index}
      RETURNING *
      `,
      [
        ...values,
        idActivo,
      ]
    );

    return res.status(200).json({
      message: 'Activo actualizado correctamente',
      activo: result.rows[0],
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }

    console.error(
      'Error al actualizar activo:',
      err
    );

    return res.status(500).json({
      error: 'Error interno al actualizar activo',
    });
  }
}

async function uploadImagenActivo(req, res) {
  const { id_activo } = req.body;
  const actorId = req.user?.id_usuario;

  try {
    // 1️⃣ Validaciones
    if (!req.file) {
      return res.status(400).json({
        error: 'La imagen es obligatoria',
      });
    }

    if (!id_activo) {
      return res.status(400).json({ error: 'id_activo es obligatorio' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    // 2️⃣ Verificar activo
    const activoExists = await pool.query(
      'SELECT id_activo, id_mipyme FROM activo WHERE id_activo = $1',
      [id_activo]
    );

    if (activoExists.rows.length === 0) {
      return res.status(404).json({
        error: 'Activo no encontrado',
      });
    }

    await requireMipymeAccess(pool, actorId, activoExists.rows[0].id_mipyme);

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
        actorId
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
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }
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

    // 2️⃣ Obtener archivo y activo asociado para validar acceso
    const archivoResult = await pool.query(
      `
      SELECT ar.*, a.id_mipyme
      FROM archivo ar
      INNER JOIN archivo_activo aa ON aa.id_archivo = ar.id_archivo
      INNER JOIN activo a ON a.id_activo = aa.id_activo
      WHERE ar.id_archivo = $1
      LIMIT 1
      `,
      [id_archivo]
    );

    if (archivoResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Archivo no encontrado',
      });
    }

    const archivo = archivoResult.rows[0];

    await requireMipymeAccess(pool, req.user?.id_usuario, archivo.id_mipyme);

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
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }
    console.error('Error al eliminar imagen:', err);

    return res.status(500).json({
      error: 'Error interno al eliminar imagen',
    });
  }
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function normalizeString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeInt(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.round(value);

  const cleaned = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(',', '.');

  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : Math.round(parsed);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;

  const cleaned = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(',', '.');

  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeDatosIA(datos = {}) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return {};

  const normalized = {};

  for (const [key, value] of Object.entries(datos)) {
    if (value === null || value === undefined || value === '') {
      normalized[key] = null;
      continue;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      // números tipo "45.000", "120", "20%"
      if (/^-?[\d.,% ]+$/.test(trimmed)) {
        if (trimmed.includes('%')) {
          normalized[key] = normalizeNumber(trimmed.replace('%', ''));
        } else {
          normalized[key] = normalizeNumber(trimmed);
        }
      } else {
        normalized[key] = trimmed;
      }
      continue;
    }

    if (typeof value === 'number') {
      normalized[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      normalized[key] = value;
      continue;
    }

    if (typeof value === 'object') {
      normalized[key] = normalizeDatosIA(value);
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function mergePreferExisting(existing, incoming) {
  if (!hasValue(existing)) return incoming;
  if (!hasValue(incoming)) return existing;

  if (
    typeof existing === 'object' &&
    typeof incoming === 'object' &&
    !Array.isArray(existing) &&
    !Array.isArray(incoming)
  ) {
    const result = { ...existing };

    for (const key of Object.keys(incoming)) {
      result[key] = mergePreferExisting(existing[key], incoming[key]);
    }

    return result;
  }

  // Si existing ya tiene valor, se respeta
  return existing;
}

async function analizarActivo(req, res) {
  const idActivo = Number(req.params.id);
  const client = await pool.connect();

  // ✅ Helpers locales (autocontenidos)
  const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  };

  const normalizeString = (value) => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
  };

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

  const normalizeDatosIA = (datos = {}) => {
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return {};

    const normalized = {};

    for (const [key, value] of Object.entries(datos)) {
      if (value === null || value === undefined || value === '') {
        normalized[key] = null;
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();

        // intenta normalizar a número si parece número/porcentaje/moneda
        if (/^-?[\d.,% ]+$/.test(trimmed)) {
          const raw = trimmed.replace('%', '');
          const num = normalizeNumber(raw);
          normalized[key] = num;
        } else {
          normalized[key] = trimmed;
        }
        continue;
      }

      if (typeof value === 'number') {
        normalized[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        normalized[key] = value;
        continue;
      }

      if (typeof value === 'object') {
        normalized[key] = normalizeDatosIA(value);
        continue;
      }

      normalized[key] = value;
    }

    return normalized;
  };

  // Merge conservador: si existing ya tiene valor, se conserva
  const mergePreferExisting = (existing, incoming) => {
    if (!hasValue(existing)) return incoming;
    if (!hasValue(incoming)) return existing;

    if (
      typeof existing === 'object' &&
      typeof incoming === 'object' &&
      !Array.isArray(existing) &&
      !Array.isArray(incoming)
    ) {
      const result = { ...existing };

      for (const key of Object.keys(incoming)) {
        result[key] = mergePreferExisting(existing[key], incoming[key]);
      }

      return result;
    }

    return existing;
  };

  // ✅ Elimina claves que pertenecen a columnas del activo y deja solo dinámicos
  const sanitizeDatosDinamicos = (raw = {}) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const reserved = new Set([
      'nombre',
      'tipo',
      'marca',
      'modelo',
      'descripcion',
      'datos',
      'activo',
    ]);

    // top-level dinámico
    const topLevel = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!reserved.has(String(key).toLowerCase())) {
        topLevel[key] = value;
      }
    }

    // si venía metido un objeto datos, lo aplanamos como fallback
    let nestedDatos = {};
    if (raw.datos && typeof raw.datos === 'object' && !Array.isArray(raw.datos)) {
      for (const [key, value] of Object.entries(raw.datos)) {
        if (!reserved.has(String(key).toLowerCase())) {
          nestedDatos[key] = value;
        }
      }
    }

    // Prioridad a top-level si ya tiene valor; si no, usa nestedDatos
    return mergePreferExisting(topLevel, nestedDatos);
  };

  try {
    await client.query('BEGIN');

    // ✅ 1. Validar ID
    if (Number.isNaN(idActivo)) {
      return res.status(400).json({
        error: 'El id del activo debe ser numérico',
      });
    }

    // ✅ 2. Obtener activo completo
    const activoResult = await client.query(
      `
      SELECT
        a.id_activo,
        a.nombre,
        a.tipo,
        a.marca,
        a.modelo,
        a.descripcion,
        a.datos,
        a.estado,
        a.id_mipyme, 
        a.cantidad,
        a.created_at,
        a.updated_at,
        a.created_by,
        a.updated_by,

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

      FROM activo a
      LEFT JOIN archivo_activo aa
        ON aa.id_activo = a.id_activo
      LEFT JOIN archivo ar
        ON ar.id_archivo = aa.id_archivo
 
      WHERE 
        a.id_activo = $1
        AND COALESCE(a.estado, 'activo') != 'eliminado'

      GROUP BY a.id_activo
      `,
      [idActivo]
    );

    if (activoResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Activo no encontrado',
      });
    }

    const activo = activoResult.rows[0];

    await requireMipymeAccess(client, req.user?.id_usuario, activo.id_mipyme);

    // ✅ 3. Obtener facturas de la misma mipyme (no eliminadas)
    const facturasResult = await client.query(
      `
      SELECT
        c.id_consumo,
        c.tipo,
        c.proveedor,
        c.periodo_inicio,
        c.periodo_fin,
        c.costo_unitario,
        c.valor,
        c.consumo,
        c.unidad,
        c.observaciones,
        c.estado,
        c.created_at,
        c.updated_at
      FROM consumo c
      WHERE 
        c.id_mipyme = $1
        AND COALESCE(c.estado, 'activo') != 'eliminado'
      ORDER BY c.created_at DESC
      `,
      [activo.id_mipyme]
    );

    const facturas = facturasResult.rows;

    // ✅ 4. Preparar imágenes para IA
    const imagePaths = (activo.imagenes || [])
      .map((img) => img?.ubicacion)
      .filter(Boolean)
      .map((ubicacion) => path.join(__dirname, '..', ubicacion));

    // ✅ 5. Validación mínima de contexto
    const hasContext =
      hasValue(activo.nombre) ||
      hasValue(activo.tipo) ||
      hasValue(activo.marca) ||
      hasValue(activo.modelo) ||
      hasValue(activo.descripcion) ||
      imagePaths.length > 0 ||
      facturas.length > 0;

    if (!hasContext) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'No hay suficiente información para analizar el activo',
        ai_error: {
          code: 'INSUFFICIENT_CONTEXT',
          message_user:
            'Debes registrar al menos nombre, tipo, marca, modelo, descripción, una imagen del activo o facturas asociadas a la mipyme.',
        },
      });
    }

    // ✅ 6. Llamada a IA
    const datosIA = await askAIStructured({
      role: `
        Eres un especialista en inventario técnico de activos operativos, eficiencia de recursos y sostenibilidad empresarial para micro y pequeñas empresas.
 
        Tu función es analizar fotografías de equipos, electrodomésticos, maquinaria ligera, sistemas de iluminación, equipos de climatización, sistemas de bombeo, equipos de cocina, equipos industriales ligeros y cualquier otro activo que pueda generar consumos de energía, agua o gas.
 
        Debes actuar como un inspector técnico conservador, verificable y objetivo.
 
        Tu responsabilidad es identificar información técnica real utilizando tres fuentes posibles:
 
        1. Información visible en las imágenes.
        2. Información obtenida mediante Google Search.
        3. Información proporcionada en el contexto.
 
        Nunca utilices conocimiento propio para completar información faltante.
      `,
      taskDescription: `
        FASE 1. EXTRACCIÓN VISUAL
 
        Extrae toda la información visible en:
 
        - Placas técnicas.
        - Etiquetas de fabricante.
        - Etiquetas energéticas.
        - Manuales.
        - Fichas técnicas visibles.
        - Logotipos.
        - Referencias.
        - Números de serie.
        - Modelos.
        - Características físicas observables.
 
        Si existen varias fotografías del mismo activo debes consolidar toda la información encontrada.
 
        Prioriza siempre:
 
        1. Placas técnicas.
        2. Información del fabricante.
        3. Etiquetas de eficiencia.
        4. Información visible impresa en el equipo.
 
        Conserva las unidades originales observadas.
 
        FASE 2. BÚSQUEDA WEB OBLIGATORIA
 
        Debes realizar una búsqueda web obligatoriamente cuando ocurra cualquiera de las siguientes situaciones:
 
        - La marca sea desconocida.
        - El modelo sea desconocido.
        - Exista un logotipo visible.
        - Exista texto parcial visible.
        - Exista una referencia parcial visible.
        - No exista una placa técnica o esté incompleta.
        - Existan datos insuficientes para identificar el activo.
        - Existan datos insuficientes para calcular consumos, costos o huella de carbono.
 
        No puedes finalizar el análisis sin intentar una búsqueda web cuando se cumpla alguna de estas condiciones.
 
        Durante la búsqueda:
 
        1. Busca coincidencias usando logos visibles.
        2. Busca coincidencias usando textos visibles.
        3. Busca coincidencias usando números de serie.
        4. Busca coincidencias usando referencias parciales.
        5. Busca coincidencias usando características físicas observables.
        6. Prioriza siempre información publicada por fabricantes o distribuidores oficiales.
 
        Si después de la búsqueda no existe evidencia suficiente, devuelve null.
 
        FASE 3. TRAZABILIDAD OBLIGATORIA
 
        Toda información obtenida mediante búsqueda web debe:
 
        - Reportarse explícitamente.
        - Diferenciarse de la información observada en imágenes.
        - Incluir las URLs utilizadas.
        - Incluir las consultas realizadas.
        - Incluir las fuentes utilizadas.
      `,
      contextData: {
        activo : {
          "nombre": activo.nombre,
          "tipo": activo.tipo,
          "marca": activo.marca,
          "modelo": activo.modelo,
          "cantidad": activo.cantidad,
          "descripcion": activo.descripcion,
        },
        facturas_mipyme: facturas,
      },
 
      outputSchemaExample: {
        "marca": "String | null",
        "modelo": "String | null",
        "observacion_ia": "String | null",
        "datos" : {
          // "Huella de carbono" : "float | null",
          // "Costo mensual" : "float | null",
          "Impacto" : '"Alto" | "Medio" | "Bajo"',
          "Nivel de confianza" : "int | null"
        },
        "utilizo_busqueda_web": false,
        "consultas_realizadas": [],
        "fuentes": [],
      },
 
      rules: [
        `
        REGLAS GENERALES
 
          Reporta únicamente información:
 
          - Visible en las imágenes.
          - Presente en el contexto.
          - Obtenida mediante búsqueda web.
 
          Nunca inventes datos específicos.
 
          Sin embargo, si después de realizar una búsqueda web no existe información exacta del activo, puedes utilizar información de equipos equivalentes o modelos similares encontrados en fuentes confiables.
 
          Toda estimación debe:
 
          - Basarse en fuentes encontradas durante la búsqueda web.
          - Ser explícitamente marcada como estimación.
          - Indicar la fuente utilizada.
          - Indicar el nivel de incertidumbre.
          - Reducir el nivel de confianza.
 
          Si no encuentras información específica del activo:
 
          1. Busca modelos equivalentes del mismo fabricante.
          2. Busca equipos de características similares.
          3. Busca equipos de capacidad similar.
          4. Busca equipos de la misma categoría de uso.
 
          Si existe información razonablemente comparable:
 
          - Devuelve una estimación fundamentada.
          - Explica claramente la metodología.
          - Marca el dato como estimado.
 
          Sólo utiliza null cuando no exista información suficiente para realizar una estimación razonable.
 
          No realices estimaciones sin evidencia verificable.
 
          No utilices conocimiento propio.
 
          Si la calidad de alguna imagen dificulta el análisis, indícalo en observacion_ia.
 
          Utiliza doble salto de línea slash n (Saltos de línea para strings de flutter) dentro de observacion_ia para mejorar la legibilidad.
 
          La respuesta debe contener exclusivamente un JSON válido.
 
          CÁLCULO DE INDICADORES
 
          Sólo puedes calcular:
 
          - Costo mensual.
 
          cuando existan datos verificables de consumo o potencia obtenidos mediante:
 
          - Placa técnica.
          - Fabricante.
          - Ficha técnica.
          - Búsqueda web verificable.
 
          Si no existe información suficiente:
 
          Costo mensual = null
 
          No realices aproximaciones arbitrarias.
 
          Sí puedes realizar estimaciones fundamentadas cuando:
 
          - Existan referencias similares encontradas en internet.
          - Existan activos equivalentes documentados.
          - Existan rangos de consumo publicados.
 
          Debes explicar claramente:
 
          - Qué datos fueron observados.
          - Qué datos fueron encontrados en internet.
          - Qué datos fueron estimados.
          - Por qué la estimación es razonable.
 
          ──────────────────────────────
 
          OBSERVACION_IA
 
          En observacion_ia debes explicar detalladamente:
 
          - Qué tipo de activo fue identificado y cuál fue el nivel de certeza de la identificación.
 
          - Qué elementos físicos visibles permitieron identificar el activo (marca, modelo, paneles, controles, conexiones, dimensiones aparentes, componentes visibles, etiquetas, placa técnica, accesorios y estado físico observable).
 
          - Qué función cumple el activo y para qué tipo de operación o uso está diseñado.
 
          - Explicar en lenguaje natural cada característica técnica identificada.
 
          - Para cada característica técnica encontrada indicar:
            * cuál es el valor identificado,
            * qué significa técnicamente,
            * cómo impacta el funcionamiento del equipo,
            * cómo influye en su capacidad, rendimiento, eficiencia o consumo energético,
            * y si el dato fue observado, obtenido mediante búsqueda web o estimado.
 
          - Explicar la relación entre las especificaciones técnicas identificadas y el uso esperado del activo.
 
          - Describir la capacidad operativa del equipo utilizando las características encontradas.
 
          - Explicar las ventajas o implicaciones operativas de las características identificadas cuando sea posible sustentarlo con evidencia encontrada.
 
          - Incluir una descripción narrada del activo como si se estuviera elaborando un informe técnico de inspección.
 
          - Describir el estado visual observable del activo, incluyendo señales visibles de desgaste, deterioro, modificaciones, suciedad, corrosión, daños o condiciones relevantes cuando sean evidentes en las imágenes.
 
          - Diferenciar claramente los datos observados en las imágenes, los obtenidos mediante búsqueda web y los estimados.
 
          - Explicar por qué cada estimación realizada es razonable y cuál fue la evidencia utilizada.
 
          - Si se utilizaron equipos equivalentes o modelos similares, explicar cuáles fueron, por qué fueron seleccionados y cuáles características se tomaron como referencia.
 
          - Si existen varias características técnicas identificadas, no limitarse a listarlas; debe explicarse individualmente cada una en lenguaje natural.
 
          - Toda característica incluida dentro del objeto datos debe ser mencionada y explicada también dentro de observacion_ia.
 
          - La observacion_ia debe redactarse como un informe técnico descriptivo y analítico, no como una lista de atributos o una simple transcripción de especificaciones.
 
          - Incluir una sección final denominada "Conclusión técnica" donde se resuma la identificación del activo, sus características más relevantes, el nivel de confianza alcanzado y las principales limitaciones del análisis.
                  `,
                  `
                    Dentro del objeto datos debes incluir también dinámicamente todas las características técnicas identificadas.
 
          Ejemplos:
 
          - voltaje
          - potencia
          - corriente
          - capacidad
          - capacidad de refrigeración
          - eficiencia energética
          - caudal
          - presión
          - consumo de agua
          - consumo de energía
          - consumo de gas
          - temperatura máxima
          - cantidad de bandejas
          - cantidad de cámaras
 
          No existe un conjunto fijo de características.
 
          Debes incluir todas las que encuentres y únicamente las que puedas verificar.
        `,
        `
          Nivel de confianza:
 
          10 = Placa técnica completa del activo.
          9 = Información oficial exacta del fabricante.
          8 = Ficha técnica exacta del modelo.
          7 = Modelo equivalente del mismo fabricante.
          6 = Equipo muy similar encontrado en internet.
          5 = Promedio de varios equipos equivalentes.
          4 = Estimación aproximada basada en categoría.
          3 o menor = Evidencia insuficiente.
        `,
        `
        Si no existe consumo específico:
 
        - Busca consumos típicos del tipo de equipo.
        - Busca consumos de equipos equivalentes.
        - Utiliza un rango representativo.
        - Utiliza el valor promedio del rango.
 
        Explica siempre la fuente y la metodología utilizada.
        `,
        "Ten en cuenta las observaciones de entrada del usuario para el cálculo o aproximación de consumos basados en el uso",
        `
          Utiliza las fuentes en este orden de prioridad:
 
          1. Placa técnica visible.
          2. Ficha técnica exacta del modelo.
          3. Fabricante oficial.
          4. Distribuidor oficial.
          5. Modelo equivalente del mismo fabricante.
          6. Equipos equivalentes encontrados en múltiples fuentes.
          7. Promedios de mercado para la categoría.
 
          Utiliza la fuente de mayor prioridad disponible.
        `,
        `
          Cuando el activo no pueda identificarse completamente:
 
          - Identifica primero la categoría de equipo.
          - Determina capacidad aproximada observada.
          - Busca equipos equivalentes de la misma categoría.
          - Utiliza valores representativos encontrados en al menos dos fuentes.
 
          Ejemplo:
 
          Si se observa una nevera vertical comercial sin modelo:
 
          - Busca neveras verticales comerciales similares.
          - Busca equipos de capacidad parecida.
          - Utiliza consumos promedio documentados.
 
          Ejemplo:
 
          Si se observa un horno industrial sin placa:
 
          - Busca hornos industriales visualmente similares.
          - Busca equipos del mismo tamaño y configuración.
          - Utiliza especificaciones representativas documentadas.
        `,
        `
        Cuando exista el campo cantidad:
        - Considera que representa el número de unidades idénticas del activo.
        - Los consumos, costos e impactos agregados deben calcularse multiplicando los valores unitarios por dicha cantidad.
        - Debes reportar claramente el valor unitario y el valor total.
        `
      ],
 
      imagePaths,
    });


    const iaNombre = normalizeString(datosIA?.nombre);
    const iaTipo = normalizeString(datosIA?.tipo);
    const iaMarca = normalizeString(datosIA?.marca);
    const iaModelo = normalizeString(datosIA?.modelo);
    const iaDescripcion = normalizeString(datosIA?.descripcion);
    const iaObservacion= normalizeString(datosIA?.observacion_ia);

    // ✅ 8. Limpiar datos existentes + datos IA
    const datosExistentesLimpios = sanitizeDatosDinamicos(activo.datos || {});
    const iaDatosLimpios = sanitizeDatosDinamicos(
      normalizeDatosIA(datosIA?.datos || {})
    );

    // ✅ 9. Conservar lo ya registrado y solo completar faltantes
    const finalNombre = hasValue(activo.nombre) ? activo.nombre : iaNombre;

    const finalTipo =
      hasValue(iaTipo)
        ? iaTipo
        : activo.tipo;

    const finalMarca =
      hasValue(iaMarca)
        ? iaMarca
        : activo.marca;

    const finalModelo =
      hasValue(iaModelo)
        ? iaModelo
        : activo.modelo;

    const finalDescripcion = hasValue(activo.descripcion)
      ? activo.descripcion
      : iaDescripcion;
    const finalObservacion = hasValue(iaObservacion)
      ? iaObservacion
      : null;

    const finalDatos = iaDatosLimpios;

    // ✅ 10. Guardar columnas + datos dinámicos
    const updateResult = await client.query(
      `
      UPDATE activo
      SET
        nombre = $1,
        tipo = $2,
        marca = $3,
        modelo = $4,
        descripcion = $5,
        datos = $6,
        observacion_ia = $7, -- ✅ NUEVO
        updated_at = NOW()
      WHERE id_activo = $8
      RETURNING *
      `,
      [
        finalNombre,
        finalTipo,
        finalMarca,
        finalModelo,
        finalDescripcion,
        finalDatos,
        finalObservacion, // ✅ NUEVO
        idActivo,
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Activo analizado y actualizado correctamente',
      activo: {
        ...updateResult.rows[0],
        imagenes: activo.imagenes ?? [],
      },
      facturas_en_contexto: facturas.length,
      imagenes_enviadas: imagePaths.length,
      analisis_ia: datosIA,
      datos_finales_guardados: {
        nombre: finalNombre,
        tipo: finalTipo,
        marca: finalMarca,
        modelo: finalModelo,
        descripcion: finalDescripcion,
        datos: finalDatos,
      },
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }
    await client.query('ROLLBACK');
    console.error('Error analizando activo:', err);

    if (err instanceof AIServiceError) {
      return res.status(422).json({
        error: 'La IA no pudo procesar correctamente el activo',
        ai_error: {
          code: err.code,
          message_user: err.messageUser,
          extra: err.extra ?? {},
        },
      });
    }

    return res.status(500).json({
      error: err.message || 'Error interno al analizar activo',
    });
  } finally {
    client.release();
  }
}

async function deleteActivo(req, res) {
  const idActivo = Number(req.params.id);
  const updatedBy = req.user?.id_usuario || null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ validar id
    if (Number.isNaN(idActivo)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'El id del activo debe ser numérico',
      });
    }

    // ✅ validar usuario
    if (!updatedBy) {
      await client.query('ROLLBACK');
      return res.status(401).json({
        error: 'Usuario no autenticado',
      });
    }

    // ✅ verificar activo
    const activoResult = await client.query(
      `
      SELECT id_activo, estado, id_mipyme
      FROM activo
      WHERE id_activo = $1
      `,
      [idActivo]
    );

    if (activoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Activo no encontrado',
      });
    }

    await requireMipymeAccess(client, updatedBy, activoResult.rows[0].id_mipyme);

    if (String(activoResult.rows[0].estado || '').toLowerCase() === 'eliminado') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'El activo ya está eliminado',
      });
    }

    // ✅ obtener imágenes físicas antes de borrar relaciones/registros
    const imagenesResult = await client.query(
      `
      SELECT
        ar.id_archivo,
        ar.ubicacion
      FROM archivo_activo aa
      INNER JOIN archivo ar
        ON ar.id_archivo = aa.id_archivo
      WHERE aa.id_activo = $1
      `,
      [idActivo]
    );

    const imagenes = imagenesResult.rows;

    // ✅ borrar relaciones activo ↔ archivo
    await client.query(
      `
      DELETE FROM archivo_activo
      WHERE id_activo = $1
      `,
      [idActivo]
    );

    // ✅ borrar registros de archivo (solo los que pertenecían a este activo)
    if (imagenes.length > 0) {
      const idsArchivo = imagenes.map((img) => img.id_archivo);

      await client.query(
        `
        DELETE FROM archivo
        WHERE id_archivo = ANY($1::int[])
        `,
        [idsArchivo]
      );
    }

    // ✅ marcar activo como eliminado
    const deleteResult = await client.query(
      `
      UPDATE activo
      SET
        estado = 'eliminado',
        updated_at = NOW(),
        updated_by = $2
      WHERE id_activo = $1
      RETURNING *
      `,
      [idActivo, updatedBy]
    );

    // ✅ eliminar archivos físicos del disco
    for (const img of imagenes) {
      if (!img.ubicacion) continue;

      const filePath = path.join(__dirname, '..', img.ubicacion);

      try {
        // force:true evita error si el archivo ya no existe
        await fs.promises.rm(filePath, { force: true });
      } catch (fileErr) {
        console.error(`No se pudo eliminar el archivo físico: ${filePath}`, fileErr);
        // no hacemos throw para no romper toda la operación por un archivo huérfano
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Activo eliminado correctamente',
      activo: deleteResult.rows[0],
      imagenes_eliminadas: imagenes.length,
    });

  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
      });
    }
    await client.query('ROLLBACK');
    console.error('Error al eliminar activo:', err);

    return res.status(500).json({
      error: err.message || 'Error interno al eliminar activo',
    });

  } finally {
    client.release();
  }
}

module.exports = {
  createActivo,
  getActivoById,
  updateActivo,
  uploadImagenActivo,
  deleteImagenActivo,
  analizarActivo,
  deleteActivo,
};