const jwt = require('jsonwebtoken');
const pool = require('../db');
const bcrypt = require('bcrypt');
const axios = require('axios');

async function createCalendario(req, res) {

  const {
    titulo,
    fecha_hora,
    direccion,
    descripcion,
    usuarios = []
  } = req.body;

  const createdBy =
    req.user?.id_usuario;

  const client =
    await pool.connect();

  try {

    await client.query('BEGIN');

    if (!titulo) {
      return res.status(400).json({
        error:
          'titulo es obligatorio'
      });
    }

    if (!fecha_hora) {
      return res.status(400).json({
        error:
          'fecha_hora es obligatoria'
      });
    }

    if (!Array.isArray(usuarios)) {
      return res.status(400).json({
        error:
          'usuarios debe ser un arreglo'
      });
    }

    // ✅ Crear calendario

    const calendarioResult =
      await client.query(
        `
        INSERT INTO calendario (
          titulo,
          estado,
          fecha_hora,
          direccion,
          descripcion,
          created_at,
          created_by
        )
        VALUES (
          $1,
          'activo',
          $2,
          $3,
          $4,
          NOW(),
          $5
        )
        RETURNING *
        `,
        [
          titulo,
          fecha_hora,
          direccion || null,
          descripcion || null,
          createdBy,
        ]
      );

    const calendario =
      calendarioResult.rows[0];

    // ✅ relacionar usuarios

    for (const idUsuario of usuarios) {

      await client.query(
        `
        INSERT INTO usuario_calendario (
          id_usuario,
          id_calendario
        )
        VALUES ($1,$2)
        `,
        [
          idUsuario,
          calendario.id_calendario,
        ]
      );

    }

    // ✅ obtener correos usuarios invitados

    const asistentesResult =
      await client.query(
        `
        SELECT email
        FROM usuario
        WHERE id_usuario = ANY($1::int[])
        `,
        [usuarios]
      );

    const attendees =
      asistentesResult.rows
        .map(x => x.email)
        .filter(Boolean);

    await client.query('COMMIT');

    // ✅ Teams después del commit

    try {

      const teamsResponse =
        await crearEventoTeams({
            titulo,
            descripcion,
            fechaHora: fecha_hora,
            attendees,
        });

        console.log(
        'Respuesta Teams:',
        teamsResponse
        );
        
        if (teamsResponse?.success === true) {

        await pool.query(
            `
            UPDATE calendario
            SET
            id_teams = $1,
            enlace_teams = $2
            WHERE id_calendario = $3
            `,
            [
            teamsResponse.id_teams,
            teamsResponse.enlace_teams,
            calendario.id_calendario,
            ]
        );

        }

    } catch (teamsError) {

      console.error(
        'Error creando evento Teams:',
        teamsError.response?.data ||
        teamsError.message
      );

    }

    return res.status(201).json({

      message:
        'Calendario creado correctamente',

      calendario,

      usuarios_asignados:
        usuarios.length,

      invitados:
        attendees,

    });

  } catch (err) {

    await client.query('ROLLBACK');

    console.error(
      'Error createCalendario:',
      err
    );

    return res.status(500).json({
      error:
        'Error al crear calendario',
    });

  } finally {

    client.release();

  }

}

