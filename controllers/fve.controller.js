
'use strict';

const { accesoMipyme } = require('../services/accesoMipyme');

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createFveHandlers(database) {

  async function iniciarProceso(req, res) {
    const idDiagnostico = parseId(
      req.body?.id_diagnostico
    );
    const idUsuario = parseId(
      req.user?.id_usuario
    );

    if (!idUsuario) {
      return res.status(401).json({
        error: 'Usuario no autenticado'
      });
    }

    if (!idDiagnostico) {
      return res.status(400).json({
        error: 'Diagnostico invalido'
      });
    }

    let db;

    try {
      db = await database.connect();
      await db.query('BEGIN');

      const d = await db.query(`
        SELECT
          d.id_diagnostico,
          d.id_mipyme,
          d.estado,
          m.estado AS estado_mipyme
        FROM public.diagnostico d
        JOIN public.mipyme m
          ON m.id_mipyme = d.id_mipyme
        WHERE d.id_diagnostico = $1
      `, [idDiagnostico]);

      if (!d.rowCount) {
        await db.query('ROLLBACK');

        return res.status(404).json({
          error: 'Diagnostico no encontrado'
        });
      }

      const diagnostico = d.rows[0];

      if (!await accesoMipyme(
        db,
        diagnostico.id_mipyme,
        idUsuario
      )) {
        await db.query('ROLLBACK');

        return res.status(403).json({
          error: 'No autorizado para esta empresa'
        });
      }

      if (
        diagnostico.estado !== 'activo' ||
        diagnostico.estado_mipyme === 'eliminado'
      ) {
        await db.query('ROLLBACK');

        return res.status(422).json({
          error:
            'Se requiere un diagnostico activo de una empresa vigente'
        });
      }

      
      const nuevo = await db.query(`
        INSERT INTO public.fve_proceso (
          id_diagnostico,
          id_mipyme,
          created_by,
          contexto_inicio,
          contexto_inicio_capturado_en
        )
        SELECT
          d.id_diagnostico,
          d.id_mipyme,
          $3,

          jsonb_build_object(
            'diagnostico', to_jsonb(d),

            'empresa', jsonb_build_object(
              'id_mipyme', m.id_mipyme,
              'nombre_mipyme', m.nombre_mipyme,
              'sector_economico', m.sector_economico,
              'municipio', m.municipio
            ),

            'activos', COALESCE((
              SELECT jsonb_agg(
                to_jsonb(a) ORDER BY a.id_activo
              )
              FROM public.activo a
              WHERE a.id_mipyme = d.id_mipyme
                AND a.estado IS DISTINCT FROM 'eliminado'
            ), '[]'::jsonb),

            'consumos', COALESCE((
              SELECT jsonb_agg(
                to_jsonb(c)
              )
              FROM (
                SELECT
                  id_consumo,
                  tipo,
                  proveedor,
                  periodo_inicio,
                  periodo_fin,
                  valor,
                  unidad,
                  consumo,
                  costo_unitario
                FROM public.consumo
                WHERE id_mipyme = d.id_mipyme
                  AND estado IS DISTINCT FROM 'eliminado'
                ORDER BY
                  periodo_inicio DESC NULLS LAST,
                  id_consumo DESC
                LIMIT 24
              ) c
            ), '[]'::jsonb),

            'evaluacion_ambiental', (
              SELECT to_jsonb(ev)
              FROM public.fve_visita_ambiental ev
              WHERE ev.id_mipyme = d.id_mipyme
                AND ev.estado = 'finalizada'
              ORDER BY
                ev.finalized_at DESC,
                ev.id_visita DESC
              LIMIT 1
            )
          ),

          now()

        FROM public.diagnostico AS d
        JOIN public.mipyme m
          ON m.id_mipyme = d.id_mipyme

        WHERE d.id_diagnostico = $1
          AND d.id_mipyme = $2

        ON CONFLICT (id_diagnostico) DO NOTHING

        RETURNING *
      `, [
        idDiagnostico,
        diagnostico.id_mipyme,
        idUsuario
      ]);


      const creado = nuevo.rowCount > 0;

      const proceso = creado
        ? nuevo.rows[0]
        : (await db.query(`
            SELECT *
            FROM public.fve_proceso
            WHERE id_diagnostico = $1
          `, [idDiagnostico])).rows[0];

      if (creado) {
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
            'FVE_PROCESO_INICIADO',
            'fve_proceso',
            $2,
            $3::jsonb,
            'Inicio desde diagnostico',
            $4,
            $5
          )
        `, [
          idUsuario,
          proceso.id_proceso,
          JSON.stringify({
            id_diagnostico: idDiagnostico,
            id_mipyme: diagnostico.id_mipyme
          }),
          req.ip || null,
          req.get?.('user-agent') || null
        ]);
      }

      await db.query('COMMIT');

      return res.status(
        creado ? 201 : 200
      ).json({
        creado,
        proceso
      });

    } catch (e) {
      if (db) {
        try {
          await db.query('ROLLBACK');
        } catch (_) {}
      }

      console.error('Inicio FVE:', e);

      return res.status(500).json({
        error: 'No fue posible iniciar el proceso FVE'
      });

    } finally {
      if (db) db.release();
    }
  }

  async function listarPorMipyme(req, res) {
    const idMipyme = parseId(req.params.idMipyme);
    const idUsuario = parseId(req.user?.id_usuario);

    if (!idMipyme || !idUsuario) {
      return res.status(400).json({
        error: 'Identificador invalido'
      });
    }

    try {
      if (!await accesoMipyme(
        database,
        idMipyme,
        idUsuario
      )) {
        return res.status(403).json({
          error: 'No autorizado para esta empresa'
        });
      }

      const r = await database.query(`
        SELECT
          p.*,
          d.titulo AS titulo_diagnostico,
          m.nombre_mipyme
        FROM public.fve_proceso p
        JOIN public.diagnostico d
          ON d.id_diagnostico = p.id_diagnostico
        JOIN public.mipyme m
          ON m.id_mipyme = p.id_mipyme
        WHERE p.id_mipyme = $1
        ORDER BY p.created_at DESC,
                 p.id_proceso DESC
      `, [idMipyme]);

      return res.json({
        procesos: r.rows
      });

    } catch (e) {
      console.error('Listado FVE:', e);

      return res.status(500).json({
        error: 'No se pudieron consultar los procesos FVE'
      });
    }
  }

  async function obtenerProceso(req, res) {
    const id = parseId(req.params.idProceso);
    const idUsuario = parseId(req.user?.id_usuario);

    if (!id || !idUsuario) {
      return res.status(400).json({
        error: 'Identificador invalido'
      });
    }

    try {
      const r = await database.query(`
        SELECT
          p.*,
          d.titulo AS titulo_diagnostico,
          m.nombre_mipyme
        FROM public.fve_proceso p
        JOIN public.diagnostico d
          ON d.id_diagnostico = p.id_diagnostico
        JOIN public.mipyme m
          ON m.id_mipyme = p.id_mipyme
        WHERE p.id_proceso = $1
      `, [id]);

      if (!r.rowCount) {
        return res.status(404).json({
          error: 'Proceso no encontrado'
        });
      }

      if (!await accesoMipyme(
        database,
        r.rows[0].id_mipyme,
        idUsuario
      )) {
        return res.status(403).json({
          error: 'No autorizado para esta empresa'
        });
      }

      return res.json({
        proceso: r.rows[0]
      });

    } catch (e) {
      console.error('Consultar FVE:', e);

      return res.status(500).json({
        error: 'No se pudo consultar el proceso FVE'
      });
    }
  }

  async function obtenerPorDiagnostico(req, res) {
    const id = parseId(req.params.idDiagnostico);
    const idUsuario = parseId(req.user?.id_usuario);

    if (!id || !idUsuario) {
      return res.status(400).json({
        error: 'Identificador invalido'
      });
    }

    try {
      const origen = await database.query(`
        SELECT id_mipyme
        FROM public.diagnostico
        WHERE id_diagnostico = $1
      `, [id]);

      if (!origen.rowCount) {
        return res.status(404).json({
          error: 'Diagnostico no encontrado'
        });
      }

      if (!await accesoMipyme(
        database,
        origen.rows[0].id_mipyme,
        idUsuario
      )) {
        return res.status(403).json({
          error: 'No autorizado para esta empresa'
        });
      }

      const r = await database.query(`
        SELECT
          p.*,
          d.titulo AS titulo_diagnostico,
          m.nombre_mipyme
        FROM public.fve_proceso p
        JOIN public.diagnostico d
          ON d.id_diagnostico = p.id_diagnostico
        JOIN public.mipyme m
          ON m.id_mipyme = p.id_mipyme
        WHERE p.id_diagnostico = $1
      `, [id]);

      return res.json({
        proceso: r.rows[0] || null
      });

    } catch (e) {
      console.error('FVE por diagnostico:', e);

      return res.status(500).json({
        error: 'No se pudo consultar el proceso FVE'
      });
    }
  }

  return {
    iniciarProceso,
    listarPorMipyme,
    obtenerProceso,
    obtenerPorDiagnostico
  };
}

module.exports = { createFveHandlers };
