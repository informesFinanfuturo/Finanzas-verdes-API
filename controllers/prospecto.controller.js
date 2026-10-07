const pool = require('../db');
const bcrypt = require('bcrypt');

const {
  isDocumentoONit,
} = require('../utils/validators');

const {
  consultarClienteExterno:
    consultarEnSistemasExternos,
} = require(
  '../services/integraciones/clienteExterno.service'
);

const {
  getLinixClientByDocument,
} = require(
  '../services/integraciones/linix.provider'
);

const {
  findCiiuByCode,
} = require(
  '../services/ciiuService'
);

const {
  crearEventoTeams,
} = require(
  './calendario.controller'
);


// ============================================================
// HELPERS
// ============================================================

async function getAdvisorByUser(
  client,
  idUsuario
) {

  const result =
    await client.query(
      `
      SELECT
        id_asesor,
        id_usuario,
        sede,
        nombre_cargo,
        estado

      FROM asesor

      WHERE id_usuario = $1
        AND estado = 'activo'

      ORDER BY id_asesor DESC

      LIMIT 1
      `,
      [
        idUsuario
      ]
    );


  return (
    result.rows[0] ??
    null
  );
}


async function getLocalClientByDocument(
  client,
  documento
) {

  const result =
    await client.query(
      `
      SELECT
        u.id_usuario,
        u.documento,
        u.nombre_usuario,
        u.email,
        u.telefono,
        u.estado,
        r.nombre_rol

      FROM usuario u

      INNER JOIN rol r
        ON r.id_rol =
           u.id_rol

      WHERE TRIM(u.documento) =
            TRIM($1)

      LIMIT 1
      `,
      [
        documento
      ]
    );


  return (
    result.rows[0] ??
    null
  );
}


async function getProspectByDocument(
  client,
  documento
) {

  const result =
    await client.query(
      `
      SELECT
        id_prospecto,
        documento,
        nombres,
        apellidos,
        municipio,
        sucursal,
        direccion_negocio,
        codigo_ciiu,
        celular,
        correo,
        id_asesor,
        id_consulta_origen,
        estado,
        id_usuario_convertido,
        created_at,
        updated_at,
        converted_at

      FROM prospecto_cliente

      WHERE TRIM(documento) =
            TRIM($1)

      LIMIT 1
      `,
      [
        documento
      ]
    );


  return (
    result.rows[0] ??
    null
  );
}


async function registerAudit(
  client,
  {
    actorId,
    action,
    entity,
    entityId,
    previousData = null,
    newData = null,
    reason = null,
    req,
  }
) {

  await client.query(
    `
    INSERT INTO audit_log (
      id_usuario_actor,
      accion,
      entidad,
      id_entidad,
      datos_anteriores,
      datos_nuevos,
      motivo,
      ip,
      user_agent,
      created_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5::jsonb,
      $6::jsonb,
      $7,
      $8,
      $9,
      NOW()
    )
    `,
    [
      actorId ?? null,
      action,
      entity,
      entityId,
      previousData
        ? JSON.stringify(previousData)
        : null,
      newData
        ? JSON.stringify(newData)
        : null,
      reason,
      req?.ip ?? null,
      req?.get?.('user-agent') ?? null,
    ]
  );
}


// ============================================================
// CONSULTAR LINIX + AICOLL
// ============================================================