async function getClientsWithMyCalendarToday(
  req,
  res
) {

  const idUsuario =
    req.user?.id_usuario;


  try {

    const result =
      await pool.query(
        `
        SELECT *

        FROM (

          -- ========================================
          -- CLIENTES FV
          -- ========================================

          SELECT DISTINCT

            'cliente'::text
              AS tipo_entidad,

            u.id_usuario,

            NULL::integer
              AS id_prospecto,

            u.nombre_usuario,

            u.email,

            u.documento,

            u.telefono,

            r.nombre_rol,

            r.id_rol,

            m.nombre_mipyme,

            m.municipio,

            m.tipo_empresa,

            c.id_calendario,

            c.titulo,

            c.fecha_hora,

            c.descripcion,

            c.direccion,

            u.estado,

            u.created_at

          FROM calendario c

          INNER JOIN usuario_calendario uc_cliente
            ON uc_cliente.id_calendario =
               c.id_calendario

          INNER JOIN usuario u
            ON u.id_usuario =
               uc_cliente.id_usuario

          INNER JOIN rol r
            ON r.id_rol =
               u.id_rol

          LEFT JOIN mipyme_usuario mu
            ON mu.id_usuario =
               u.id_usuario

          LEFT JOIN mipyme m
            ON m.id_mipyme =
               mu.id_mipyme

          WHERE r.nombre_rol =
                'Cliente'

            AND COALESCE(
                  u.estado,
                  'activo'
                ) !=
                'inactivo'

            AND c.estado =
                'activo'

            AND DATE(
                  c.fecha_hora
                ) =
                CURRENT_DATE

            AND EXISTS (

              SELECT 1

              FROM usuario_calendario uc_mio

              WHERE uc_mio.id_calendario =
                    c.id_calendario

                AND uc_mio.id_usuario =
                    $1

            )


          UNION ALL


          -- ========================================
          -- PROSPECTOS
          -- ========================================

          SELECT DISTINCT

            'prospecto'::text
              AS tipo_entidad,

            pc.id_usuario_convertido
              AS id_usuario,

            pc.id_prospecto,

            CONCAT_WS(
              ' ',
              pc.nombres,
              pc.apellidos
            ) AS nombre_usuario,

            pc.correo
              AS email,

            pc.documento,

            pc.celular
              AS telefono,

            'Prospecto'::text
              AS nombre_rol,

            NULL::integer
              AS id_rol,

            NULL::text
              AS nombre_mipyme,

            pc.municipio,

            NULL::text
              AS tipo_empresa,

            c.id_calendario,

            c.titulo,

            c.fecha_hora,

            c.descripcion,

            c.direccion,

            pc.estado,

            pc.created_at

          FROM calendario c

          INNER JOIN prospecto_calendario pcal
            ON pcal.id_calendario =
               c.id_calendario

          INNER JOIN prospecto_cliente pc
            ON pc.id_prospecto =
               pcal.id_prospecto

          WHERE c.estado =
                'activo'

            AND pc.estado IN (
              'agendado',
              'pospuesto',
              'convertido'
            )

            AND DATE(
                  c.fecha_hora
                ) =
                CURRENT_DATE

            AND EXISTS (

              SELECT 1

              FROM usuario_calendario uc_mio

              WHERE uc_mio.id_calendario =
                    c.id_calendario

                AND uc_mio.id_usuario =
                    $1

            )

        ) agenda

        ORDER BY
          fecha_hora ASC
        `,
        [
          idUsuario
        ]
      );


    return res.status(200).json({

      clients:
        result.rows,

    });


  } catch (error) {

    console.error(
      'Error obteniendo agenda del día:',
      error
    );


    return res.status(500).json({
      error:
        'Error al obtener la agenda del día',
    });

  }

}

async function crearEventoTeams({
  titulo,
  descripcion,
  fechaHora,
  attendees = [],
}) {

  const inicio = new Date(fechaHora);

  const fin = new Date(
    inicio.getTime() + (60 * 60 * 1000)
  );

  const response = await axios.post(

    'https://default23cc1a1c724d49179f5da22ac77e48.79.environment.api.powerplatform.com/powerautomate/automations/direct/cu/31/workflows/f0f0c6e8f62f4e82b873d188bf896105/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=TLtF2klg1vIRoGqkc4-5ArEjH04WlqRlF3EMx9taqno',

    {
      subject: titulo,
      body: descripcion || '',
      start: formatDateForPowerAutomate(
        inicio
      ),
      end: formatDateForPowerAutomate(
        fin
      ),
      requiredAttendees: attendees,
    }

  );

  return response.data;
}

