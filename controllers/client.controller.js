// controllers/roles.controller.js
const bcrypt = require('bcrypt');
const pool = require('../db');
const { findCiiuByCode } = require('../services/ciiuService');
const { sendWelcomeEmail } = require('../utils/authMail');
const { isDocumentoONit, isNitJuridico } = require('../utils/validators');

// GET /api/client
async function getClients(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT
        u.id_usuario,
        u.nombre_usuario,
        u.email,
        u.documento,
        u.telefono,

        r.nombre_rol,
        r.id_rol,

        m.nombre_mipyme,
        m.municipio,
        m.tipo_empresa,
        u.estado,
        u.created_at

      FROM usuario u

      LEFT JOIN rol r
        ON r.id_rol = u.id_rol

      LEFT JOIN mipyme_usuario mu
        ON mu.id_usuario = u.id_usuario

      LEFT JOIN mipyme m
        ON m.id_mipyme = mu.id_mipyme

      WHERE r.nombre_rol = 'Cliente'
        AND COALESCE(u.estado, 'activo') != 'inactivo'

      ORDER BY u.created_at DESC
      `
    );

    return res.status(200).json({
      clients: result.rows,
    });

  } catch (err) {
    console.error('Error al listar clientes:', err);
    return res.status(500).json({
      error: 'Error interno al listar clientes',
    });
  }
}



// POST /api/user

async function createClient(req, res) {
  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    password,
    created_by
  } = req.body;

  try {
    // 1️⃣ Validaciones
    if (!documento || !nombre_usuario || !email || !password) {
      return res.status(400).json({
        error: 'documento, nombre_usuario, email y password son obligatorios',
      });
    }

    if (!created_by) {
      return res.status(400).json({
        error: 'created_by es obligatorio',
      });
    }

    // 2️⃣ Obtener el id_rol del rol "Cliente"
    const rolResult = await pool.query(
      `SELECT id_rol FROM rol WHERE nombre_rol = $1 AND estado = 'activo'`,
      ['Cliente']
    );

    if (rolResult.rows.length === 0) {
      return res.status(500).json({
        error: 'El rol "Cliente" no existe o está inactivo',
      });
    }

    const id_rol = rolResult.rows[0].id_rol;

    // 3️⃣ Verificar email duplicado
    const existing = await pool.query(
      'SELECT id_usuario FROM usuario WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese email',
      });
    }

    // 4️⃣ Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5️⃣ Insertar usuario con rol "Cliente"
    const result = await pool.query(
      `
      INSERT INTO usuario (
        documento,
        nombre_usuario,
        email,
        telefono,
        password_hash,
        id_rol,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'activo', NOW(), NULL, $7, NULL)
      RETURNING
        id_usuario,
        documento,
        nombre_usuario,
        email,
        telefono,
        id_rol,
        estado,
        created_at,
        created_by
      `,
      [
        documento.trim(),
        nombre_usuario.trim(),
        email.trim(),
        telefono ?? null,
        hashedPassword,
        id_rol,          // ✅ rol "Cliente" automático
        created_by
      ]
    );

    return res.status(201).json({
      message: 'Cliente creado correctamente',
      user: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear cliente:', err);
    return res.status(500).json({
      error: 'Error interno al crear cliente',
    });
  }
}


// PUT /apiclient/:id
async function updateClient(req, res) {
  const idUsuario = Number(req.params.id);

  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    estado,
    updated_by, // ✅ obligatorio
  } = req.body;

  try {
    // 1️⃣ Validaciones
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id del cliente debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    // 2️⃣ Verificar que el usuario exista y SEA CLIENTE
    const current = await pool.query(
      `
      SELECT u.id_usuario, u.email
      FROM usuario u
      JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1
        AND r.nombre_rol = 'Cliente'
      `,
      [idUsuario]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Cliente no encontrado',
      });
    }

    // 3️⃣ Validar email duplicado (si cambia)
    if (email && email !== current.rows[0].email) {
      const existing = await pool.query(
        `
        SELECT id_usuario
        FROM usuario
        WHERE email = $1 AND id_usuario != $2
        `,
        [email, idUsuario]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'Ya existe un usuario con ese email',
        });
      }
    }

    // 4️⃣ Construir UPDATE dinámico
    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(`${field} = $${index}`);
      values.push(value);
      index++;
    };

    if (documento) add('documento', documento.trim());
    if (nombre_usuario) add('nombre_usuario', nombre_usuario.trim());
    if (email) add('email', email.trim());
    if (telefono !== undefined) add('telefono', telefono);
    if (estado !== undefined) add('estado', estado);

    // ✅ Auditoría SIEMPRE
    fields.push('updated_at = NOW()');
    add('updated_by', updated_by);

    if (fields.length === 0) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await pool.query(
      `
      UPDATE usuario
      SET ${fields.join(', ')}
      WHERE id_usuario = $${index}
      RETURNING
        id_usuario,
        documento,
        nombre_usuario,
        email,
        telefono,
        estado,
        updated_at,
        updated_by
      `,
      [...values, idUsuario]
    );

    return res.status(200).json({
      message: 'Cliente actualizado correctamente',
      client: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar cliente:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar cliente',
    });
  }
}

async function getClienteFull(req, res) {
  const idUsuario = Number(req.params.id);

  try {
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    const result = await pool.query(
      `
      SELECT
        -- ✅ USUARIO
        u.id_usuario,
        u.documento,
        u.nombre_usuario,
        u.email,
        u.telefono,
        u.estado,
        u.created_at,

        -- ✅ MIPYME
        m.id_mipyme,
        m.nombre_mipyme,
        m.nit,
        m.sector_economico,
        m.direccion,
        m.departamento,
        m.municipio,
        m.barrio,
        m.estrato,
        m.descripcion_empresa,
        m.cantidad_empleados,
        m.ingresos,
        m.egresos,
        m.codigo_ciiu,
        m.tipo_persona,
        m.tipo_empresa,
        m.estado AS estado_mipyme,

        -- ✅ ACTIVOS
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id_activo', a.id_activo,
            'nombre', a.nombre,
            'tipo', a.tipo,
            'descripcion', a.descripcion,
            'datos', a.datos,
            'estado', a.estado
          )
        ) FILTER (WHERE a.id_activo IS NOT NULL) AS activos,

        -- ✅ FACTURAS
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id_consumo', c.id_consumo,
            'tipo', c.tipo,
            'periodo_inicio', c.periodo_inicio,
            'periodo_fin', c.periodo_fin,
            'valor', c.valor,
            'consumo', c.consumo,
            'unidad', c.unidad,
            'estado', c.estado
          )
        ) FILTER (WHERE c.id_consumo IS NOT NULL) AS facturas,

        -- ✅ DIAGNÓSTICOS
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id_diagnostico', d.id_diagnostico,
            'titulo', d.titulo,
            'problema', d.problema,
            'beneficios', d.beneficios,
            'estado', d.estado
          )
        ) FILTER (WHERE d.id_diagnostico IS NOT NULL) AS diagnosticos,

        -- ✅ PLANES DE TRABAJO + TAREAS + MÉTRICAS
        planes_data.planes_trabajo

      FROM usuario u

      LEFT JOIN mipyme_usuario mu 
        ON mu.id_usuario = u.id_usuario

      LEFT JOIN mipyme m 
        ON m.id_mipyme = mu.id_mipyme
      AND COALESCE(m.estado, 'activo') != 'eliminado'

      LEFT JOIN activo a 
        ON a.id_mipyme = m.id_mipyme
      AND COALESCE(a.estado, 'activo') != 'eliminado'

      LEFT JOIN consumo c 
        ON c.id_mipyme = m.id_mipyme
      AND COALESCE(c.estado, 'activo') != 'eliminado'

      LEFT JOIN diagnostico d 
        ON d.id_mipyme = m.id_mipyme
      AND COALESCE(d.estado, 'activo') != 'eliminado'

      -- ✅ SUBQUERY PLANES
      LEFT JOIN (
        SELECT
          planes_por_mipyme.id_mipyme,
          jsonb_agg(
            jsonb_build_object(
              'id_plan_trabajo', planes_por_mipyme.id_plan_trabajo,
              'nombre_plan_trabajo', planes_por_mipyme.nombre_plan_trabajo,
              'descripcion', planes_por_mipyme.descripcion,
              'fecha_fin', planes_por_mipyme.fecha_fin,
              'estado', planes_por_mipyme.estado,
              'created_at', planes_por_mipyme.created_at,
              'total_tareas', planes_por_mipyme.total_tareas,
              'tareas_completadas', planes_por_mipyme.tareas_completadas,
              'porcentaje_completado', planes_por_mipyme.porcentaje_completado,
              'tareas', planes_por_mipyme.tareas
            )
            ORDER BY planes_por_mipyme.created_at DESC
          ) AS planes_trabajo
        FROM (
          SELECT
            pt.id_plan_trabajo,
            pt.nombre_plan_trabajo,
            pt.descripcion,
            pt.fecha_fin,
            pt.estado,
            pt.created_at,
            pt.id_mipyme,

            COALESCE(
              jsonb_agg(
                DISTINCT jsonb_build_object(
                  'id_tarea', t.id_tarea,
                  'nombre_tarea', t.nombre_tarea,
                  'fecha_fin', t.fecha_fin,
                  'descripcion', t.descripcion,
                  'estado', t.estado,
                  'created_at', t.created_at
                )
              ) FILTER (WHERE t.id_tarea IS NOT NULL),
              '[]'::jsonb
            ) AS tareas,

            COUNT(t.id_tarea) AS total_tareas,

            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(t.estado, '')) = 'completada'
            ) AS tareas_completadas,

            CASE
              WHEN COUNT(t.id_tarea) = 0 THEN 0
              ELSE ROUND(
                (
                  COUNT(*) FILTER (
                    WHERE LOWER(COALESCE(t.estado, '')) = 'completada'
                  )::numeric
                  / COUNT(t.id_tarea)::numeric
                ) * 100
              )
            END AS porcentaje_completado

          FROM plan_trabajo pt
          LEFT JOIN tarea t
            ON t.id_plan_trabajo = pt.id_plan_trabajo

          WHERE COALESCE(pt.estado, 'activo') != 'eliminado'

          GROUP BY pt.id_plan_trabajo
        ) planes_por_mipyme
        GROUP BY planes_por_mipyme.id_mipyme
      ) planes_data
        ON planes_data.id_mipyme = m.id_mipyme

      WHERE u.id_usuario = $1

      GROUP BY 
        u.id_usuario,
        m.id_mipyme,
        planes_data.planes_trabajo;
      `,
      [idUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    const row = result.rows[0];

    return res.status(200).json({
      user: {
        id_usuario: row.id_usuario,
        documento: row.documento,
        nombre_usuario: row.nombre_usuario,
        email: row.email,
        telefono: row.telefono,
        estado: row.estado,
        created_at: row.created_at,
      },

      cliente: {
        id_cliente: row.id_usuario,
      },

      mipyme: row.id_mipyme
        ? {
            id_mipyme: row.id_mipyme,
            nombre_mipyme: row.nombre_mipyme,
            nit: row.nit,
            sector_economico: row.sector_economico,
            direccion: row.direccion,
            departamento: row.departamento,
            municipio: row.municipio,
            barrio: row.barrio,
            estrato: row.estrato,
            descripcion_empresa: row.descripcion_empresa,
            cantidad_empleados: row.cantidad_empleados,
            ingresos: row.ingresos,
            egresos: row.egresos,
            codigo_ciiu: row.codigo_ciiu,
            tipo_persona: row.tipo_persona,
            tipo_empresa: row.tipo_empresa,
            estado: row.estado_mipyme,
          }
        : null,

      activos: row.activos ?? [],
      facturas: row.facturas ?? [],
      diagnosticos: row.diagnosticos ?? [],
      planes_trabajo: row.planes_trabajo ?? [],
    });

  } catch (err) {
    console.error('Error al obtener cliente completo:', err);
    return res.status(500).json({
      error: 'Error interno',
    });
  }
}


async function createMipyme(req, res) {
  const {
    id_usuario,
    tipo_relacion,

    nombre_mipyme,
    nit,
    sector_economico,
    direccion,
    municipio,
    descripcion_empresa,
    cantidad_empleados,
    ingresos,
    egresos,
    codigo_ciiu,

    created_by,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ✅ VALIDACIONES
    if (!id_usuario || !created_by) {
      return res.status(400).json({
        error: 'id_usuario y created_by son obligatorios'
      });
    }

    const exists = await client.query(
      `SELECT id_usuario FROM usuario WHERE id_usuario = $1`,
      [id_usuario]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    // ✅ CREAR MIPYME
    const result = await client.query(
      `
      INSERT INTO mipyme (
        nombre_mipyme,
        nit,
        sector_economico,
        direccion,
        municipio,
        descripcion_empresa,
        cantidad_empleados,
        ingresos,
        egresos,
        codigo_ciiu,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        'activo',
        NOW(),
        NULL,
        $11,
        NULL
      )
      RETURNING id_mipyme
      `,
      [
        nombre_mipyme ?? null,
        nit ?? null,
        sector_economico ?? null,
        direccion ?? null,
        municipio ?? null,
        descripcion_empresa ?? null,
        cantidad_empleados ?? null,
        ingresos ?? null,
        egresos ?? null,
        codigo_ciiu ?? null,
        created_by
      ]
    );

    const idMipyme = result.rows[0].id_mipyme;

    // ✅ RELACIÓN CORRECTA (SIN id_cliente)
    await client.query(
      `
      INSERT INTO mipyme_usuario (
        id_usuario,
        id_mipyme,
        tipo_relacion
      )
      VALUES ($1, $2, $3)
      `,
      [
        id_usuario,                 // ✅ usuario cliente
        idMipyme,                  // ✅ mipyme creada
        tipo_relacion ?? 'propietario'
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Mipyme creada correctamente',
      id_mipyme: idMipyme
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear mipyme:', err);

    return res.status(500).json({
      error: err.message || 'Error interno',
    });

  } finally {
    client.release();
  }
}

async function updateMipyme(req, res) {
  const idMipyme = Number(req.params.id);

  const {
    nombre_mipyme,
    nit,
    sector_economico,

    departamento,
    municipio,
    barrio,
    direccion,

    descripcion_empresa,
    cantidad_empleados,
    ingresos,
    egresos,
    codigo_ciiu,

    estrato,
    tipo_persona,
    tipo_empresa,

    estado,
    updated_by,
  } = req.body;

  try {

    if (Number.isNaN(idMipyme)) {
      return res.status(400).json({
        error: 'El id de la mipyme debe ser numérico',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        error: 'updated_by es obligatorio',
      });
    }

    const currentResult = await pool.query(
      `
      SELECT *
      FROM mipyme
      WHERE id_mipyme = $1
      `,
      [idMipyme]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada',
      });
    }

    const current = currentResult.rows[0];

    /// ✅ helper
    const clean = (value) => {
      if (value === undefined) return undefined;

      if (
        value === null ||
        (typeof value === 'string' &&
          value.trim() === '')
      ) {
        return null;
      }

      return typeof value === 'string'
        ? value.trim()
        : value;
    };

    /// ==========================
    /// VALIDACIONES
    /// ==========================

    const tipoPersonaFinal =
      tipo_persona ?? current.tipo_persona;

    const nitFinal =
      nit !== undefined
        ? clean(nit)
        : current.nit;

    if (
      nit !== undefined &&
      nitFinal !== null &&
      !isDocumentoONit(nitFinal)
    ) {
      return res.status(400).json({
        error:
          'El NIT debe tener entre 6 y 10 dígitos',
      });
    }

    if (
      tipoPersonaFinal === 'Jurídica' &&
      !nitFinal
    ) {
      return res.status(400).json({
        error:
          'Las personas jurídicas deben tener NIT',
      });
    }

    if (
      tipoPersonaFinal === 'Jurídica' &&
      !isNitJuridico(nitFinal)
    ) {
      return res.status(400).json({
        error:
          'El NIT de una persona jurídica debe tener exactamente 9 dígitos',
      });
    }

    if (
      cantidad_empleados !== undefined &&
      cantidad_empleados !== null &&
      !isNumber(cantidad_empleados)
    ) {
      return res.status(400).json({
        error:
          'cantidad_empleados debe ser numérico',
      });
    }

    if (
      ingresos !== undefined &&
      ingresos !== null &&
      !isNumber(ingresos)
    ) {
      return res.status(400).json({
        error:
          'ingresos debe ser numérico',
      });
    }

    if (
      egresos !== undefined &&
      egresos !== null &&
      !isNumber(egresos)
    ) {
      return res.status(400).json({
        error:
          'egresos debe ser numérico',
      });
    }

    if (estrato !== undefined) {

      const e =
        estrato !== null
          ? Number(estrato)
          : null;

      if (
        e != null &&
        (isNaN(e) || e < 1 || e > 6)
      ) {
        return res.status(400).json({
          error:
            'estrato debe ser un número entre 1 y 6',
        });
      }
    }

    const nombreMipymeFinal =
      nombre_mipyme !== undefined
        ? clean(nombre_mipyme)
        : current.nombre_mipyme;

    if (!nombreMipymeFinal) {
      return res.status(400).json({
        error: 'El nombre de la mipyme es obligatorio',
      });
    }

    /// ==========================
    /// ARMAR UPDATE
    /// ==========================

    const fields = [];
    const values = [];
    let index = 1;

    const add = (field, value) => {
      fields.push(
        `${field} = $${index}`
      );

      values.push(value);

      index++;
    };

    /// ✅ ahora SI actualiza NULL
    if (nombre_mipyme !== undefined)
      add(
        'nombre_mipyme',
        clean(nombre_mipyme)
      );

    if (nit !== undefined)
      add(
        'nit',
        clean(nit)
      );

    if (sector_economico !== undefined)
      add(
        'sector_economico',
        clean(sector_economico)
      );

    if (departamento !== undefined)
      add(
        'departamento',
        clean(departamento)
      );

    if (municipio !== undefined)
      add(
        'municipio',
        clean(municipio)
      );

    if (barrio !== undefined)
      add(
        'barrio',
        clean(barrio)
      );

    if (direccion !== undefined)
      add(
        'direccion',
        clean(direccion)
      );

    if (descripcion_empresa !== undefined)
      add(
        'descripcion_empresa',
        clean(descripcion_empresa)
      );

    if (cantidad_empleados !== undefined)
      add(
        'cantidad_empleados',
        cantidad_empleados ?? null
      );

    if (ingresos !== undefined)
      add(
        'ingresos',
        ingresos ?? null
      );

    if (egresos !== undefined)
      add(
        'egresos',
        egresos ?? null
      );

    if (codigo_ciiu !== undefined)
      add(
        'codigo_ciiu',
        clean(codigo_ciiu)
      );

    if (tipo_persona !== undefined)
      add(
        'tipo_persona',
        clean(tipo_persona)
      );
    if (tipo_empresa !== undefined)
      add(
        'tipo_empresa',
        clean(tipo_empresa)
      );

    if (estrato !== undefined)
      add(
        'estrato',
        estrato != null
          ? Number(estrato)
          : null
      );

    if (estado !== undefined)
      add(
        'estado',
        estado
      );

    fields.push(
      'updated_at = NOW()'
    );

    add(
      'updated_by',
      updated_by
    );

    const result = await pool.query(
      `
      UPDATE mipyme
      SET ${fields.join(', ')}
      WHERE id_mipyme = $${index}
      RETURNING *
      `,
      [
        ...values,
        idMipyme,
      ]
    );

    return res.status(200).json({
      message:
        'Mipyme actualizada correctamente',
      mipyme:
        result.rows[0],
    });

  } catch (err) {

    console.error(
      'Error al actualizar mipyme:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al actualizar mipyme',
    });
  }
}

async function getPreviewInfoClient(req, res) {
  const idUsuario = Number(req.params.id);

  try {
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    const result = await pool.query(
      `
      SELECT
        -- ✅ USUARIO
        u.id_usuario,
        u.documento,
        u.nombre_usuario,
        u.email,
        u.telefono,
        u.estado,
        u.created_at,

        -- ✅ MIPYME
        m.id_mipyme,
        m.nombre_mipyme,
        m.nit,
        m.tipo_persona,
        m.sector_economico,
        m.direccion,
        m.departamento,
        m.municipio,
        m.barrio,
        m.descripcion_empresa,
        m.cantidad_empleados,
        m.ingresos,
        m.egresos,
        m.codigo_ciiu,
        m.tipo_empresa,
        m.estado AS estado_mipyme,

        -- ✅ ACTIVOS CON TODA INFO + IMÁGENES
        activos_data.activos,

        -- ✅ CONSUMOS CON TODA INFO + IMÁGENES
        consumos_data.consumos

      FROM usuario u

      LEFT JOIN mipyme_usuario mu 
        ON mu.id_usuario = u.id_usuario

      LEFT JOIN mipyme m 
        ON m.id_mipyme = mu.id_mipyme
       AND COALESCE(m.estado, 'activo') != 'eliminado'

      -- 🔥 ACTIVOS COMPLETOS
      LEFT JOIN (
        SELECT
          a.id_mipyme,

          jsonb_agg(
            jsonb_build_object(
              'id_activo', a.id_activo,
              'nombre', a.nombre,
              'tipo', a.tipo,
              'marca', a.marca,
              'modelo', a.modelo,
              'descripcion', a.descripcion,
              'datos', a.datos,
              'estado', a.estado,
              'id_mipyme', a.id_mipyme,
              'created_at', a.created_at,
              'updated_at', a.updated_at,
              'created_by', a.created_by,
              'updated_by', a.updated_by,
              'imagenes', COALESCE(imgs.imagenes, '[]'::jsonb)
            )
            ORDER BY a.created_at DESC
          ) AS activos

        FROM activo a

        LEFT JOIN (
          SELECT
            aa.id_activo,
            jsonb_agg(
              jsonb_build_object(
                'id_archivo', ar.id_archivo,
                'nombre_original', ar.nombre_original,
                'nombre_fisico', ar.nombre_fisico,
                'extension', ar.extension,
                'mime', ar.mime,
                'ubicacion', ar.ubicacion
              )
              ORDER BY ar.id_archivo DESC
            ) AS imagenes
          FROM archivo_activo aa
          LEFT JOIN archivo ar 
            ON ar.id_archivo = aa.id_archivo
          GROUP BY aa.id_activo
        ) imgs 
          ON imgs.id_activo = a.id_activo

        WHERE COALESCE(a.estado, 'activo') != 'eliminado'
        GROUP BY a.id_mipyme
      ) activos_data 
        ON activos_data.id_mipyme = m.id_mipyme

      -- 🔥 CONSUMOS COMPLETOS
      LEFT JOIN (
        SELECT
          c.id_mipyme,

          jsonb_agg(
            jsonb_build_object(
              'id_consumo', c.id_consumo,
              'tipo', c.tipo,
              'proveedor', c.proveedor,
              'periodo_inicio', c.periodo_inicio,
              'periodo_fin', c.periodo_fin,
              'valor', c.valor,
              'consumo', c.consumo,
              'unidad', c.unidad,
              'observaciones', c.observaciones,
              'estado', c.estado,
              'id_mipyme', c.id_mipyme,
              'created_at', c.created_at,
              'updated_at', c.updated_at,
              'created_by', c.created_by,
              'updated_by', c.updated_by,
              'imagenes', COALESCE(imgs.imagenes, '[]'::jsonb)
            )
            ORDER BY c.created_at DESC
          ) AS consumos

        FROM consumo c

        LEFT JOIN (
          SELECT
            ca.id_consumo,
            jsonb_agg(
              jsonb_build_object(
                'id_archivo', ar.id_archivo,
                'nombre_original', ar.nombre_original,
                'nombre_fisico', ar.nombre_fisico,
                'extension', ar.extension,
                'mime', ar.mime,
                'ubicacion', ar.ubicacion
              )
              ORDER BY ar.id_archivo DESC
            ) AS imagenes
          FROM consumo_archivo ca
          LEFT JOIN archivo ar 
            ON ar.id_archivo = ca.id_archivo
          GROUP BY ca.id_consumo
        ) imgs 
          ON imgs.id_consumo = c.id_consumo

        WHERE COALESCE(c.estado, 'activo') != 'eliminado'
        GROUP BY c.id_mipyme
      ) consumos_data 
        ON consumos_data.id_mipyme = m.id_mipyme

      WHERE u.id_usuario = $1

      GROUP BY 
        u.id_usuario,
        m.id_mipyme,
        activos_data.activos,
        consumos_data.consumos;
      `,
      [idUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    const row = result.rows[0];

    return res.status(200).json({
      user: {
        id_usuario: row.id_usuario,
        documento: row.documento,
        nombre_usuario: row.nombre_usuario,
        email: row.email,
        telefono: row.telefono,
        estado: row.estado,
        created_at: row.created_at,
      },

      cliente: {
        id_cliente: row.id_usuario,
      },

      mipyme: row.id_mipyme
        ? {
            id_mipyme: row.id_mipyme,
            nombre_mipyme: row.nombre_mipyme,
            nit: row.nit,
            sector_economico: row.sector_economico,
            direccion: row.direccion,
            departamento: row.departamento,
            municipio: row.municipio,
            barrio: row.barrio,
            descripcion_empresa: row.descripcion_empresa,
            cantidad_empleados: row.cantidad_empleados,
            ingresos: row.ingresos,
            egresos: row.egresos,
            codigo_ciiu: row.codigo_ciiu,
            tipo_empresa: row.tipo_empresa,
            estado: row.estado_mipyme,
          }
        : null,

      activos: row.activos ?? [],
      facturas: row.consumos ?? [],
    });

  } catch (err) {
    console.error('Error al obtener preview del cliente:', err);
    return res.status(500).json({
      error: 'Error interno',
    });
  }
}

async function getMipymeByUsuario(req, res) {
  const idUsuario = Number(req.params.id);

  try {
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

    const result = await pool.query(
      `
      SELECT
        m.id_mipyme,
        m.nombre_mipyme,
        m.nit,
        m.sector_economico,
        m.direccion,
        m.municipio,
        m.descripcion_empresa,
        m.cantidad_empleados,
        m.ingresos,
        m.egresos,
        m.codigo_ciiu,
        m.estado,
        m.created_at,
        m.updated_at,
        m.created_by,
        m.updated_by

      FROM mipyme_usuario mu
      INNER JOIN mipyme m
        ON m.id_mipyme = mu.id_mipyme

      WHERE mu.id_usuario = $1
      `,
      [idUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Mipyme no encontrada para este usuario',
      });
    }

    return res.status(200).json({
      mipyme: result.rows[0],
    });

  } catch (err) {
    console.error('Error al obtener mipyme:', err);

    return res.status(500).json({
      error: 'Error interno al obtener mipyme',
    });
  }
}

async function getActivosByUsuario(req, res) {
  const idUsuario = Number(req.params.id);

  try {
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

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
            FROM archivo_activo aa
            LEFT JOIN archivo ar
              ON ar.id_archivo = aa.id_archivo
            WHERE aa.id_activo = a.id_activo
          ),
          '[]'::jsonb
        ) AS imagenes

      FROM mipyme_usuario mu
      INNER JOIN activo a
        ON a.id_mipyme = mu.id_mipyme
        AND COALESCE(a.estado, 'activo') != 'eliminado'

      WHERE mu.id_usuario = $1
      ORDER BY a.created_at DESC
      `,
      [idUsuario]
    );

    return res.status(200).json({
      activos: result.rows,
    });

  } catch (err) {
    console.error('Error al obtener activos:', err);

    return res.status(500).json({
      error: 'Error interno al obtener activos',
    });
  }
}