async function consultarClienteExterno(
  req,
  res
) {

  const documento =
    String(
      req.body?.documento ??
      ''
    ).trim();


  const actorId =
    req.user?.id_usuario;


  if (!documento) {

    return res.status(400).json({
      error:
        'Debe ingresar el documento del cliente',
    });

  }


  if (!isDocumentoONit(documento)) {

    return res.status(400).json({
      error:
        'El documento debe contener entre 6 y 10 dígitos',
    });

  }


  const client =
    await pool.connect();


  try {

    const advisor =
      await getAdvisorByUser(
        client,
        actorId
      );


    if (!advisor) {

      return res.status(403).json({
        error:
          'El usuario actual no tiene un perfil de asesor activo',
      });

    }


    let externalResult;


    try {

      externalResult =
        await consultarEnSistemasExternos(
          documento
        );

    } catch (externalError) {

      const failedResult =
        await client.query(
          `
          INSERT INTO consulta_cliente (
            documento,
            id_asesor,
            resultado,
            created_at
          )
          VALUES (
            $1,
            $2,
            'error',
            NOW()
          )
          RETURNING *
          `,
          [
            documento,
            advisor.id_asesor,
          ]
        );


      console.error(
        'Error consultando sistemas externos:',
        externalError
      );


      return res.status(
        externalError.statusCode ||
        503
      ).json({

        error:
          externalError.message ||
          'No fue posible consultar los sistemas externos',

        consulta:
          failedResult.rows[0],

      });

    }


    if (!externalResult.cliente) {

      const notFoundResult =
        await client.query(
          `
          INSERT INTO consulta_cliente (
            documento,
            id_asesor,
            resultado,
            created_at
          )
          VALUES (
            $1,
            $2,
            'no_encontrado',
            NOW()
          )
          RETURNING *
          `,
          [
            documento,
            advisor.id_asesor,
          ]
        );


      return res.status(404).json({

        error:
          'No se encontró un cliente asociado al documento ingresado',

        consulta:
          notFoundResult.rows[0],

      });

    }


    const queryResult =
      await client.query(
        `
        INSERT INTO consulta_cliente (
          documento,
          id_asesor,
          resultado,
          created_at
        )
        VALUES (
          $1,
          $2,
          'encontrado',
          NOW()
        )
        RETURNING *
        `,
        [
          documento,
          advisor.id_asesor,
        ]
      );


    const consultation =
      queryResult.rows[0];


    const [
      existingUser,
      existingProspect,
    ] =
      await Promise.all([

        getLocalClientByDocument(
          client,
          documento
        ),

        getProspectByDocument(
          client,
          documento
        ),

      ]);


    const isFVClient =
      existingUser?.nombre_rol ===
      'Cliente';


    return res.status(200).json({

      consulta: {

        id_consulta:
          consultation.id_consulta,

        documento:
          consultation.documento,

        fecha_consulta:
          consultation.created_at,

      },


      cliente:
        externalResult.cliente,


      /*
       * IMPORTANTE:
       * estos puntajes solo salen en
       * la respuesta.
       *
       * NO se guardan.
       */
      puntajes:
        externalResult.puntajes,


      integraciones:
        externalResult.integraciones,


      estado_local: {

        es_cliente_finanzas_verdes:
          isFVClient,

        usuario_existente:
          existingUser,

        cliente:
          isFVClient
            ? existingUser
            : null,


        es_prospecto:
          Boolean(
            existingProspect
          ),

        prospecto:
          existingProspect,

      },

    });


  } catch (error) {

    console.error(
      'Error consultarClienteExterno:',
      error
    );


    return res.status(500).json({
      error:
        'Error interno consultando el cliente',
    });


  } finally {

    client.release();

  }

}


// ============================================================
// DESCARTAR CONSULTA
// ============================================================

