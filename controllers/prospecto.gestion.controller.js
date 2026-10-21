
'use strict';

const pool = require('../db');

const idValido = valor => {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const limpio = (valor, maximo) => {
  if (valor == null) return '';

  if (typeof valor !== 'string') {
    return null;
  }

  const resultado = valor.trim();

  return resultado.length <= maximo
    ? resultado
    : null;
};

// Registrar un prospecto con información declarada.
// No realiza ninguna evaluación financiera.
async function registrarManual(req, res) {
  const idUsuario = idValido(
    req.user?.id_usuario
  );

  if (!idUsuario) {
    return res.status(401).json({
      error: 'Sesion no valida'
    });
  }

  const campos = {
    documento: limpio(req.body?.documento, 20),
    nombres: limpio(req.body?.nombres, 120),
    apellidos: limpio(req.body?.apellidos, 120),
    telefono: limpio(req.body?.telefono, 30),
    correo: limpio(req.body?.correo, 150),
    nombre_negocio: limpio(
      req.body?.nombre_negocio, 180
    ),
    municipio: limpio(req.body?.municipio, 120),
    direccion_negocio: limpio(
      req.body?.direccion_negocio, 250
    )
  };

  if (
    Object.values(campos).some(v => v === null) ||
    !/^\d{5,15}$/.test(campos.documento) ||
    !campos.nombres ||
    (!campos.telefono && !campos.correo) ||
    (
      campos.correo &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        campos.correo
      )
    )
  ) {
    return res.status(400).json({
      error:
        'Revise documento (5 a 15 digitos), nombres, ' +
        'contacto y longitudes de los campos.'
    });
  }

  let db;

  try {
    db = await pool.connect();
    await db.query('BEGIN');

    // No registrar nuevamente un cliente
    // que ya existe en Finanzas Verdes.
    const local = await db.query(`
      SELECT (
        EXISTS (
          SELECT 1
          FROM public.usuario u
          JOIN public.rol r
            ON r.id_rol = u.id_rol
          WHERE u.documento = $1
            AND LOWER(r.nombre_rol) = 'cliente'
            AND u.estado IS DISTINCT FROM 'eliminado'
        )
        OR EXISTS (
          SELECT 1
          FROM public.mipyme m
          WHERE m.nit = $1
            AND m.estado IS DISTINCT FROM 'eliminado'
        )
      ) AS existe
    `, [campos.documento]);

    if (local.rows[0]?.existe) {
      await db.query('ROLLBACK');

      return res.status(409).json({
        error:
          'El documento ya tiene un registro local. ' +
          'Use la consulta de cliente existente.'
      });
    }

    const creado = await db.query(`
      INSERT INTO public.prospecto (
        documento,
        nombres,
        apellidos,
        telefono,
        correo,
        nombre_negocio,
        municipio,
        direccion_negocio,
        origen_datos,
        estado,
        id_asesor_usuario
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        'declarado', 'nuevo', $9
      )
      ON CONFLICT (documento) DO NOTHING
      RETURNING *
    `, [
      campos.documento,
      campos.nombres,
      campos.apellidos || null,
      campos.telefono || null,
      campos.correo || null,
      campos.nombre_negocio || null,
      campos.municipio || null,
      campos.direccion_negocio || null,
      idUsuario
    ]);

    if (!creado.rowCount) {
      await db.query('ROLLBACK');

      return res.status(409).json({
        error:
          'El documento ya está registrado como prospecto.'
      });
    }

    // Registrar el evento en la misma transacción.
    await db.query(`
      INSERT INTO public.prospecto_evento (
        id_prospecto,
        tipo_evento,
        detalle,
        id_usuario
      )
      VALUES (
        $1,
        'registro_manual',
        $2::jsonb,
        $3
      )
    `, [
      creado.rows[0].id_prospecto,
      JSON.stringify({
        origen: 'declarado'
      }),
      idUsuario
    ]);

    await db.query('COMMIT');

    return res.status(201).json({
      prospecto: creado.rows[0]
    });

  } catch (error) {
    if (db) {
      try {
        await db.query('ROLLBACK');
      } catch (_) {}
    }

    console.error(
      'Registrar prospecto:',
      error
    );

    return res.status(500).json({
      error:
        'No fue posible registrar el prospecto.'
    });

  } finally {
    if (db) db.release();
  }
}

