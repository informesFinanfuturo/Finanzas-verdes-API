
'use strict';

const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');

const numero = x => {
  const n = Number(x);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const bloques = ['1', '3', '4', '5'];
const json = value => JSON.stringify(value);

// Obtener la versión vigente o una versión histórica.
async function obtenerFormulario(req, res) {
  const codigo = req.params.codigo || null;

  try {
    const version = await pool.query(`
      SELECT codigo, nombre
      FROM public.fve_formulario_ambiental
      WHERE (
        $1::text IS NOT NULL AND codigo = $1
      )
      OR (
        $1::text IS NULL AND vigente = true
      )
      LIMIT 1
    `, [codigo]);

    if (!version.rowCount) {
      return res.status(404).json({
        error: 'Formulario no disponible'
      });
    }

    const preguntas = await pool.query(`
      SELECT
        numero, bloque, texto, tipo, opciones, opcional
      FROM public.fve_pregunta_ambiental
      WHERE codigo_formulario = $1
      ORDER BY numero
    `, [version.rows[0].codigo]);

    return res.json({
      formulario: {
        ...version.rows[0],
        preguntas: preguntas.rows
      }
    });

  } catch (e) {
    console.error('Formulario ambiental:', e);

    return res.status(500).json({
      error: 'No se pudo obtener el formulario'
    });
  }
}

// Historial ambiental de una empresa.
async function listarEvaluaciones(req, res) {
  const idMipyme = numero(req.params.idMipyme);
  const idUsuario = numero(req.user?.id_usuario);

  if (!idMipyme || !idUsuario) {
    return res.status(400).json({
      error: 'Identificador invalido'
    });
  }

  try {
    if (!await accesoMipyme(pool, idMipyme, idUsuario)) {
      return res.status(403).json({
        error: 'No autorizado para esta empresa'
      });
    }

    const [historial, activos] = await Promise.all([
      pool.query(`
        SELECT
          id_visita AS id_evaluacion,
          version_formulario,
          fecha_visita AS fecha_evaluacion,
          estado,
          indice_ad07,
          created_at,
          finalized_at
        FROM public.fve_visita_ambiental
        WHERE id_mipyme = $1
        ORDER BY created_at DESC, id_visita DESC
      `, [idMipyme]),

      pool.query(`
        SELECT
          id_activo,
          nombre,
          tipo,
          cantidad,
          marca,
          modelo,
          datos
        FROM public.activo
        WHERE id_mipyme = $1
          AND estado IS DISTINCT FROM 'eliminado'
        ORDER BY id_activo
      `, [idMipyme])
    ]);

    return res.json({
      evaluaciones: historial.rows,
      activos: activos.rows
    });

  } catch (e) {
    console.error('Listar evaluaciones:', e);

    return res.status(500).json({
      error: 'No se pudieron consultar las evaluaciones'
    });
  }
}

// Leer una evaluación y sus respuestas históricas.
async function obtenerEvaluacion(req, res) {
  const id = numero(req.params.idEvaluacion);
  const idUsuario = numero(req.user?.id_usuario);

  if (!id || !idUsuario) {
    return res.status(400).json({
      error: 'Identificador invalido'
    });
  }

  try {
    const r = await pool.query(`
      SELECT *, id_visita AS id_evaluacion
      FROM public.fve_visita_ambiental
      WHERE id_visita = $1
    `, [id]);

    if (!r.rowCount) {
      return res.status(404).json({
        error: 'Evaluacion no encontrada'
      });
    }

    if (!await accesoMipyme(
      pool,
      r.rows[0].id_mipyme,
      idUsuario
    )) {
      return res.status(403).json({
        error: 'No autorizado para esta empresa'
      });
    }

    return res.json({
      evaluacion: r.rows[0]
    });

  } catch (e) {
    console.error('Obtener evaluacion:', e);

    return res.status(500).json({
      error: 'No se pudo consultar la evaluacion'
    });
  }
}

// Validar respuestas según la versión del cuestionario.
async function validarDatos(db, datos, version) {
  if (
    !datos ||
    typeof datos !== 'object' ||
    Array.isArray(datos) ||
    typeof datos.finalizar !== 'boolean' ||
    !datos.respuestas ||
    typeof datos.respuestas !== 'object' ||
    Array.isArray(datos.respuestas) ||
    !datos.puntajes ||
    typeof datos.puntajes !== 'object' ||
    Array.isArray(datos.puntajes)
  ) {
    throw new Error('Formato de evaluacion incorrecto');
  }

  if (
    datos.observacion_general != null &&
    (
      typeof datos.observacion_general !== 'string' ||
      datos.observacion_general.length > 5000
    )
  ) {
    throw new Error('Observacion general invalida');
  }

  const r = await db.query(`
    SELECT numero, tipo, opciones, opcional
    FROM public.fve_pregunta_ambiental
    WHERE codigo_formulario = $1
  `, [version]);

  if (r.rowCount !== 16) {
    throw new Error('Formulario ambiental incompleto');
  }

  const preguntas = new Map(
    r.rows.map(p => [String(p.numero), p])
  );

  for (const [id, respuesta] of Object.entries(
    datos.respuestas
  )) {
    const p = preguntas.get(id);

    if (!p) {
      throw new Error(`Pregunta ${id} desconocida`);
    }

    if (
      !respuesta ||
      typeof respuesta !== 'object' ||
      Array.isArray(respuesta)
    ) {
      throw new Error(
        `Respuesta ${id}: formato invalido`
      );
    }

    const valor = respuesta.valor ?? null;
    const observacion = respuesta.observacion ?? '';

    if (
      typeof observacion !== 'string' ||
      observacion.length > 2000
    ) {
      throw new Error(
        `Observacion invalida en pregunta ${id}`
      );
    }

    const opciones = p.opciones;

    if (!Array.isArray(opciones)) {
      throw new Error('Catalogo de opciones invalido');
    }

    if (p.tipo === 'informativa') {
      if (valor !== null) {
        throw new Error(
          `Pregunta ${id}: no se responde aun`
        );
      }
    } else if (p.tipo === 'unica') {
      if (
        valor !== null &&
        (
          typeof valor !== 'string' ||
          !opciones.includes(valor)
        )
      ) {
        throw new Error(
          `Respuesta ${id}: opcion invalida`
        );
      }
    } else if (p.tipo === 'multiple') {
      if (
        valor !== null &&
        (
          !Array.isArray(valor) ||
          !valor.every(
            x => typeof x === 'string' &&
                 opciones.includes(x)
          ) ||
          new Set(valor).size !== valor.length ||
          valor.length > opciones.length
        )
      ) {
        throw new Error(
          `Respuesta ${id}: opciones invalidas`
        );
      }

      if (
        Array.isArray(valor) &&
        valor.includes('No identifica') &&
        valor.length > 1
      ) {
        throw new Error(
          `Respuesta ${id}: No identifica no puede combinarse`
        );
      }
    }
  }

  
  // Las respuestas pueden estar incompletas en borrador.
  // Solo se exigen las obligatorias al finalizar.
  if (datos.finalizar) {
    const faltantes = [];

    for (const pregunta of r.rows) {
      if (
        pregunta.opcional === true ||
        pregunta.tipo === 'informativa'
      ) {
        continue;
      }

      const valor =
        datos.respuestas[String(pregunta.numero)]?.valor;

      const respondida =
        pregunta.tipo === 'unica'
          ? typeof valor === 'string' &&
            valor.trim().length > 0
          : pregunta.tipo === 'multiple'
            ? Array.isArray(valor) &&
              valor.length > 0
            : false;

      if (!respondida) {
        faltantes.push(pregunta.numero);
      }
    }

    if (faltantes.length > 0) {
      throw new Error(
        `Responda las preguntas obligatorias: ${faltantes.join(', ')}`
      );
    }
  }



  for (const [k, v] of Object.entries(datos.puntajes)) {
    if (
      !bloques.includes(k) ||
      !Number.isInteger(v) ||
      v < 0 ||
      v > 5
    ) {
      throw new Error(
        `Puntaje del bloque ${k} invalido (0 a 5)`
      );
    }
  }

  if (
    datos.finalizar &&
    !bloques.every(k =>
      Object.prototype.hasOwnProperty.call(
        datos.puntajes,
        k
      )
    )
  ) {
    throw new Error(
      'Para finalizar, califique los bloques 1, 3, 4 y 5'
    );
  }

  const indice = bloques.every(k =>
    Object.prototype.hasOwnProperty.call(datos.puntajes, k)
  )
    ? bloques.reduce(
        (s, k) => s + datos.puntajes[k], 0
      ) / 4
    : null;

  return {
    indice,
    observacion: datos.observacion_general ?? ''
  };
}

// Crear o actualizar una evaluación.
// La fecha viene del servidor, no de Flutter.
async function guardarEvaluacion(req, res) {
  const idMipymeRuta = numero(req.params.idMipyme);
  const idEvaluacion = numero(req.params.idEvaluacion);
  const idUsuario = numero(req.user?.id_usuario);

  if (
    !idUsuario ||
    (!idMipymeRuta && !idEvaluacion)
  ) {
    return res.status(400).json({
      error: 'Identificador invalido'
    });
  }

  let db;

  try {
    db = await pool.connect();
    await db.query('BEGIN');

    let idMipyme = idMipymeRuta;
    let version;

    if (idEvaluacion) {
      const actual = await db.query(`
        SELECT
          id_mipyme,
          estado,
          version_formulario
        FROM public.fve_visita_ambiental
        WHERE id_visita = $1
        FOR UPDATE
      `, [idEvaluacion]);

      if (!actual.rowCount) {
        await db.query('ROLLBACK');

        return res.status(404).json({
          error: 'Evaluacion no encontrada'
        });
      }

      if (actual.rows[0].estado !== 'borrador') {
        await db.query('ROLLBACK');

        return res.status(409).json({
          error:
            'Evaluacion finalizada: no se puede modificar'
        });
      }

      idMipyme = actual.rows[0].id_mipyme;
      version = actual.rows[0].version_formulario;
    }

    if (!await accesoMipyme(
      db, idMipyme, idUsuario
    )) {
      await db.query('ROLLBACK');

      return res.status(403).json({
        error: 'No autorizado para esta empresa'
      });
    }

    if (!version) {
      const v = await db.query(`
        SELECT codigo
        FROM public.fve_formulario_ambiental
        WHERE vigente = true
        LIMIT 1
      `);

      if (!v.rowCount) {
        throw new Error(
          'No hay formulario ambiental vigente'
        );
      }

      version = v.rows[0].codigo;
    }

    let validacion;

    try {
      validacion = await validarDatos(
        db,
        req.body,
        version
      );
    } catch (e) {
      await db.query('ROLLBACK');

      return res.status(400).json({
        error: e.message
      });
    }

    const datos = req.body;
    let inventario = null;

    if (datos.finalizar) {
      const a = await db.query(`
        SELECT
          id_activo,
          nombre,
          tipo,
          marca,
          modelo,
          cantidad,
          datos
        FROM public.activo
        WHERE id_mipyme = $1
          AND estado IS DISTINCT FROM 'eliminado'
        ORDER BY id_activo
      `, [idMipyme]);

      inventario = a.rows;
    }

    const parametros = [
      json(datos.respuestas),
      json(datos.puntajes),
      validacion.observacion,
      validacion.indice,
      datos.finalizar,
      inventario === null ? null : json(inventario),
      idUsuario
    ];

    let resultado;

    if (idEvaluacion) {
      resultado = await db.query(`
        UPDATE public.fve_visita_ambiental
        SET
          respuestas = $1::jsonb,
          puntajes = $2::jsonb,
          observacion_general = $3,
          indice_ad07 = $4,

          estado = CASE
            WHEN $5 THEN 'finalizada'
            ELSE 'borrador'
          END,

          inventario_snapshot = CASE
            WHEN $5 THEN $6::jsonb
            ELSE inventario_snapshot
          END,

          fecha_visita = CASE
            WHEN $5 THEN
              (now() AT TIME ZONE 'America/Bogota')::date
            ELSE fecha_visita
          END,

          finalized_at = CASE
            WHEN $5 THEN now()
            ELSE finalized_at
          END,

          updated_by = $7,
          updated_at = now()

        WHERE id_visita = $8

        RETURNING *, id_visita AS id_evaluacion
      `, [...parametros, idEvaluacion]);

    } else {
      resultado = await db.query(`
        INSERT INTO public.fve_visita_ambiental (
          id_mipyme,
          version_formulario,
          fecha_visita,
          respuestas,
          puntajes,
          observacion_general,
          indice_ad07,
          estado,
          inventario_snapshot,
          finalized_at,
          created_by
        )
        VALUES (
          $8,
          $9,
          (now() AT TIME ZONE 'America/Bogota')::date,
          $1::jsonb,
          $2::jsonb,
          $3,
          $4,

          CASE
            WHEN $5 THEN 'finalizada'
            ELSE 'borrador'
          END,

          $6::jsonb,

          CASE
            WHEN $5 THEN now()
            ELSE NULL
          END,

          $7
        )

        RETURNING *, id_visita AS id_evaluacion
      `, [...parametros, idMipyme, version]);
    }

    if (datos.finalizar) {
      await db.query(`
        INSERT INTO public.audit_log (
          id_usuario_actor,
          accion,
          entidad,
          id_entidad,
          datos_nuevos,
          motivo,
          ip,
          user_agent
        )
        VALUES (
          $1,
          'FVE_EVALUACION_AMBIENTAL_FINALIZADA',
          'fve_visita_ambiental',
          $2,
          $3::jsonb,
          'Cierre de evaluacion ambiental',
          $4,
          $5
        )
      `, [
        idUsuario,
        resultado.rows[0].id_evaluacion,
        json({
          indice_ad07: validacion.indice,
          version
        }),
        req.ip || null,
        req.get?.('user-agent') || null
      ]);
    }

    await db.query('COMMIT');

    return res.status(
      idEvaluacion ? 200 : 201
    ).json({
      evaluacion: resultado.rows[0]
    });

  } catch (e) {
    if (db) {
      try {
        await db.query('ROLLBACK');
      } catch (_) {}
    }

    console.error('Guardar evaluacion ambiental:', e);

    return res.status(500).json({
      error: 'No se pudo guardar la evaluacion'
    });

  } finally {
    if (db) db.release();
  }
}

module.exports = {
  obtenerFormulario,
  listarEvaluaciones,
  obtenerEvaluacion,
  guardarEvaluacion
};