async function descartarConsulta(
  req,
  res
) {

  const idConsulta =
    Number(
      req.params.id
    );


  const motivo =
    String(
      req.body?.motivo ??
      ''
    ).trim();


  const motivoCodigo =
    String(
      req.body?.motivo_codigo ??
      'otro'
    ).trim();


  const actorId =
    req.user?.id_usuario;


  const motivosPermitidos = [
    'no_cumple_perfil',
    'puntajes',
    'informacion_insuficiente',
    'ya_contactado',
    'otro',
  ];


  if (
    !Number.isInteger(
      idConsulta
    ) ||
    idConsulta <= 0
  ) {

    return res.status(400).json({
      error:
        'La consulta indicada no es válida',
    });

  }


  if (!motivo) {

    return res.status(400).json({
      error:
        'Debe indicar el motivo por el cual el cliente no será agendado',
    });

  }


  if (
    !motivosPermitidos.includes(
      motivoCodigo
    )
  ) {

    return res.status(400).json({
      error:
        'El motivo de descarte no es válido',
    });

  }


  const client =
    await pool.connect();


  try {

    await client.query('BEGIN');


    const advisor =
      await getAdvisorByUser(
        client,
        actorId
      );


    if (!advisor) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(403).json({
        error:
          'El usuario actual no tiene un perfil de asesor activo',
      });

    }


    const queryResult =
      await client.query(
        `
        SELECT *

        FROM consulta_cliente

        WHERE id_consulta = $1
          AND id_asesor = $2

        FOR UPDATE
        `,
        [
          idConsulta,
          advisor.id_asesor,
        ]
      );


    if (
      queryResult.rows.length ===
      0
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(404).json({
        error:
          'La consulta no existe o pertenece a otro asesor',
      });

    }


    const previous =
      queryResult.rows[0];


    if (
      previous.decision ===
      'agendado'
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(409).json({
        error:
          'El cliente ya fue seleccionado para agendamiento',
      });

    }


    const updateResult =
      await client.query(
        `
        UPDATE consulta_cliente

        SET
          decision = 'descartado',

          motivo_descarte_codigo =
            $1,

          motivo_descarte =
            $2,

          decision_at =
            NOW()

        WHERE id_consulta =
              $3

        RETURNING *
        `,
        [
          motivoCodigo,
          motivo,
          idConsulta,
        ]
      );


    const updated =
      updateResult.rows[0];


    await registerAudit(
      client,
      {
        actorId,

        action:
          'DISCARD_EXTERNAL_CLIENT',

        entity:
          'consulta_cliente',

        entityId:
          idConsulta,

        previousData: {
          decision:
            previous.decision,

          motivo_descarte:
            previous.motivo_descarte,
        },

        newData: {
          decision:
            updated.decision,

          motivo_codigo:
            updated
              .motivo_descarte_codigo,

          motivo_descarte:
            updated
              .motivo_descarte,
        },

        reason:
          motivo,

        req,
      }
    );


    await client.query(
      'COMMIT'
    );


    return res.status(200).json({

      message:
        'Cliente descartado correctamente',

      consulta:
        updated,

    });


  } catch (error) {

    await client.query(
      'ROLLBACK'
    );


    console.error(
      'Error descartarConsulta:',
      error
    );


    return res.status(500).json({
      error:
        'Error interno descartando el cliente',
    });


  } finally {

    client.release();

  }

}


// ============================================================
// AGENDAR PROSPECTO
// ============================================================

