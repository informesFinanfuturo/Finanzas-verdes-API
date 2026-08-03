// controllers/roles.controller.js
const pool = require('../db');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { askAIStructured, AIServiceError } = require('../services/iaService');

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

  try {

    // ✅ VALIDACIONES
    if (!nombre || !tipo|| !id_mipyme || !created_by) {
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
        a.marca,
        a.modelo,
        a.datos,
        a.estado,
        a.observacion_ia,
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
    marca,
    modelo,
    datos,
    estado_activo,
    updated_by,
  } = req.body;

  try {

    if (Number.isNaN(idActivo)) {
      return res.status(400).json({
        error: 'El id del activo debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    const exists = await pool.query(
      `
      SELECT id_activo
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

    if (datos !== undefined) {
      add('datos', datos);
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
    add('updated_by', updated_by);

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
      Debes actuar como un inspector técnico conservador y objetivo. Tu responsabilidad es identificar información verificable observada en las imágenes sin asumir características no visibles.
      `,
      taskDescription: `
      Analiza las imágenes proporcionadas e identifica el activo observado.
      Extrae toda la información técnica disponible en:
      - Placas técnicas.
      - Etiquetas de fabricante.
      - Etiquetas de eficiencia.
      - Fichas técnicas.
      - Manuales.
      - Características visibles del equipo.
      Tu objetivo es construir una ficha descriptiva del activo que permita posteriormente evaluar su impacto sobre el consumo de recursos.
      Cuando varias imágenes pertenezcan al mismo activo debes consolidar toda la información disponible en una única respuesta.
      `,
      contextData: {
        activo : {
          "nombre": activo.nombre,
          "tipo": activo.tipo,
          "marca": activo.marca,
          "modelo": activo.modelo,
          "descripcion": activo.descripcion,
        },
        facturas_mipyme: facturas,
      },
 
      // 🔥 ESTE JSON ES EL QUE DEFINE LOS "VALORES PARAMETRIZADOS" QUE QUIERES EXTRAER
      // Puedes cambiar estos campos por los que necesite cada endpoint
      outputSchemaExample: {
        "marca": "String | null",
        "modelo": "String | null",
        "observacion_ia": "String | null",
        "datos" : {
          "Huella de carbono" : "float | null",
          "Costo mensual" : "float | null",
          "Impacto" : '"Alto" | "Medio" | "Bajo"',
          "Nivel de confianza" : "int | null"
        }
      },
 
      rules: [
        "Extrae únicamente información visible en las imágenes.",
        `Nunca inventes:
          - Potencias.
          - Caudales.
          - Consumos.
          - Capacidades.
          - Modelos.
          - Clasificaciones.`,
        "Si un valor no puede determinarse con suficiente confianza utiliza null",
        "Si existen varias fotografías del mismo activo, combina la información encontrada en todas ellas.",
        `
        Prioriza la información encontrada en:
        - Placas técnicas.
        - Fichas técnicas.
        - Etiquetas de desempeño.
        - Información del fabricante.
        `,
        "Conserva los valores utilizando las unidades originales observadas.",
        "Si aparecen múltiples capacidades o consumos, extrae todos aquellos claramente identificados.",
        `
        Registra cualquier información relevante relacionada con:
        -  Consumo de energía.
        -  Consumo de agua.
        -  Consumo de gas.
        -  Eficiencia.
        -  Capacidad operativa.
        `,
        //"No utilices conocimiento externo para completar información faltante.",
        "Si la calidad de la imagen dificulta la extracción, regístralo en observaciones.",
        "La respuesta debe contener exclusivamente un objeto JSON válido.",
        "El objeto de salida datos debe contener obligatoriamente las llaves Huella de carbono, Costo mensual, Impacto y Nivel de confianza. Además debe contener dinámicamente todas las características técnicas identificadas en las imágenes. Por ejemplo: voltaje, potencia, consumo de agua, consumo de gas, capacidad, caudal, presión, eficiencia energética, capacidad de refrigeración. No existe un conjunto fijo de especificaciones, se deben de incluir las que se encuentren para el activo analizado.",
        "Para calcular la huella de carbono utiliza el consumo nominal del activo multiplicado por el uso aproximado que se le da, para huella de carbono por energía multiplica también por el factor 0,097kgCo2e/kwh, para la huella de carbono por gas natural usa 56100kgCo2e/TJ",
        "Para el costo mensual utiliza la cantidad consumida por el activo y el tiempo de uso (Que en su mayoría estará en la descripción del activo) multiplicado por el valor unitario (ejemplo: si una nevera consume 150kwh mensual y el precio del kwh es $900 entonces el costo mensual aproximado es de $94500)",
        "El nivel de confianza es una medida del 1 al 10 de que tan confiables son los datos que extragiste",
        "En el campo de observacion_ia, explica qué datos utilizaste o qué aproximaciones hiciste para llegar las conclusiones y a los indicadores."
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
  const updatedBy = req.user?.id_usuario || req.body?.updated_by || null;

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
      SELECT id_activo, estado
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