// Consultar los prospectos del usuario autenticado.
async function listarProspectos(req, res) {
  const idUsuario = idValido(
    req.user?.id_usuario
  );

  if (!idUsuario) {
    return res.status(401).json({
      error: 'Sesion no valida'
    });
  }

  const page = idValido(req.query.page ?? 1);
  const limit = idValido(req.query.limit ?? 20);

  const estado = limpio(
    req.query.estado ?? '', 30
  );

  const search = limpio(
    req.query.search ?? '', 100
  );

  const estados = [
    'nuevo',
    'en_gestion',
    'agendado',
    'descartado',
    'convertido'
  ];

  if (
    !page ||
    !limit ||
    limit > 100 ||
    estado === null ||
    search === null ||
    (estado && !estados.includes(estado))
  ) {
    return res.status(400).json({
      error: 'Filtros invalidos.'
    });
  }

  try {
    const params = [
      idUsuario,
      estado || null,
      search || null
    ];

    const where = `
      FROM public.prospecto p
      WHERE p.id_asesor_usuario = $1
        AND ($2::text IS NULL OR p.estado = $2)
        AND (
          $3::text IS NULL
          OR p.documento ILIKE '%' || $3 || '%'
          OR p.nombres ILIKE '%' || $3 || '%'
          OR COALESCE(p.nombre_negocio, '')
             ILIKE '%' || $3 || '%'
        )
    `;

    const [total, listado] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total ${where}`,
        params
      ),

      pool.query(`
        SELECT
          p.id_prospecto,
          p.documento,
          p.nombres,
          p.apellidos,
          p.telefono,
          p.correo,
          p.nombre_negocio,
          p.municipio,
          p.direccion_negocio,
          p.origen_datos,
          p.estado,
          p.motivo_descarte_codigo,
          p.motivo_descarte,
          p.id_mipyme,
          p.created_at,
          p.updated_at
        ${where}
        ORDER BY
          p.created_at DESC,
          p.id_prospecto DESC
        LIMIT $4 OFFSET $5
      `, [
        ...params,
        limit,
        (page - 1) * limit
      ])
    ]);

    const n = Number(
      total.rows[0].total
    );

    return res.json({
      prospectos: listado.rows,

      pagination: {
        page,
        limit,
        total: n,
        total_pages: Math.max(
          1,
          Math.ceil(n / limit)
        )
      }
    });

  } catch (error) {
    console.error(
      'Listar prospectos:',
      error
    );

    return res.status(500).json({
      error:
        'No fue posible listar prospectos.'
    });
  }
}

// Cambiar el estado comercial del prospecto.
// Agendamiento y conversión tendrán operaciones propias.
async function actualizarDecision(req, res) {
  const idUsuario = idValido(
    req.user?.id_usuario
  );

  const id = idValido(
    req.params.idProspecto
  );

  if (!idUsuario) {
    return res.status(401).json({
      error: 'Sesion no valida'
    });
  }

  if (!id) {
    return res.status(400).json({
      error: 'Prospecto invalido.'
    });
  }

  const decision = limpio(
    req.body?.decision, 30
  );

  const motivo = limpio(
    req.body?.motivo, 2000
  );

  const motivoCodigo = limpio(
    req.body?.motivo_codigo ?? 'otro', 80
  );

  if (
    !['en_gestion', 'descartado'].includes(decision) ||
    motivo === null ||
    motivoCodigo === null ||
    (decision === 'descartado' && !motivo)
  ) {
    return res.status(400).json({
      error:
        'Solo se admite en_gestion o descartado. ' +
        'El descarte requiere motivo.'
    });
  }

  let db;

  try {
    db = await pool.connect();
    await db.query('BEGIN');

    const actual = await db.query(`
      SELECT
        id_prospecto,
        id_asesor_usuario,
        estado
      FROM public.prospecto
      WHERE id_prospecto = $1
      FOR UPDATE
    `, [id]);

    if (
      !actual.rowCount ||
      Number(
        actual.rows[0].id_asesor_usuario
      ) !== idUsuario
    ) {
      await db.query('ROLLBACK');

      return res.status(404).json({
        error: 'Prospecto no encontrado.'
      });
    }

    const antes = actual.rows[0].estado;

    if (
      !['nuevo', 'en_gestion'].includes(antes)
    ) {
      await db.query('ROLLBACK');

      return res.status(409).json({
        error:
          'El prospecto ya tiene un estado final ' +
          'o agendado.'
      });
    }

    if (antes === decision) {
      await db.query('COMMIT');

      return res.json({
        actualizado: false,
        estado: antes
      });
    }

    const nuevo = await db.query(`
      UPDATE public.prospecto
      SET
        estado = $1,

        motivo_descarte = CASE
          WHEN $1 = 'descartado' THEN $2
          ELSE NULL
        END,

        motivo_descarte_codigo = CASE
          WHEN $1 = 'descartado' THEN $3
          ELSE NULL
        END,

        updated_at = NOW()
      WHERE id_prospecto = $4
      RETURNING *
    `, [
      decision,
      motivo || null,
      motivoCodigo || null,
      id
    ]);

    await db.query(`
      INSERT INTO public.prospecto_evento (
        id_prospecto,
        tipo_evento,
        detalle,
        id_usuario
      )
      VALUES (
        $1,
        'cambio_estado',
        $2::jsonb,
        $3
      )
    `, [
      id,
      JSON.stringify({
        anterior: antes,
        nuevo: decision,
        motivo: motivo || null
      }),
      idUsuario
    ]);

    await db.query('COMMIT');

    return res.json({
      actualizado: true,
      prospecto: nuevo.rows[0]
    });

  } catch (error) {
    if (db) {
      try {
        await db.query('ROLLBACK');
      } catch (_) {}
    }

    console.error(
      'Decision prospecto:',
      error
    );

    return res.status(500).json({
      error:
        'No fue posible actualizar el prospecto.'
    });

  } finally {
    if (db) db.release();
  }
}


async function obtenerHistorial(req, res) {
  const idProspecto = Number(
    req.params.idProspecto
  );

  const idUsuario = Number(
    req.user?.id_usuario
  );

  if (
    !Number.isSafeInteger(idUsuario) ||
    idUsuario <= 0
  ) {
    return res.status(401).json({
      error: 'Sesion no valida'
    });
  }

  if (
    !Number.isSafeInteger(idProspecto) ||
    idProspecto <= 0
  ) {
    return res.status(400).json({
      error: 'Prospecto invalido'
    });
  }

  try {
    // Verificar que el prospecto pertenece
    // al asesor autenticado.
    const permiso = await pool.query(`
      SELECT id_prospecto
      FROM public.prospecto
      WHERE id_prospecto = $1
        AND id_asesor_usuario = $2
    `, [
      idProspecto,
      idUsuario
    ]);

    if (!permiso.rowCount) {
      return res.status(404).json({
        error: 'Prospecto no encontrado'
      });
    }

    // Consultar eventos y usuario responsable.
    const resultado = await pool.query(`
      SELECT
        e.id_evento,
        e.tipo_evento,
        e.detalle,
        e.created_at,
        e.id_usuario,
        u.nombre_usuario AS registrado_por

      FROM public.prospecto_evento e

      LEFT JOIN public.usuario u
        ON u.id_usuario = e.id_usuario

      WHERE e.id_prospecto = $1

      ORDER BY
        e.created_at DESC,
        e.id_evento DESC

      LIMIT 100
    `, [idProspecto]);

    return res.status(200).json({
      id_prospecto: idProspecto,
      eventos: resultado.rows
    });

  } catch (error) {
    console.error(
      'Error al consultar historial:',
      error
    );

    return res.status(500).json({
      error:
        'No fue posible consultar el historial'
    });
  }
}


module.exports = {
  registrarManual,
  listarProspectos,
  actualizarDecision,
  obtenerHistorial
};