async function agendarProspecto(
  req,
  res
) {

  const idConsulta =
    Number(
      req.params.id
    );


  const {
    fecha_hora,
    titulo,
    direccion,
    descripcion,
  } = req.body;


  const actorId =
    req.user?.id_usuario;


  if (
    !Number.isInteger(
      idConsulta
    ) ||
    idConsulta <= 0
  ) {

    return res.status(400).json({
      error:
        'La consulta indicada no es válida',
    });

  }


  if (!fecha_hora) {

    return res.status(400).json({
      error:
        'La fecha y hora son obligatorias',
    });

  }


  const advisorClient =
    await pool.connect();


  let advisor;


  try {

    advisor =
      await getAdvisorByUser(
        advisorClient,
        actorId
      );

  } finally {

    advisorClient.release();

  }


  if (!advisor) {

    return res.status(403).json({
      error:
        'El usuario actual no tiene un perfil de asesor activo',
    });

  }


  const consultationResult =
    await pool.query(
      `
      SELECT *

      FROM consulta_cliente

      WHERE id_consulta = $1
        AND id_asesor = $2

      LIMIT 1
      `,
      [
        idConsulta,
        advisor.id_asesor,
      ]
    );


  if (
    consultationResult.rows.length ===
    0
  ) {

    return res.status(404).json({
      error:
        'La consulta no existe o pertenece a otro asesor',
    });

  }


  const consultation =
    consultationResult.rows[0];


  if (
    consultation.resultado !==
    'encontrado'
  ) {

    return res.status(409).json({
      error:
        'Solo se puede agendar un cliente encontrado en LINIX',
    });

  }


  if (
    consultation.decision ===
    'descartado'
  ) {

    return res.status(409).json({
      error:
        'La consulta ya fue descartada',
    });

  }


  /*
   * Solo volvemos a consultar LINIX.
   * NO volvemos a consultar Aicoll.
   */
  let linixClient;


  try {

    linixClient =
      await getLinixClientByDocument(
        consultation.documento
      );

  } catch (error) {

    return res.status(
      error.statusCode ||
      503
    ).json({
      error:
        error.message ||
        'No fue posible consultar LINIX',
    });

  }


  if (!linixClient) {

    return res.status(404).json({
      error:
        'El cliente ya no se encuentra disponible en LINIX',
    });

  }


  const client =
    await pool.connect();


  try {

    await client.query(
      'BEGIN'
    );


    const existingUser =
      await getLocalClientByDocument(
        client,
        consultation.documento
      );


    if (existingUser) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(409).json({
        error:
          existingUser.nombre_rol ===
          'Cliente'
            ? 'El cliente ya pertenece a Finanzas Verdes'
            : 'El documento ya pertenece a otro usuario del sistema',
      });

    }


    let prospect =
      await getProspectByDocument(
        client,
        consultation.documento
      );


    if (
      prospect
        ?.id_usuario_convertido
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(409).json({
        error:
          'El prospecto ya fue convertido en cliente',
      });

    }


    if (prospect) {

      const futureCalendar =
        await client.query(
          `
          SELECT
            c.id_calendario,
            c.fecha_hora

          FROM prospecto_calendario pc

          INNER JOIN calendario c
            ON c.id_calendario =
               pc.id_calendario

          WHERE pc.id_prospecto =
                $1

            AND c.estado =
                'activo'

            AND c.fecha_hora >=
                NOW()

          ORDER BY
            c.fecha_hora ASC

          LIMIT 1
          `,
          [
            prospect.id_prospecto
          ]
        );


      if (
        futureCalendar.rows.length >
        0
      ) {

        await client.query(
          'ROLLBACK'
        );


        return res.status(409).json({

          error:
            'El prospecto ya tiene una cita futura programada',

          calendario:
            futureCalendar.rows[0],

        });

      }


      const updatedProspect =
        await client.query(
          `
          UPDATE prospecto_cliente

          SET
            nombres = $1,
            apellidos = $2,
            municipio = $3,
            sucursal = $4,
            direccion_negocio = $5,
            codigo_ciiu = $6,
            celular = $7,
            correo = $8,
            id_asesor = $9,
            id_consulta_origen = $10,
            estado = 'agendado',
            updated_at = NOW()

          WHERE id_prospecto =
                $11

          RETURNING *
          `,
          [
            linixClient.nombres ??
            null,

            linixClient.apellidos ??
            null,

            linixClient.municipio ??
            null,

            linixClient.sucursal ??
            null,

            linixClient
              .direccion_negocio ??
            null,

            linixClient.codigo_ciiu ??
            null,

            linixClient.celular ??
            null,

            linixClient.correo ??
            null,

            advisor.id_asesor,

            idConsulta,

            prospect.id_prospecto,
          ]
        );


      prospect =
        updatedProspect.rows[0];

    } else {

      const prospectResult =
        await client.query(
          `
          INSERT INTO prospecto_cliente (
            documento,
            nombres,
            apellidos,
            municipio,
            sucursal,
            direccion_negocio,
            codigo_ciiu,
            celular,
            correo,
            id_asesor,
            id_consulta_origen,
            estado,
            created_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            'agendado',
            NOW()
          )
          RETURNING *
          `,
          [
            consultation.documento,

            linixClient.nombres ??
            null,

            linixClient.apellidos ??
            null,

            linixClient.municipio ??
            null,

            linixClient.sucursal ??
            null,

            linixClient
              .direccion_negocio ??
            null,

            linixClient.codigo_ciiu ??
            null,

            linixClient.celular ??
            null,

            linixClient.correo ??
            null,

            advisor.id_asesor,

            idConsulta,
          ]
        );


      prospect =
        prospectResult.rows[0];

    }


    const calendarResult =
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
          String(
            titulo ||
            'Presentación Finanzas Verdes'
          ).trim(),

          fecha_hora,

          direccion ||
          linixClient
            .direccion_negocio ||
          null,

          descripcion ||
          null,

          actorId,
        ]
      );


    const calendar =
      calendarResult.rows[0];


    /*
     * El asesor SÍ es usuario,
     * por lo que sigue utilizando
     * usuario_calendario.
     */
    await client.query(
      `
      INSERT INTO usuario_calendario (
        id_usuario,
        id_calendario
      )
      VALUES (
        $1,
        $2
      )
      `,
      [
        actorId,
        calendar.id_calendario,
      ]
    );


    /*
     * El prospecto NO es usuario.
     */
    await client.query(
      `
      INSERT INTO prospecto_calendario (
        id_prospecto,
        id_calendario
      )
      VALUES (
        $1,
        $2
      )
      `,
      [
        prospect.id_prospecto,
        calendar.id_calendario,
      ]
    );


    await client.query(
      `
      UPDATE consulta_cliente

      SET
        decision =
          'agendado',

        motivo_descarte =
          NULL,

        motivo_descarte_codigo =
          NULL,

        decision_at =
          NOW()

      WHERE id_consulta =
            $1
      `,
      [
        idConsulta
      ]
    );


    await registerAudit(
      client,
      {
        actorId,

        action:
          'SCHEDULE_EXTERNAL_CLIENT',

        entity:
          'prospecto_cliente',

        entityId:
          prospect.id_prospecto,

        newData: {
          id_prospecto:
            prospect.id_prospecto,

          documento:
            prospect.documento,

          id_calendario:
            calendar.id_calendario,

          fecha_hora:
            calendar.fecha_hora,
        },

        reason:
          'Cliente seleccionado para presentación de Finanzas Verdes',

        req,
      }
    );


    await client.query(
      'COMMIT'
    );


    /*
     * Teams se crea DESPUÉS del commit,
     * igual que en tu flujo actual.
     */
    try {

      const attendees =
        prospect.correo
          ? [prospect.correo]
          : [];


      const teamsResponse =
        await crearEventoTeams({

          titulo:
            calendar.titulo,

          descripcion:
            calendar.descripcion,

          fechaHora:
            calendar.fecha_hora,

          attendees,

        });


      if (
        teamsResponse?.success ===
        true
      ) {

        await pool.query(
          `
          UPDATE calendario

          SET
            id_teams = $1,
            enlace_teams = $2

          WHERE id_calendario =
                $3
          `,
          [
            teamsResponse.id_teams,

            teamsResponse
              .enlace_teams,

            calendar.id_calendario,
          ]
        );

      }

    } catch (teamsError) {

      console.error(
        'Error creando Teams para prospecto:',
        teamsError.response?.data ||
        teamsError.message
      );

    }


    return res.status(201).json({

      message:
        'Prospecto agendado correctamente',

      prospecto:
        prospect,

      calendario:
        calendar,

    });


  } catch (error) {

    await client.query(
      'ROLLBACK'
    );


    console.error(
      'Error agendarProspecto:',
      error
    );


    return res.status(500).json({
      error:
        'Error interno agendando el prospecto',
    });


  } finally {

    client.release();

  }

}