function formatDateForPowerAutomate(
  date
) {

  const pad = (n) =>
    n.toString().padStart(2, '0');

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}:` +
    `${pad(date.getSeconds())}`
  );

}

async function cancelarCalendario(
  req,
  res
) {

  const idCalendario =
    Number(req.params.id);

  const client =
    await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const calendarioResult =
      await client.query(
        `
        SELECT *
        FROM calendario
        WHERE id_calendario = $1
        `,
        [idCalendario]
      );

    if (
      calendarioResult.rows.length === 0
    ) {

      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error: 'Calendario no encontrado'
      });

    }

    const calendario = calendarioResult.rows[0];

    // ✅ cancelar Teams

    if (
      calendario.id_teams
    ) {

      try {

            const response =
                await cancelarEventoTeams(
                calendario.id_teams
                );

            console.log(
                'Teams:',
                response
            );

            } catch (error) {

                console.log(
                    JSON.stringify(
                    error.response?.data,
                    null,
                    2
                    )
                );

            }
    }

    // ✅ eliminar relaciones

    await client.query(
      `
      DELETE FROM usuario_calendario
      WHERE id_calendario = $1
      `,
      [idCalendario]
    );

    // ✅ cancelar agenda

    await client.query(
      `
      UPDATE calendario
      SET
        estado = 'cancelado',
        updated_at = NOW(),
        updated_by = $2
      WHERE id_calendario = $1
      `,
      [
        idCalendario,
        req.user.id_usuario
      ]
    );

    await client.query(
      'COMMIT'
    );

    return res.status(200).json({

      message:
        'Agendamiento cancelado correctamente'

    });

  } catch (err) {

    await client.query(
      'ROLLBACK'
    );

    console.error(err);

    return res.status(500).json({
      error:
        'Error al cancelar agendamiento'
    });

  } finally {

    client.release();

  }

}

async function cancelarEventoTeams(
  idTeams
) {

  const response = await axios.post(

    'https://default23cc1a1c724d49179f5da22ac77e48.79.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/07/workflows/5c90fa1fe7714d08b05afa414a53b91a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=wxgRSzerSfUrHtZAGMQ-jDOoRaFy8vNbygLXFAAoak4',

    {
      id_teams: idTeams
    }

  );

  return response.data;

}

async function actualizarEventoTeams({
  idTeams,
  titulo,
  descripcion,
  fechaHora,
  attendees = [],
}) {

  const inicio =
    new Date(fechaHora);

  const fin =
    new Date(
      inicio.getTime() +
      (60 * 60 * 1000)
    );

  const response =
    await axios.put(

      'https://default23cc1a1c724d49179f5da22ac77e48.79.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/01/workflows/20e26a1b3d45470cbfd2917e0d61ae5c/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=tZIEWIy9aIZeXceZlmij4s1Cfc4rN8dcUcptlRH_cVo',

      {
            id_teams: idTeams,

            subject: titulo,

            body:
                descripcion || '',

            start:
                formatDateForPowerAutomate(
                inicio
                ),

            end:
                formatDateForPowerAutomate(
                fin
                ),

            requiredAttendees:
                attendees,
        }

    );

  return response.data;

}

async function updateCalendario(
  req,
  res
) {

  const idCalendario =
    Number(req.params.id);

  const {
    titulo,
    fecha_hora,
    direccion,
    descripcion,
  } = req.body;

  const client =
    await pool.connect();

  try {

    const asistentesResult =
  await client.query(
    `
    SELECT email

    FROM (

      SELECT
        u.email

      FROM usuario u

      INNER JOIN usuario_calendario uc
        ON uc.id_usuario =
           u.id_usuario

      WHERE uc.id_calendario =
            $1

        AND u.email IS NOT NULL


      UNION


      SELECT
        pc.correo AS email

      FROM prospecto_cliente pc

      INNER JOIN prospecto_calendario pcal
        ON pcal.id_prospecto =
           pc.id_prospecto

      WHERE pcal.id_calendario =
            $1

        AND pc.correo IS NOT NULL

    ) asistentes

    WHERE email IS NOT NULL
    `,
    [
      idCalendario
    ]
  );


const attendees =
  asistentesResult.rows
    .map(
      item =>
        item.email
    )
    .filter(Boolean);

    await client.query(
      'BEGIN'
    );

    const existe =
      await client.query(
        `
        SELECT *
        FROM calendario
        WHERE id_calendario = $1
        `,
        [idCalendario]
      );

    if (
      existe.rows.length === 0
    ) {

      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'Calendario no encontrado'
      });

    }

    const calendario =
      existe.rows[0];

    const updated =
      await client.query(
        `
        UPDATE calendario
        SET
          titulo = $1,
          fecha_hora = $2,
          direccion = $3,
          descripcion = $4,
          updated_at = NOW(),
          updated_by = $6
        WHERE id_calendario = $5
        RETURNING *
        `,
        [
          titulo,
          fecha_hora,
          direccion,
          descripcion,
          idCalendario,
          req.user.id_usuario,
        ]
      );

    await client.query(
      'COMMIT'
    );

    // ✅ actualizar Teams

    try {

      if (
        calendario.id_teams
      ) {

            await actualizarEventoTeams({
                idTeams: calendario.id_teams,
                titulo,
                descripcion,
                fechaHora: fecha_hora,
                attendees,
            });

      }

    } catch (teamsError) {

      console.error(
        'Error actualizando Teams:',
        teamsError.response?.data ||
        teamsError.message
      );

    }

    return res.status(200).json({

      message:
        'Calendario actualizado correctamente',

      calendario:
        updated.rows[0],

    });

  } catch (err) {

    await client.query(
      'ROLLBACK'
    );

    console.error(err);

    return res.status(500).json({
      error:
        'Error al actualizar calendario'
    });

  } finally {

    client.release();

  }

}

async function getClientsWithMyCalendarRange(
  req,
  res
) {

  const idUsuario =
    req.user?.id_usuario;


  const {
    fecha_inicio,
    fecha_fin,
  } = req.body;


  if (
    !fecha_inicio ||
    !fecha_fin
  ) {

    return res.status(400).json({
      error:
        'fecha_inicio y fecha_fin son obligatorias',
    });

  }


  try {

    const result =
      await pool.query(
        `
        SELECT *

        FROM (

          SELECT DISTINCT

            'cliente'::text
              AS tipo_entidad,

            u.id_usuario,

            NULL::integer
              AS id_prospecto,

            u.nombre_usuario,

            u.email,

            u.documento,

            u.telefono,

            r.nombre_rol,

            r.id_rol,

            m.nombre_mipyme,

            m.municipio,

            m.tipo_empresa,

            c.id_calendario,

            c.titulo,

            c.fecha_hora,

            c.descripcion,

            c.direccion,

            u.estado,

            u.created_at

          FROM calendario c

          INNER JOIN usuario_calendario uc_cliente
            ON uc_cliente.id_calendario =
               c.id_calendario

          INNER JOIN usuario u
            ON u.id_usuario =
               uc_cliente.id_usuario

          INNER JOIN rol r
            ON r.id_rol =
               u.id_rol

          LEFT JOIN mipyme_usuario mu
            ON mu.id_usuario =
               u.id_usuario

          LEFT JOIN mipyme m
            ON m.id_mipyme =
               mu.id_mipyme

          WHERE r.nombre_rol =
                'Cliente'

            AND COALESCE(
                  u.estado,
                  'activo'
                ) !=
                'inactivo'

            AND c.estado =
                'activo'

            AND DATE(
                  c.fecha_hora
                )
                BETWEEN $2 AND $3

            AND EXISTS (

              SELECT 1

              FROM usuario_calendario uc_mio

              WHERE uc_mio.id_calendario =
                    c.id_calendario

                AND uc_mio.id_usuario =
                    $1

            )


          UNION ALL


          SELECT DISTINCT

            'prospecto'::text
              AS tipo_entidad,

            pc.id_usuario_convertido
              AS id_usuario,

            pc.id_prospecto,

            CONCAT_WS(
              ' ',
              pc.nombres,
              pc.apellidos
            ) AS nombre_usuario,

            pc.correo
              AS email,

            pc.documento,

            pc.celular
              AS telefono,

            'Prospecto'::text
              AS nombre_rol,

            NULL::integer
              AS id_rol,

            NULL::text
              AS nombre_mipyme,

            pc.municipio,

            NULL::text
              AS tipo_empresa,

            c.id_calendario,

            c.titulo,

            c.fecha_hora,

            c.descripcion,

            c.direccion,

            pc.estado,

            pc.created_at

          FROM calendario c

          INNER JOIN prospecto_calendario pcal
            ON pcal.id_calendario =
               c.id_calendario

          INNER JOIN prospecto_cliente pc
            ON pc.id_prospecto =
               pcal.id_prospecto

          WHERE c.estado =
                'activo'

            AND pc.estado IN (
              'agendado',
              'pospuesto',
              'convertido'
            )

            AND DATE(
                  c.fecha_hora
                )
                BETWEEN $2 AND $3

            AND EXISTS (

              SELECT 1

              FROM usuario_calendario uc_mio

              WHERE uc_mio.id_calendario =
                    c.id_calendario

                AND uc_mio.id_usuario =
                    $1

            )

        ) agenda

        ORDER BY
          fecha_hora ASC
        `,
        [
          idUsuario,
          fecha_inicio,
          fecha_fin,
        ]
      );


    return res.status(200).json({

      fecha_inicio,

      fecha_fin,

      total:
        result.rows.length,

      clients:
        result.rows,

    });


  } catch (error) {

    console.error(
      'Error obteniendo calendario:',
      error
    );


    return res.status(500).json({
      error:
        'Error al obtener el calendario',
    });

  }

}

module.exports = {

  createCalendario,

  getClientsWithMyCalendarToday,

  cancelarCalendario,

  updateCalendario,

  getClientsWithMyCalendarRange,

  crearEventoTeams,

};