async function getConsumosByUsuario(req, res) {
  const idUsuario = Number(req.params.id);

  try {
    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id debe ser numérico',
      });
    }

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
        c.estado,
        c.id_mipyme,
        c.created_at,
        c.updated_at,
        c.created_by,
        c.updated_by,

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
            FROM consumo_archivo ca
            LEFT JOIN archivo ar
              ON ar.id_archivo = ca.id_archivo
            WHERE ca.id_consumo = c.id_consumo
          ),
          '[]'::jsonb
        ) AS imagenes

      FROM mipyme_usuario mu
      INNER JOIN consumo c
        ON c.id_mipyme = mu.id_mipyme
        AND COALESCE(c.estado, 'activo') != 'eliminado'

      WHERE mu.id_usuario = $1
      ORDER BY c.created_at DESC
      `,
      [idUsuario]
    );

    return res.status(200).json({
      consumos: result.rows,
    });

  } catch (err) {
    console.error('Error al obtener consumos:', err);

    return res.status(500).json({
      error: 'Error interno al obtener consumos',
    });
  }
}

const isEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isPhone = (telefono) => {
  // Colombia: 10 dígitos (ej: 3XX)
  return /^3\d{9}$/.test(telefono);
};

const isNit = (nit) => {
  // Simple: números + posible guion (ej: 900123456-7)
  return /^\d{6,12}(-\d)?$/.test(nit);
};

const isNumber = (value) => {
  return !isNaN(value) && value !== null && value !== '';
};


async function createClientWithMipyme(req, res) {
  const {
    documento,
    nombre_usuario,
    email,
    telefono,

    nombre_mipyme,
    nit,
    sector_economico,
    departamento,
    municipio,
    barrio,
    direccion,
    descripcion_empresa,
    cantidad_empleados,
    tipo_persona,
    ingresos,
    egresos,
    codigo_ciiu,
    estrato,
    tipo_empresa,

    tipo_relacion,
    created_by,
  } = req.body;

  const client = await pool.connect();

  // ✅ helper local para limpiar strings vacíos
  const clean = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return typeof value === 'string' ? value.trim() : value;
  };

  try {
    await client.query('BEGIN');

    /// ✅ VALIDACIONES
    if (!documento || !nombre_usuario || !email) {
      return res.status(400).json({
        error: 'documento, nombre del usuario y email son obligatorios',
      });
    }

    if (!nombre_mipyme || String(nombre_mipyme).trim() === '') {
      return res.status(400).json({
        error: 'El nombre de la empresa es obligatorio',
      });
    }

    if (!created_by) {
      return res.status(400).json({
        error: 'created_by es obligatorio',
      });
    }

    if (!isEmail(email)) {
      return res.status(400).json({
        error: 'Email inválido',
      });
    }
    if (!isDocumentoONit(documento)) {
      return res.status(400).json({
        error: 'El documento debe tener entre 6 y 10 dígitos',
      });
    }

    if (nit && !isDocumentoONit(nit)) {
      return res.status(400).json({
        error: 'El NIT debe tener entre 6 y 10 dígitos',
      });
    }

    if (
      tipo_persona === 'Jurídica' &&
      !nit
    ) {
      return res.status(400).json({
        error: 'Las personas jurídicas deben tener NIT',
      });
    }

    if (
      tipo_persona === 'Jurídica' &&
      !isNitJuridico(nit)
    ) {
      return res.status(400).json({
        error: 'El NIT de una persona jurídica debe tener exactamente 9 dígitos',
      });
    }

    if (telefono && !isPhone(telefono)) {
      return res.status(400).json({
        error: 'Teléfono inválido',
      });
    }

    if (nit && !isNit(nit)) {
      return res.status(400).json({
        error: 'NIT inválido',
      });
    }

    if (cantidad_empleados != null && !isNumber(cantidad_empleados)) {
      return res.status(400).json({
        error: 'cantidad_empleados debe ser numérico',
      });
    }

    if (ingresos != null && !isNumber(ingresos)) {
      return res.status(400).json({
        error: 'ingresos debe ser numérico',
      });
    }

    if (egresos != null && !isNumber(egresos)) {
      return res.status(400).json({
        error: 'egresos debe ser numérico',
      });
    }

    if (estrato != null) {
      const e = Number(estrato);

      if (Number.isNaN(e) || e < 1 || e > 6) {
        return res.status(400).json({
          error: 'estrato debe ser un número entre 1 y 6',
        });
      }
    }

    if (String(nombre_usuario).trim() === '') {
      return res.status(400).json({
        error: 'nombre_usuario vacío',
      });
    }

    if (estrato != null) {
      const e = Number(estrato);
      if (isNaN(e) || e < 1 || e > 6) {
        return res.status(400).json({
          error: 'estrato debe ser 1-6',
        });
      }
    }

    /// ✅ CIIU → sector económico
    let sectorEconomicoFinal = null;

    if (codigo_ciiu) {
      const ciiuItem = findCiiuByCode(String(codigo_ciiu).trim());
      sectorEconomicoFinal =
        ciiuItem?.nombre ||
        ciiuItem?.descripcion ||
        ciiuItem?.actividad ||
        null;
    } else {
      sectorEconomicoFinal = clean(sector_economico);
    }

    /// ✅ ROL CLIENTE
    const rolResult = await client.query(
      `SELECT id_rol FROM rol WHERE nombre_rol = $1 AND estado = 'activo'`,
      ['Cliente']
    );

    if (rolResult.rows.length === 0) {
      return res.status(500).json({
        error: 'Rol Cliente no existe',
      });
    }

    const idRolCliente = rolResult.rows[0].id_rol;

    /// ✅ EMAIL DUPLICADO
    const emailExists = await client.query(
      `SELECT id_usuario FROM usuario WHERE email = $1`,
      [String(email).trim()]
    );

    if (emailExists.rows.length > 0) {
      return res.status(409).json({
        error: 'Email ya registrado',
      });
    }

    /// ✅ PASSWORD = DOCUMENTO
    const hashedPassword = await bcrypt.hash(String(documento).trim(), 10);

    /// ✅ CREAR USUARIO
    const userResult = await client.query(
      `
      INSERT INTO usuario (
        documento,
        nombre_usuario,
        email,
        telefono,
        password_hash,
        id_rol,
        estado,
        created_at,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'activo', NOW(), $7)
      RETURNING *
      `,
      [
        String(documento).trim(),
        String(nombre_usuario).trim(),
        String(email).trim(),
        clean(telefono),
        hashedPassword,
        idRolCliente,
        created_by,
      ]
    );

    const user = userResult.rows[0];

    /// ✅ CREAR MIPYME (con nuevos campos)
    const mipymeResult = await client.query(
      `
      INSERT INTO mipyme (
        nombre_mipyme,
        nit,
        sector_economico,
        departamento,
        municipio,
        barrio,
        direccion,
        descripcion_empresa,
        cantidad_empleados,
        ingresos,
        egresos,
        codigo_ciiu,
        estrato,
        tipo_persona,
        tipo_empresa,
        estado,
        created_at,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        'activo',
        NOW(),
        $16
      )
      RETURNING *
      `,
      [
        clean(nombre_mipyme),
        clean(nit),
        sectorEconomicoFinal,
        clean(departamento),
        clean(municipio),
        clean(barrio),
        clean(direccion),
        clean(descripcion_empresa),
        cantidad_empleados ?? null,
        ingresos ?? null,
        egresos ?? null,
        clean(codigo_ciiu),
        estrato ?? null,
        tipo_persona ?? null,
        tipo_empresa ?? null,
        created_by,
      ]
    );

    const mipyme = mipymeResult.rows[0];

    /// ✅ RELACIÓN
    await client.query(
      `
      INSERT INTO mipyme_usuario (id_usuario, id_mipyme, tipo_relacion)
      VALUES ($1, $2, $3)
      `,
      [user.id_usuario, mipyme.id_mipyme, tipo_relacion || 'propietario']
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Cliente y mipyme creados correctamente',
      user,
      mipyme,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);

    return res.status(500).json({
      error: err.message || 'Error interno',
    });

  } finally {
    client.release();
  }
}

// PATCH /api/client/:id/inactivar

async function inactiveClient(req, res) {
  const idUsuario = Number(req.params.id);

  const updated_by = req.user.id_usuario;

  try {

    if (Number.isNaN(idUsuario)) {
      return res.status(400).json({
        error: 'El id del cliente debe ser numérico',
      });
    }

    const exists = await pool.query(
      `
      SELECT u.id_usuario
      FROM usuario u
      JOIN rol r
        ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1
        AND r.nombre_rol = 'Cliente'
      `,
      [idUsuario]
    );

    if (exists.rows.length === 0) {
      return res.status(404).json({
        error: 'Cliente no encontrado',
      });
    }

    const result = await pool.query(
      `
      UPDATE usuario
      SET
        estado = 'inactivo',
        updated_at = NOW(),
        updated_by = $1
      WHERE id_usuario = $2
      RETURNING
        id_usuario,
        nombre_usuario,
        email,
        estado,
        updated_at,
        updated_by
      `,
      [
        updated_by,
        idUsuario,
      ]
    );

    return res.status(200).json({
      message: 'Cliente inactivado correctamente',
      client: result.rows[0],
    });

  } catch (err) {

    console.error(
      'Error al inactivar cliente:',
      err
    );

    return res.status(500).json({
      error: 'Error interno',
    });
  }
}

async function searchClientByNitOrDocumento(req, res) {

  const query = String(
    req.query.nro || ''
  ).trim();

  try {

    if (!query) {
      return res.status(400).json({
        error: 'Debe enviar nro'
      });
    }

    const result = await pool.query(
      `
      SELECT
        u.*,

        m.id_mipyme,
        m.nombre_mipyme,
        m.nit,
        m.tipo_persona,
        m.sector_economico,
        m.departamento,
        m.municipio,
        m.barrio,
        m.direccion,
        m.descripcion_empresa,
        m.cantidad_empleados,
        m.ingresos,
        m.egresos,
        m.codigo_ciiu,
        m.estrato,
        m.estado AS estado_mipyme

      FROM usuario u

      INNER JOIN mipyme_usuario mu
        ON mu.id_usuario = u.id_usuario

      INNER JOIN mipyme m
        ON m.id_mipyme = mu.id_mipyme

      WHERE
        u.documento = $1
        OR m.nit = $1

      LIMIT 1
      `,
      [query],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Cliente no encontrado'
      });
    }

    return res.status(200).json({
      cliente: result.rows[0]
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: 'Error interno'
    });
  }
}



module.exports = {
  getClients,
  createClient,
  updateClient,
  getClienteFull,
  createMipyme,
  updateMipyme,
  getPreviewInfoClient,
  getMipymeByUsuario,
  getActivosByUsuario,
  getConsumosByUsuario,
  createClientWithMipyme,
  inactiveClient,
  searchClientByNitOrDocumento,
};