// ============================================================
// POSPONER / NO CONTINUAR
// ============================================================

async function actualizarDecisionProspecto(
  req,
  res
) {

  const idProspecto =
    Number(
      req.params.id
    );


  const decision =
    String(
      req.body?.decision ??
      ''
    ).trim();


  const motivo =
    String(
      req.body?.motivo ??
      ''
    ).trim();


  const actorId =
    req.user?.id_usuario;


  const estadosPermitidos = [
    'pospuesto',
    'desinteresado',
  ];


  if (
    !Number.isInteger(
      idProspecto
    ) ||
    idProspecto <= 0
  ) {

    return res.status(400).json({
      error:
        'Prospecto inválido',
    });

  }


  if (
    !estadosPermitidos.includes(
      decision
    )
  ) {

    return res.status(400).json({
      error:
        'La decisión indicada no es válida',
    });

  }


  if (!motivo) {

    return res.status(400).json({
      error:
        'Debe registrar el motivo',
    });

  }


  const client =
    await pool.connect();


  try {

    await client.query('BEGIN');


    const advisor =
      await getAdvisorByUser(
        client,
        actorId
      );


    if (!advisor) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(403).json({
        error:
          'El usuario actual no tiene un perfil de asesor activo',
      });

    }


    const previousResult =
      await client.query(
        `
        SELECT *

        FROM prospecto_cliente

        WHERE id_prospecto = $1
          AND id_asesor = $2

        FOR UPDATE
        `,
        [
          idProspecto,
          advisor.id_asesor,
        ]
      );


    if (
      previousResult.rows.length ===
      0
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(404).json({
        error:
          'Prospecto no encontrado',
      });

    }


    const previous =
      previousResult.rows[0];


    if (
      previous.estado ===
      'convertido'
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(409).json({
        error:
          'El prospecto ya fue convertido en cliente',
      });

    }


    const updatedResult =
      await client.query(
        `
        UPDATE prospecto_cliente

        SET
          estado = $1,
          updated_at = NOW()

        WHERE id_prospecto =
              $2

        RETURNING *
        `,
        [
          decision,
          idProspecto,
        ]
      );


    const updated =
      updatedResult.rows[0];


    await registerAudit(
      client,
      {
        actorId,

        action:
          'UPDATE_PROSPECT_DECISION',

        entity:
          'prospecto_cliente',

        entityId:
          idProspecto,

        previousData: {
          estado:
            previous.estado,
        },

        newData: {
          estado:
            updated.estado,
        },

        reason:
          motivo,

        req,
      }
    );


    await client.query(
      'COMMIT'
    );


    return res.status(200).json({

      message:
        'Decisión registrada correctamente',

      prospecto:
        updated,

    });


  } catch (error) {

    await client.query(
      'ROLLBACK'
    );


    console.error(
      'Error actualizarDecisionProspecto:',
      error
    );


    return res.status(500).json({
      error:
        'Error actualizando la decisión',
    });


  } finally {

    client.release();

  }

}


// ============================================================
// CONVERTIR PROSPECTO EN CLIENTE FV
// ============================================================

async function convertirProspecto(
  req,
  res
) {

  const idProspecto =
    Number(
      req.params.id
    );


  const nombreMipyme =
    String(
      req.body?.nombre_mipyme ??
      ''
    ).trim();


  const actorId =
    req.user?.id_usuario;


  if (
    !Number.isInteger(
      idProspecto
    ) ||
    idProspecto <= 0
  ) {

    return res.status(400).json({
      error:
        'Prospecto inválido',
    });

  }


  if (!nombreMipyme) {

    return res.status(400).json({
      error:
        'Debe indicar el nombre del negocio',
    });

  }


  const client =
    await pool.connect();


  try {

    await client.query('BEGIN');


    const advisor =
      await getAdvisorByUser(
        client,
        actorId
      );


    if (!advisor) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(403).json({
        error:
          'El usuario actual no tiene un perfil de asesor activo',
      });

    }


    const prospectResult =
      await client.query(
        `
        SELECT *

        FROM prospecto_cliente

        WHERE id_prospecto = $1
          AND id_asesor = $2

        FOR UPDATE
        `,
        [
          idProspecto,
          advisor.id_asesor,
        ]
      );


    if (
      prospectResult.rows.length ===
      0
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(404).json({
        error:
          'Prospecto no encontrado',
      });

    }


    const prospect =
      prospectResult.rows[0];


    if (
      prospect.estado ===
      'convertido' &&
      prospect.id_usuario_convertido
    ) {

      await client.query(
        'COMMIT'
      );


      return res.status(200).json({

        message:
          'El prospecto ya había sido convertido',

        id_usuario:
          prospect.id_usuario_convertido,

      });

    }


    if (!prospect.correo) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(400).json({
        error:
          'El prospecto no tiene correo electrónico registrado en LINIX',
      });

    }


    const duplicatedDocument =
      await client.query(
        `
        SELECT id_usuario

        FROM usuario

        WHERE TRIM(documento) =
              TRIM($1)

        LIMIT 1
        `,
        [
          prospect.documento
        ]
      );


    if (
      duplicatedDocument.rows.length >
      0
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(409).json({
        error:
          'Ya existe un usuario con este documento',
      });

    }


    const duplicatedEmail =
      await client.query(
        `
        SELECT id_usuario

        FROM usuario

        WHERE LOWER(TRIM(email)) =
              LOWER(TRIM($1))

        LIMIT 1
        `,
        [
          prospect.correo
        ]
      );


    if (
      duplicatedEmail.rows.length >
      0
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(409).json({
        error:
          'Ya existe un usuario con este correo',
      });

    }


    const roleResult =
      await client.query(
        `
        SELECT id_rol

        FROM rol

        WHERE nombre_rol =
              'Cliente'

          AND estado =
              'activo'

        LIMIT 1
        `
      );


    if (
      roleResult.rows.length ===
      0
    ) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(500).json({
        error:
          'No existe el rol Cliente activo',
      });

    }


    const idRolCliente =
      roleResult.rows[0].id_rol;


    const fullName =
      [
        prospect.nombres,
        prospect.apellidos,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();


    if (!fullName) {

      await client.query(
        'ROLLBACK'
      );


      return res.status(400).json({
        error:
          'El prospecto no tiene nombre registrado',
      });

    }


    /*
     * Consistente con el flujo actual:
     * contraseña inicial = documento.
     *
     * Mejoramos además seguridad forzando
     * cambio al primer ingreso.
     */
    const hashedPassword =
      await bcrypt.hash(
        String(
          prospect.documento
        ),
        10
      );


    const userResult =
      await client.query(
        `
        INSERT INTO usuario (
          documento,
          nombre_usuario,
          email,
          telefono,
          password_hash,
          id_rol,
          estado,
          estado_acceso,
          must_change_password,
          created_at,
          created_by
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'activo',
          'activo',
          TRUE,
          NOW(),
          $7
        )
        RETURNING *
        `,
        [
          prospect.documento,

          fullName,

          prospect.correo,

          prospect.celular ||
          null,

          hashedPassword,

          idRolCliente,

          actorId,
        ]
      );


    const user =
      userResult.rows[0];


    let sectorEconomico =
      null;


    if (prospect.codigo_ciiu) {

      try {

        const ciiuItem =
          findCiiuByCode(
            String(
              prospect.codigo_ciiu
            ).trim()
          );


        sectorEconomico =
          ciiuItem?.nombre ||
          ciiuItem?.descripcion ||
          ciiuItem?.actividad ||
          null;

      } catch (_) {

        sectorEconomico =
          null;

      }

    }


    const mipymeResult =
      await client.query(
        `
        INSERT INTO mipyme (
          nombre_mipyme,
          sector_economico,
          municipio,
          direccion,
          codigo_ciiu,
          estado,
          created_at,
          created_by
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'activo',
          NOW(),
          $6
        )
        RETURNING *
        `,
        [
          nombreMipyme,

          sectorEconomico,

          prospect.municipio ||
          null,

          prospect
            .direccion_negocio ||
          null,

          prospect.codigo_ciiu ||
          null,

          actorId,
        ]
      );


    const mipyme =
      mipymeResult.rows[0];


    await client.query(
      `
      INSERT INTO mipyme_usuario (
        id_usuario,
        id_mipyme,
        tipo_relacion
      )
      VALUES (
        $1,
        $2,
        'propietario'
      )
      `,
      [
        user.id_usuario,
        mipyme.id_mipyme,
      ]
    );


    /*
     * Relacionar inmediatamente
     * la Mipyme con el asesor.
     */
    await client.query(
      `
      INSERT INTO asesor_mipyme (
        id_asesor,
        id_mipyme
      )
      VALUES (
        $1,
        $2
      )
      ON CONFLICT (
        id_asesor,
        id_mipyme
      )
      DO NOTHING
      `,
      [
        advisor.id_asesor,
        mipyme.id_mipyme,
      ]
    );


    const updatedProspectResult =
      await client.query(
        `
        UPDATE prospecto_cliente

        SET
          estado =
            'convertido',

          id_usuario_convertido =
            $1,

          converted_at =
            NOW(),

          updated_at =
            NOW()

        WHERE id_prospecto =
              $2

        RETURNING *
        `,
        [
          user.id_usuario,
          idProspecto,
        ]
      );


    await registerAudit(
      client,
      {
        actorId,

        action:
          'CONVERT_PROSPECT_TO_CLIENT',

        entity:
          'prospecto_cliente',

        entityId:
          idProspecto,

        previousData: {
          estado:
            prospect.estado,

          id_usuario_convertido:
            prospect
              .id_usuario_convertido,
        },

        newData: {
          estado:
            'convertido',

          id_usuario:
            user.id_usuario,

          id_mipyme:
            mipyme.id_mipyme,
        },

        reason:
          'El cliente aceptó iniciar el proceso de Finanzas Verdes',

        req,
      }
    );


    await client.query(
      'COMMIT'
    );


    return res.status(201).json({

      message:
        'Prospecto convertido en cliente de Finanzas Verdes',

      usuario:
        user,

      mipyme,

      prospecto:
        updatedProspectResult.rows[0],

    });


  } catch (error) {

    await client.query(
      'ROLLBACK'
    );


    console.error(
      'Error convertirProspecto:',
      error
    );


    return res.status(500).json({
      error:
        error.message ||
        'Error convirtiendo el prospecto en cliente',
    });


  } finally {

    client.release();

  }

}


// ============================================================
// HISTORIAL
// ============================================================

async function getConsultasRecientes(
  req,
  res
) {

  const actorId =
    req.user?.id_usuario;


  try {

    const result =
      await pool.query(
        `
        SELECT
          cc.id_consulta,
          cc.documento,
          cc.resultado,
          cc.decision,
          cc.motivo_descarte_codigo,
          cc.motivo_descarte,
          cc.created_at,
          cc.decision_at,

          pc.id_prospecto,
          pc.nombres,
          pc.apellidos,
          pc.estado AS estado_prospecto

        FROM consulta_cliente cc

        INNER JOIN asesor a
          ON a.id_asesor =
             cc.id_asesor

        LEFT JOIN prospecto_cliente pc
          ON pc.id_consulta_origen =
             cc.id_consulta

        WHERE a.id_usuario =
              $1

        ORDER BY
          cc.created_at DESC

        LIMIT 20
        `,
        [
          actorId
        ]
      );


    return res.status(200).json({

      total:
        result.rows.length,

      consultas:
        result.rows,

    });


  } catch (error) {

    console.error(
      'Error getConsultasRecientes:',
      error
    );


    return res.status(500).json({
      error:
        'Error obteniendo las consultas recientes',
    });

  }

}


module.exports = {
  consultarClienteExterno,
  descartarConsulta,
  agendarProspecto,
  actualizarDecisionProspecto,
  convertirProspecto,
  getConsultasRecientes,
};