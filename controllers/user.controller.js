// controllers/roles.controller.js
const jwt = require('jsonwebtoken');
const pool = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

function validatePasswordPolicy(
  password
) {
  const value =
    String(password ?? '');

  if (value.length < 10) {
    return {
      valid: false,
      error:
        'La contraseña debe tener al menos 10 caracteres',
    };
  }

  if (!/[A-Z]/.test(value)) {
    return {
      valid: false,
      error:
        'La contraseña debe contener al menos una letra mayúscula',
    };
  }

  if (!/[a-z]/.test(value)) {
    return {
      valid: false,
      error:
        'La contraseña debe contener al menos una letra minúscula',
    };
  }

  if (!/[0-9]/.test(value)) {
    return {
      valid: false,
      error:
        'La contraseña debe contener al menos un número',
    };
  }

  if (
    !/[!@#$%^&*()_\-+=.?]/.test(
      value
    )
  ) {
    return {
      valid: false,
      error:
        'La contraseña debe contener al menos un carácter especial',
    };
  }

  return {
    valid: true,
  };
}

function randomCharacter(
  characters
) {
  return characters[
    crypto.randomInt(
      0,
      characters.length
    )
  ];
}

function generateTemporaryPassword() {
  const uppercase =
    'ABCDEFGHJKLMNPQRSTUVWXYZ';

  const lowercase =
    'abcdefghijkmnopqrstuvwxyz';

  const numbers =
    '23456789';

  const special =
    '!@#$%_-+=';

  const all =
    uppercase +
    lowercase +
    numbers +
    special;

  const characters = [
    randomCharacter(uppercase),
    randomCharacter(lowercase),
    randomCharacter(numbers),
    randomCharacter(special),
  ];

  while (
    characters.length < 14
  ) {
    characters.push(
      randomCharacter(all)
    );
  }

  /*
   * Mezcla criptográficamente los
   * caracteres.
   */
  for (
    let index =
      characters.length - 1;
    index > 0;
    index--
  ) {
    const randomIndex =
      crypto.randomInt(
        0,
        index + 1
      );

    [
      characters[index],
      characters[randomIndex],
    ] = [
      characters[randomIndex],
      characters[index],
    ];
  }

  return characters.join('');
}

async function getUsers(req, res) {
  try {
    const {
      estado_acceso = 'todos',
      estado = 'todos',
      id_rol,
      search = '',
      perfil = 'todos',
      orden = 'recientes',
      page,
      limit,
    } = req.query;

    const perfilNormalizado =
      String(perfil)
        .trim()
        .toLowerCase();

    const estadoAccesoNormalizado =
      String(estado_acceso)
        .trim()
        .toLowerCase();

    const estadoProcesoNormalizado =
      String(estado)
        .trim()
        .toLowerCase();

    const estadosAccesoPermitidos =
      new Set([
        'todos',
        'activo',
        'inactivo',
        'bloqueado',
      ]);

    const estadosProcesoPermitidos =
      new Set([
        'todos',
        'nuevo',
        'activo',
        'pospuesto',
      ]);

    const perfilesPermitidos =
      new Set([
        'todos',
        'completos',
        'incompletos',
      ]);

    if (
      !estadosAccesoPermitidos.has(
        estadoAccesoNormalizado
      )
    ) {
      return res.status(400).json({
        error:
          'El estado de acceso enviado no es válido',
      });
    }

    if (
      !estadosProcesoPermitidos.has(
        estadoProcesoNormalizado
      )
    ) {
      return res.status(400).json({
        error:
          'El estado del proceso enviado no es válido',
      });
    }

    if (
      !perfilesPermitidos.has(
        perfilNormalizado
      )
    ) {
      return res.status(400).json({
        error:
          'El filtro de perfil no es válido',
      });
    }
    /*
     * Se conserva compatibilidad con el
     * frontend actual.
     *
     * Si no llegan page ni limit, se
     * devuelven todos los resultados.
     */
    const usarPaginacion =
      page !== undefined ||
      limit !== undefined;

    const pagina =
      page === undefined
        ? 1
        : Number(page);

    const limiteSolicitado =
      limit === undefined
        ? 20
        : Number(limit);

    if (
      usarPaginacion &&
      (
        !Number.isInteger(pagina) ||
        pagina < 1
      )
    ) {
      return res.status(400).json({
        error:
          'La página debe ser un entero mayor o igual a 1',
      });
    }

    if (
      usarPaginacion &&
      (
        !Number.isInteger(
          limiteSolicitado
        ) ||
        limiteSolicitado < 1
      )
    ) {
      return res.status(400).json({
        error:
          'El límite debe ser un entero mayor o igual a 1',
      });
    }

    /*
     * Evita solicitudes excesivamente
     * grandes cuando se utiliza paginación.
     */
    const limite =
      Math.min(
        limiteSolicitado,
        100
      );

    const offset =
      (pagina - 1) * limite;

    const conditions = [];
    const values = [];

    const addValue = value => {
      values.push(value);

      return `$${values.length}`;
    };

    // =====================================
    // FILTRO POR ESTADO DE ACCESO
    // =====================================

    if (
      estadoAccesoNormalizado !==
      'todos'
    ) {
      const placeholder =
        addValue(
          estadoAccesoNormalizado
        );

      conditions.push(`
        LOWER(
          COALESCE(
            u.estado_acceso,
            'activo'
          )
        ) = ${placeholder}
      `);
    }

    // =====================================
    // FILTRO POR ESTADO DEL PROCESO
    // =====================================

    if (
      estadoProcesoNormalizado !==
      'todos'
    ) {
      const placeholder =
        addValue(
          estadoProcesoNormalizado
        );

      conditions.push(`
        LOWER(
          COALESCE(
            u.estado,
            ''
          )
        ) = ${placeholder}
      `);
    }
    // =====================================
    // FILTRO POR ROL
    // =====================================

    if (
      id_rol !== undefined &&
      id_rol !== null &&
      String(id_rol).trim() !== ''
    ) {
      const idRolNumber =
        Number(id_rol);

      if (
        !Number.isInteger(
          idRolNumber
        ) ||
        idRolNumber <= 0
      ) {
        return res.status(400).json({
          error:
            'El id del rol debe ser un entero válido',
        });
      }

      const placeholder =
        addValue(idRolNumber);

      conditions.push(
        `u.id_rol = ${placeholder}`
      );
    }

    // =====================================
    // BÚSQUEDA GENERAL
    // =====================================

    const searchNormalizado =
      String(search)
        .trim();

    if (
      searchNormalizado
        .length > 0
    ) {
      const placeholder =
        addValue(
          `%${searchNormalizado}%`
        );

      conditions.push(`
        (
          u.nombre_usuario
            ILIKE ${placeholder}
          OR u.email
            ILIKE ${placeholder}
          OR u.documento
            ILIKE ${placeholder}
          OR COALESCE(
            u.telefono,
            ''
          ) ILIKE ${placeholder}
          OR COALESCE(
            r.nombre_rol,
            ''
          ) ILIKE ${placeholder}
        )
      `);
    }

    // =====================================
    // PERFIL COMPLETO / INCOMPLETO
    // =====================================

    const incompleteCondition = `
      (
        (
          LOWER(
            COALESCE(
              r.nombre_rol,
              ''
            )
          ) = 'asesor'
          AND a.id_usuario IS NULL
        )
        OR
        (
          LOWER(
            COALESCE(
              r.nombre_rol,
              ''
            )
          ) = 'proveedor'
          AND p.id_usuario IS NULL
        )
      )
    `;

    if (
      perfilNormalizado ===
      'incompletos'
    ) {
      conditions.push(
        incompleteCondition
      );
    }

    if (
      perfilNormalizado ===
      'completos'
    ) {
      conditions.push(
        `NOT ${incompleteCondition}`
      );
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(
          ' AND '
        )}`
        : '';

    // =====================================
    // ORDENAMIENTO CONTROLADO
    // =====================================

    const orderOptions = {
      recientes:
        'u.created_at DESC',
      antiguos:
        'u.created_at ASC',
      nombre_asc:
        'u.nombre_usuario ASC',
      nombre_desc:
        'u.nombre_usuario DESC',
      ultimo_acceso:
        'u.last_login_at DESC NULLS LAST',
    };

    const orderClause =
      orderOptions[orden] ??
      orderOptions.recientes;

    // =====================================
    // CONSULTA PRINCIPAL
    // =====================================

    const dataValues = [
      ...values
    ];

    let paginationClause = '';

    if (usarPaginacion) {
      dataValues.push(limite);

      const limitPlaceholder =
        `$${dataValues.length}`;

      dataValues.push(offset);

      const offsetPlaceholder =
        `$${dataValues.length}`;

      paginationClause = `
        LIMIT ${limitPlaceholder}
        OFFSET ${offsetPlaceholder}
      `;
    }

    const usersQuery = `
      SELECT
        u.id_usuario,
        u.nombre_usuario,
        u.email,
        u.documento,
        u.telefono,

        u.id_rol,
        r.nombre_rol,
        r.estado AS estado_rol,

        u.estado,
        u.estado_acceso,
        u.estado_observaciones,
        u.estado_changed_at,
        u.estado_changed_by,

        u.last_login_at,
        u.failed_login_attempts,
        u.locked_until,
        u.password_changed_at,
        u.must_change_password,

        u.created_at,
        u.updated_at,
        u.created_by,
        u.updated_by,

        CASE
          WHEN
            LOWER(
              COALESCE(
                r.nombre_rol,
                ''
              )
            ) = 'asesor'
          THEN
            a.id_usuario IS NOT NULL

          WHEN
            LOWER(
              COALESCE(
                r.nombre_rol,
                ''
              )
            ) = 'proveedor'
          THEN
            p.id_usuario IS NOT NULL

          ELSE true
        END AS "usuarioCompleto"

      FROM usuario u

      LEFT JOIN rol r
        ON r.id_rol =
          u.id_rol

      LEFT JOIN asesor a
        ON a.id_usuario =
          u.id_usuario

      LEFT JOIN proveedor p
        ON p.id_usuario =
          u.id_usuario

      ${whereClause}

      ORDER BY ${orderClause}

      ${paginationClause}
    `;

    // =====================================
    // TOTAL SEGÚN FILTROS
    // =====================================

    const countQuery = `
      SELECT
        COUNT(
          DISTINCT u.id_usuario
        )::INTEGER AS total

      FROM usuario u

      LEFT JOIN rol r
        ON r.id_rol =
          u.id_rol

      LEFT JOIN asesor a
        ON a.id_usuario =
          u.id_usuario

      LEFT JOIN proveedor p
        ON p.id_usuario =
          u.id_usuario

      ${whereClause}
    `;

    // =====================================
    // RESUMEN GLOBAL
    // =====================================

    const summaryQuery = `
      SELECT
        COUNT(
          DISTINCT u.id_usuario
        )::INTEGER AS total,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            LOWER(
              COALESCE(
                u.estado,
                ''
              )
            ) = 'activo'
        )::INTEGER AS activos,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            LOWER(
              COALESCE(
                u.estado,
                ''
              )
            ) = 'inactivo'
        )::INTEGER AS inactivos,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            LOWER(
              COALESCE(
                u.estado_acceso,
                ''
              )
            ) = 'bloqueado'
        )::INTEGER AS bloqueados,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            LOWER(
              COALESCE(
                u.estado_acceso,
                ''
              )
            ) = 'nuevo'
        )::INTEGER AS nuevos,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            LOWER(
              COALESCE(
                u.estado_acceso,
                ''
              )
            ) = 'pospuesto'
        )::INTEGER AS pospuestos,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            u.id_rol IS NULL
        )::INTEGER AS sin_rol,

        COUNT(
          DISTINCT u.id_usuario
        ) FILTER (
          WHERE
            (
              LOWER(
                COALESCE(
                  r.nombre_rol,
                  ''
                )
              ) = 'asesor'
              AND a.id_usuario
                IS NULL
            )
            OR
            (
              LOWER(
                COALESCE(
                  r.nombre_rol,
                  ''
                )
              ) = 'proveedor'
              AND p.id_usuario
                IS NULL
            )
        )::INTEGER AS incompletos

      FROM usuario u

      LEFT JOIN rol r
        ON r.id_rol =
          u.id_rol

      LEFT JOIN asesor a
        ON a.id_usuario =
          u.id_usuario

      LEFT JOIN proveedor p
        ON p.id_usuario =
          u.id_usuario
    `;

    const [
      usersResult,
      countResult,
      summaryResult,
    ] = await Promise.all([
      pool.query(
        usersQuery,
        dataValues
      ),

      pool.query(
        countQuery,
        values
      ),

      pool.query(
        summaryQuery
      ),
    ]);

    const filteredTotal =
      Number(
        countResult
          .rows[0]
          ?.total ?? 0
      );

    const totalPages =
      usarPaginacion
        ? Math.max(
          1,
          Math.ceil(
            filteredTotal /
            limite
          )
        )
        : 1;

    return res.status(200).json({
      users:
        usersResult.rows,

      summary:
        summaryResult.rows[0] ?? {
          total: 0,
          activos: 0,
          inactivos: 0,
          bloqueados: 0,
          nuevos: 0,
          pospuestos: 0,
          sin_rol: 0,
          incompletos: 0,
          bloqueos_temporales: 0,
          cambios_password_pendientes: 0,
          sin_primer_ingreso: 0,
        },

      pagination: {
        enabled:
          usarPaginacion,

        page:
          usarPaginacion
            ? pagina
            : 1,

        limit:
          usarPaginacion
            ? limite
            : filteredTotal,

        total:
          filteredTotal,

        total_pages:
          totalPages,
      },

      filters: {
        estado_acceso:
          estadoAccesoNormalizado,

        estado:
          estadoProcesoNormalizado,

        id_rol:
          id_rol == null ||
          String(id_rol)
              .trim()
              .isEmpty
            ? null
            : Number(id_rol),

        search:
          searchNormalizado,

        perfil:
          perfilNormalizado,

        orden:
          orderOptions[orden] != null
            ? orden
            : 'recientes',
      },
    });

  } catch (err) {
    console.error(
      'Error al listar usuarios:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al obtener usuarios',
    });
  }
}

async function getUsersByRol(req, res) {
  const idRol = Number(req.params.id);

  try {
    if (Number.isNaN(idRol)) {
      return res.status(400).json({
        error: 'El id del rol debe ser numérico',
      });
    }

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
        u.estado,
        u.created_at,

        -- ✅ mantener lógica de asesor
        CASE
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NOT NULL THEN true
          WHEN r.nombre_rol = 'Asesor' AND a.id_usuario IS NULL THEN false
          ELSE true
        END AS "usuarioCompleto"

      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      LEFT JOIN asesor a ON a.id_usuario = u.id_usuario
      WHERE u.id_rol = $1
      ORDER BY u.created_at DESC
      `,
      [idRol]
    );

    return res.status(200).json({
      users: result.rows,
    });

  } catch (err) {
    console.error('Error al obtener usuarios por rol:', err);
    return res.status(500).json({
      error: 'Error interno al obtener usuarios',
    });
  }
}

// POST /api/user

async function createUser(
  req,
  res
) {
  const actorId =
    Number(
      req.user?.id_usuario
    );

  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    id_rol,

    // Asesor
    nombre_cargo,
    sede,

    // Proveedor
    razon_social,
    nit,
    direccion,
    calificacion,
    tipos_proveedor,
  } = req.body;

  const normalizedDocument =
    String(
      documento ?? ''
    ).trim();

  const normalizedName =
    String(
      nombre_usuario ?? ''
    ).trim();

  const normalizedEmail =
    String(
      email ?? ''
    )
      .trim()
      .toLowerCase();

  const normalizedPhone =
    String(
      telefono ?? ''
    ).trim() || null;

  const roleId =
    Number(id_rol);

  if (
    !Number.isInteger(actorId) ||
    actorId <= 0
  ) {
    return res.status(401).json({
      error:
        'No fue posible identificar al usuario autenticado',
      code:
        'INVALID_AUTHENTICATED_USER',
    });
  }

  if (
    !normalizedDocument ||
    !normalizedName ||
    !normalizedEmail ||
    !Number.isInteger(roleId) ||
    roleId <= 0
  ) {
    return res.status(400).json({
      error:
        'Documento, nombre, correo y rol son obligatorios',
      code:
        'REQUIRED_USER_DATA',
    });
  }

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    !emailPattern.test(
      normalizedEmail
    )
  ) {
    return res.status(400).json({
      error:
        'El correo electrónico no es válido',
      code:
        'INVALID_EMAIL',
    });
  }

  if (
    tipos_proveedor !== undefined &&
    !Array.isArray(
      tipos_proveedor
    )
  ) {
    return res.status(400).json({
      error:
        'Los tipos de proveedor deben enviarse como una lista',
      code:
        'INVALID_PROVIDER_TYPES',
    });
  }

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    // =====================================
    // VALIDAR ROL
    // =====================================

    const roleResult =
      await client.query(
        `
        SELECT
          id_rol,
          nombre_rol,
          estado

        FROM rol

        WHERE id_rol = $1
        `,
        [
          roleId
        ]
      );

    if (
      roleResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'El rol seleccionado no existe',
        code:
          'ROLE_NOT_FOUND',
      });
    }

    const role =
      roleResult.rows[0];

    const roleStatus =
      String(
        role.estado ?? 'activo'
      )
        .trim()
        .toLowerCase();

    if (
      roleStatus !== 'activo'
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(409).json({
        error:
          'No puede asignar un rol inactivo',
        code:
          'ROLE_INACTIVE',
      });
    }

    const normalizedRole =
      String(
        role.nombre_rol ?? ''
      )
        .trim()
        .toLowerCase();

    // =====================================
    // VALIDAR DATOS DEL PERFIL
    // =====================================

    const normalizedJobName =
      String(
        nombre_cargo ?? ''
      ).trim();

    const normalizedOffice =
      String(
        sede ?? ''
      ).trim();

    const normalizedBusinessName =
      String(
        razon_social ?? ''
      ).trim();

    const normalizedNit =
      String(
        nit ?? ''
      ).trim();

    const normalizedAddress =
      String(
        direccion ?? ''
      ).trim();

    if (
      normalizedRole === 'asesor' &&
      (
        !normalizedJobName ||
        !normalizedOffice
      )
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(400).json({
        error:
          'El cargo y la sede son obligatorios para un asesor',
        code:
          'REQUIRED_ADVISOR_DATA',
      });
    }

    if (
      normalizedRole === 'proveedor' &&
      (
        !normalizedBusinessName ||
        !normalizedNit ||
        !normalizedAddress
      )
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(400).json({
        error:
          'La razón social, el NIT y la dirección son obligatorios para un proveedor',
        code:
          'REQUIRED_PROVIDER_DATA',
      });
    }

    // =====================================
    // DUPLICADOS
    // =====================================

    const duplicatedUser =
      await client.query(
        `
        SELECT
          id_usuario,
          email,
          documento

        FROM usuario

        WHERE
          LOWER(
            TRIM(email)
          ) = $1

          OR TRIM(documento) = $2

        LIMIT 1
        `,
        [
          normalizedEmail,
          normalizedDocument,
        ]
      );

    if (
      duplicatedUser.rows.length > 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      const duplicated =
        duplicatedUser.rows[0];

      const emailDuplicated =
        String(
          duplicated.email ?? ''
        )
          .trim()
          .toLowerCase() ===
        normalizedEmail;

      return res.status(409).json({
        error:
          emailDuplicated
            ? 'Ya existe un usuario con ese correo electrónico'
            : 'Ya existe un usuario con ese documento',
        code:
          emailDuplicated
            ? 'EMAIL_ALREADY_EXISTS'
            : 'DOCUMENT_ALREADY_EXISTS',
      });
    }

    if (
      normalizedRole ===
      'proveedor'
    ) {
      const duplicatedProvider =
        await client.query(
          `
          SELECT
            id_proveedor

          FROM proveedor

          WHERE
            LOWER(
              TRIM(nit)
            ) =
            LOWER(
              TRIM($1)
            )

          LIMIT 1
          `,
          [
            normalizedNit
          ]
        );

      if (
        duplicatedProvider
          .rows.length > 0
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'Ya existe un proveedor con ese NIT',
          code:
            'NIT_ALREADY_EXISTS',
        });
      }
    }

    // =====================================
    // TIPOS DEL PROVEEDOR
    // =====================================

    const providerTypeIds = [
      ...new Set(
        (
          Array.isArray(
            tipos_proveedor
          )
            ? tipos_proveedor
            : []
        )
          .map(Number)
          .filter(
            id =>
              Number.isInteger(id) &&
              id > 0
          )
      ),
    ];

    if (
      normalizedRole ===
        'proveedor' &&
      providerTypeIds.length > 0
    ) {
      const validTypesResult =
        await client.query(
          `
          SELECT
            id_tipo_proveedor

          FROM tipo_proveedor

          WHERE
            id_tipo_proveedor =
            ANY($1::INTEGER[])
          `,
          [
            providerTypeIds
          ]
        );

      if (
        validTypesResult.rows.length !==
        providerTypeIds.length
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'Uno o más tipos de proveedor no son válidos',
          code:
            'INVALID_PROVIDER_TYPE',
        });
      }
    }

    // =====================================
    // CONTRASEÑA TEMPORAL
    // =====================================

    const temporaryPassword =
      generateTemporaryPassword();

    const hashedPassword =
      await bcrypt.hash(
        temporaryPassword,
        12
      );

    // =====================================
    // CREAR USUARIO
    // =====================================

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

          failed_login_attempts,
          locked_until,
          password_changed_at,
          must_change_password,
          token_version,

          created_at,
          updated_at,
          created_by,
          updated_by
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

          0,
          NULL,
          NOW(),
          TRUE,
          0,

          NOW(),
          NULL,
          $7,
          NULL
        )
        RETURNING
          id_usuario,
          documento,
          nombre_usuario,
          email,
          telefono,
          estado,
          estado_acceso,
          must_change_password,
          created_at
        `,
        [
          normalizedDocument,
          normalizedName,
          normalizedEmail,
          normalizedPhone,
          hashedPassword,
          roleId,
          actorId,
        ]
      );

    const newUser =
      userResult.rows[0];

    // =====================================
    // CREAR PERFIL DE ASESOR
    // =====================================

    if (
      normalizedRole ===
      'asesor'
    ) {
      await client.query(
        `
        INSERT INTO asesor (
          nombre_cargo,
          sede,
          id_usuario,
          estado,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (
          $1,
          $2,
          $3,
          'activo',
          NOW(),
          NULL,
          $4,
          NULL
        )
        `,
        [
          normalizedJobName,
          normalizedOffice,
          newUser.id_usuario,
          actorId,
        ]
      );
    }

    // =====================================
    // CREAR PERFIL DE PROVEEDOR
    // =====================================

    if (
      normalizedRole ===
      'proveedor'
    ) {
      const providerResult =
        await client.query(
          `
          INSERT INTO proveedor (
            razon_social,
            nit,
            direccion,
            calificacion,
            id_usuario,
            estado,
            created_at,
            updated_at,
            created_by,
            updated_by
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            'activo',
            NOW(),
            NULL,
            $6,
            NULL
          )
          RETURNING
            id_proveedor
          `,
          [
            normalizedBusinessName,
            normalizedNit,
            normalizedAddress,
            Number(calificacion) ||
              0,
            newUser.id_usuario,
            actorId,
          ]
        );

      const providerId =
        providerResult
          .rows[0]
          .id_proveedor;

      for (
        const providerTypeId
        of providerTypeIds
      ) {
        await client.query(
          `
          INSERT INTO proveedor_tipo (
            id_proveedor,
            id_tipo_proveedor
          )
          VALUES (
            $1,
            $2
          )
          `,
          [
            providerId,
            providerTypeId,
          ]
        );
      }
    }

    // =====================================
    // AUDITORÍA
    // =====================================

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
        'CREATE_USER',
        'usuario',
        $2,
        NULL,
        $3::JSONB,
        $4,
        $5,
        $6,
        NOW()
      )
      `,
      [
        actorId,
        newUser.id_usuario,

        JSON.stringify({
          documento:
            newUser.documento,

          nombre_usuario:
            newUser
              .nombre_usuario,

          email:
            newUser.email,

          id_rol:
            roleId,

          nombre_rol:
            role.nombre_rol,

          estado:
            newUser.estado,

          estado_acceso:
            newUser
              .estado_acceso,

          must_change_password:
            true,
        }),

        'Creación administrativa de usuario',

        req.ip ||
          req.socket
            ?.remoteAddress ||
          null,

        req.get(
          'user-agent'
        ) || null,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message:
        'Usuario creado correctamente',

      user: {
        ...newUser,

        rol: {
          id_rol:
            roleId,

          nombre_rol:
            role.nombre_rol,
        },
      },

      temporary_password:
        temporaryPassword,

      must_change_password:
        true,
    });
  } catch (error) {
    await client.query(
      'ROLLBACK'
    );

    console.error(
      'Error creando usuario:',
      error
    );

    if (
      error.code === '23505'
    ) {
      return res.status(409).json({
        error:
          'Ya existe un registro con esos datos',
        code:
          'DUPLICATE_USER_DATA',
      });
    }

    return res.status(500).json({
      error:
        'No fue posible crear el usuario',
      code:
        'CREATE_USER_INTERNAL_ERROR',
    });
  } finally {
    client.release();
  }
}


// PUT /api/user/:id
async function updateUser(
  req,
  res
) {
  const idUsuario =
    Number(req.params.id);

  const actorId =
    Number(
      req.user?.id_usuario
    );

  const {
    documento,
    nombre_usuario,
    email,
    telefono,
    id_rol,
    estado,

    // Datos de asesor
    nombre_cargo,
    sede,

    // Datos de proveedor
    razon_social,
    nit,
    direccion,
    calificacion,
    tipos_proveedor,
  } = req.body;

  if (
    !Number.isInteger(idUsuario) ||
    idUsuario <= 0
  ) {
    return res.status(400).json({
      error:
        'El id del usuario no es válido',
    });
  }

  if (
    !Number.isInteger(actorId) ||
    actorId <= 0
  ) {
    return res.status(401).json({
      error:
        'No fue posible identificar al usuario autenticado',
    });
  }

  const estadosProcesoPermitidos =
    new Set([
      'nuevo',
      'activo',
      'pospuesto',
      'inactivo',
    ]);

  const estadoNormalizado =
    estado === undefined
      ? undefined
      : String(estado)
          .trim()
          .toLowerCase();

  if (
    estadoNormalizado !==
      undefined &&
    !estadosProcesoPermitidos.has(
      estadoNormalizado
    )
  ) {
    return res.status(400).json({
      error:
        'El estado del proceso no es válido',
    });
  }

  if (
    email !== undefined &&
    String(email).trim().length === 0
  ) {
    return res.status(400).json({
      error:
        'El correo no puede estar vacío',
    });
  }

  if (
    documento !== undefined &&
    String(documento)
        .trim()
        .length === 0
  ) {
    return res.status(400).json({
      error:
        'El documento no puede estar vacío',
    });
  }

  if (
    nombre_usuario !== undefined &&
    String(nombre_usuario)
        .trim()
        .length === 0
  ) {
    return res.status(400).json({
      error:
        'El nombre no puede estar vacío',
    });
  }

  if (
    tipos_proveedor !== undefined &&
    !Array.isArray(
      tipos_proveedor
    )
  ) {
    return res.status(400).json({
      error:
        'Los tipos de proveedor deben enviarse como una lista',
    });
  }

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    // =====================================
    // USUARIO ACTUAL
    // =====================================

    const currentResult =
      await client.query(
        `
        SELECT
          u.id_usuario,
          u.documento,
          u.nombre_usuario,
          u.email,
          u.telefono,
          u.id_rol,
          u.estado,
          u.estado_acceso,
          u.token_version,

          r.nombre_rol

        FROM usuario u

        LEFT JOIN rol r
          ON r.id_rol =
            u.id_rol

        WHERE u.id_usuario = $1

        FOR UPDATE OF u
        `,
        [
          idUsuario
        ]
      );

    if (
      currentResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'Usuario no encontrado',
      });
    }

    const currentUser =
      currentResult.rows[0];

    // =====================================
    // ROL FINAL
    // =====================================

    let finalRoleId =
      currentUser.id_rol;

    if (id_rol !== undefined) {
      const parsedRoleId =
        Number(id_rol);

      if (
        !Number.isInteger(
          parsedRoleId
        ) ||
        parsedRoleId <= 0
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'El rol enviado no es válido',
        });
      }

      finalRoleId =
        parsedRoleId;
    }

    const roleResult =
      await client.query(
        `
        SELECT
          id_rol,
          nombre_rol,
          estado

        FROM rol

        WHERE id_rol = $1
        `,
        [
          finalRoleId
        ]
      );

    if (
      roleResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'El rol seleccionado no existe',
      });
    }

    const finalRole =
      roleResult.rows[0];

    if (
      String(
        finalRole.estado ??
        'activo'
      )
        .trim()
        .toLowerCase() !==
      'activo'
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(409).json({
        error:
          'No puede asignar un rol inactivo',
      });
    }

    const roleChanged =
      Number(currentUser.id_rol) !==
      Number(finalRoleId);

    // =====================================
    // PROTECCIÓN DE LA PROPIA CUENTA
    // =====================================

    if (
      idUsuario === actorId &&
      roleChanged
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(409).json({
        error:
          'No puede modificar el rol de su propia cuenta',
      });
    }

    // =====================================
    // PROTECCIÓN DEL ÚLTIMO ADMINISTRADOR
    // =====================================

    const currentRoleName =
      String(
        currentUser
          .nombre_rol ?? ''
      )
        .trim()
        .toLowerCase();

    const finalRoleName =
      String(
        finalRole
          .nombre_rol ?? ''
      )
        .trim()
        .toLowerCase();

    const administrativeRoles =
      new Set([
        'administrador',
        'super administrador',
        'superadministrador',
      ]);

    const wasAdministrator =
      administrativeRoles.has(
        currentRoleName
      );

    const willBeAdministrator =
      administrativeRoles.has(
        finalRoleName
      );

    if (
      wasAdministrator &&
      !willBeAdministrator &&
      currentUser
        .estado_acceso ===
        'activo'
    ) {
      const otherAdminsResult =
        await client.query(
          `
          SELECT
            COUNT(*)::INTEGER
              AS cantidad

          FROM usuario u

          INNER JOIN rol r
            ON r.id_rol =
              u.id_rol

          WHERE
            u.id_usuario != $1

            AND u.estado_acceso =
              'activo'

            AND LOWER(
              TRIM(
                r.nombre_rol
              )
            ) IN (
              'administrador',
              'super administrador',
              'superadministrador'
            )
          `,
          [
            idUsuario
          ]
        );

      const otherAdministrators =
        Number(
          otherAdminsResult
            .rows[0]
            ?.cantidad ?? 0
        );

      if (
        otherAdministrators === 0
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'No puede cambiar el rol del último administrador activo',
        });
      }
    }

    // =====================================
    // NORMALIZACIÓN
    // =====================================

    const finalDocument =
      documento === undefined
        ? currentUser.documento
        : String(documento).trim();

    const finalName =
      nombre_usuario ===
        undefined
        ? currentUser
            .nombre_usuario
        : String(
            nombre_usuario
          ).trim();

    const finalEmail =
      email === undefined
        ? currentUser.email
        : String(email)
            .trim()
            .toLowerCase();

    const finalPhone =
      telefono === undefined
        ? currentUser.telefono
        : telefono === null ||
            String(telefono)
                .trim()
                .isEmpty
          ? null
          : String(telefono)
              .trim();

    const finalProcessStatus =
      estadoNormalizado ??
      currentUser.estado;

    // =====================================
    // DUPLICADOS
    // =====================================

    const duplicatedEmail =
      await client.query(
        `
        SELECT id_usuario

        FROM usuario

        WHERE
          LOWER(
            TRIM(email)
          ) = $1

          AND id_usuario != $2

        LIMIT 1
        `,
        [
          finalEmail,
          idUsuario,
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
          'Ya existe otro usuario con ese correo',
      });
    }

    const duplicatedDocument =
      await client.query(
        `
        SELECT id_usuario

        FROM usuario

        WHERE
          TRIM(documento) = $1

          AND id_usuario != $2

        LIMIT 1
        `,
        [
          finalDocument,
          idUsuario,
        ]
      );

    if (
      duplicatedDocument
        .rows.length > 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(409).json({
        error:
          'Ya existe otro usuario con ese documento',
      });
    }

    // =====================================
    // ACTUALIZACIÓN DEL USUARIO
    // =====================================

    const updatedUserResult =
      await client.query(
        `
        UPDATE usuario

        SET
          documento = $1,
          nombre_usuario = $2,
          email = $3,
          telefono = $4,
          id_rol = $5,
          estado = $6,

          token_version =
            CASE
              WHEN id_rol != $5
              THEN
                COALESCE(
                  token_version,
                  0
                ) + 1
              ELSE
                token_version
            END,

          updated_at = NOW(),
          updated_by = $7

        WHERE id_usuario = $8

        RETURNING
          id_usuario,
          documento,
          nombre_usuario,
          email,
          telefono,
          id_rol,
          estado,
          estado_acceso,
          token_version,
          created_at,
          updated_at,
          created_by,
          updated_by
        `,
        [
          finalDocument,
          finalName,
          finalEmail,
          finalPhone,
          finalRoleId,
          finalProcessStatus,
          actorId,
          idUsuario,
        ]
      );

    const updatedUser =
      updatedUserResult.rows[0];

    // =====================================
    // PERFIL DE ASESOR
    // =====================================

    const advisorResult =
      await client.query(
        `
        SELECT
          id_asesor,
          nombre_cargo,
          sede,
          estado

        FROM asesor

        WHERE id_usuario = $1

        FOR UPDATE
        `,
        [
          idUsuario
        ]
      );

    const existingAdvisor =
      advisorResult.rows[0] ??
      null;

    if (
      finalRoleName ===
      'asesor'
    ) {
      const finalJobTitle =
        nombre_cargo !==
          undefined
          ? String(
              nombre_cargo
            ).trim()
          : existingAdvisor
              ?.nombre_cargo;

      const finalOffice =
        sede !== undefined
          ? String(sede).trim()
          : existingAdvisor?.sede;

      if (
        !finalJobTitle ||
        !finalOffice
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'El cargo y la sede son obligatorios para el rol Asesor',
        });
      }

      if (existingAdvisor) {
        await client.query(
          `
          UPDATE asesor

          SET
            nombre_cargo = $1,
            sede = $2,
            estado = 'activo',
            updated_at = NOW(),
            updated_by = $3

          WHERE id_usuario = $4
          `,
          [
            finalJobTitle,
            finalOffice,
            actorId,
            idUsuario,
          ]
        );
      } else {
        await client.query(
          `
          INSERT INTO asesor (
            nombre_cargo,
            sede,
            id_usuario,
            estado,
            created_at,
            updated_at,
            created_by,
            updated_by
          )
          VALUES (
            $1,
            $2,
            $3,
            'activo',
            NOW(),
            NULL,
            $4,
            NULL
          )
          `,
          [
            finalJobTitle,
            finalOffice,
            idUsuario,
            actorId,
          ]
        );
      }
    } else if (existingAdvisor) {
      /*
       * No eliminamos el perfil porque
       * puede tener clientes, visitas e
       * historial asociado.
       */
      await client.query(
        `
        UPDATE asesor

        SET
          estado = 'inactivo',
          updated_at = NOW(),
          updated_by = $1

        WHERE id_usuario = $2
        `,
        [
          actorId,
          idUsuario,
        ]
      );
    }

    // =====================================
    // PERFIL DE PROVEEDOR
    // =====================================

    const providerResult =
      await client.query(
        `
        SELECT
          id_proveedor,
          razon_social,
          nit,
          direccion,
          calificacion,
          estado

        FROM proveedor

        WHERE id_usuario = $1

        FOR UPDATE
        `,
        [
          idUsuario
        ]
      );

    const existingProvider =
      providerResult.rows[0] ??
      null;

    let providerId =
      existingProvider
        ?.id_proveedor ??
      null;

    if (
      finalRoleName ===
      'proveedor'
    ) {
      const finalBusinessName =
        razon_social !==
          undefined
          ? String(
              razon_social
            ).trim()
          : existingProvider
              ?.razon_social;

      const finalNit =
        nit !== undefined
          ? String(nit).trim()
          : existingProvider?.nit;

      const finalAddress =
        direccion !== undefined
          ? String(
              direccion
            ).trim()
          : existingProvider
              ?.direccion;

      const finalRating =
        calificacion !==
          undefined
          ? Number(calificacion)
          : Number(
              existingProvider
                ?.calificacion ?? 0
            );

      if (
        !finalBusinessName ||
        !finalNit ||
        !finalAddress
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'La razón social, el NIT y la dirección son obligatorios para el rol Proveedor',
        });
      }

      if (
        !Number.isFinite(
          finalRating
        ) ||
        finalRating < 0 ||
        finalRating > 5
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'La calificación del proveedor debe estar entre 0 y 5',
        });
      }

      const duplicatedNit =
        await client.query(
          `
          SELECT id_proveedor

          FROM proveedor

          WHERE
            LOWER(
              TRIM(nit)
            ) = LOWER(
              TRIM($1)
            )

            AND id_usuario != $2

          LIMIT 1
          `,
          [
            finalNit,
            idUsuario,
          ]
        );

      if (
        duplicatedNit.rows.length >
        0
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'Ya existe otro proveedor con ese NIT',
        });
      }

      if (existingProvider) {
        const providerUpdateResult =
          await client.query(
            `
            UPDATE proveedor

            SET
              razon_social = $1,
              nit = $2,
              direccion = $3,
              calificacion = $4,
              estado = 'activo',
              updated_at = NOW(),
              updated_by = $5

            WHERE id_usuario = $6

            RETURNING
              id_proveedor
            `,
            [
              finalBusinessName,
              finalNit,
              finalAddress,
              finalRating,
              actorId,
              idUsuario,
            ]
          );

        providerId =
          providerUpdateResult
            .rows[0]
            .id_proveedor;
      } else {
        const providerInsertResult =
          await client.query(
            `
            INSERT INTO proveedor (
              razon_social,
              nit,
              direccion,
              calificacion,
              id_usuario,
              estado,
              created_at,
              updated_at,
              created_by,
              updated_by
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              'activo',
              NOW(),
              NULL,
              $6,
              NULL
            )
            RETURNING
              id_proveedor
            `,
            [
              finalBusinessName,
              finalNit,
              finalAddress,
              finalRating,
              idUsuario,
              actorId,
            ]
          );

        providerId =
          providerInsertResult
            .rows[0]
            .id_proveedor;
      }

      /*
       * Solo sincronizamos los tipos si
       * el frontend envió el campo.
       *
       * Esto evita borrar asociaciones
       * accidentalmente durante una
       * edición de otros datos.
       */
      if (
        Array.isArray(
          tipos_proveedor
        )
      ) {
        const normalizedTypes = [
          ...new Set(
            tipos_proveedor.map(
              item => Number(item)
            )
          ),
        ];

        if (
          normalizedTypes.some(
            item =>
              !Number.isInteger(item) ||
              item <= 0
          )
        ) {
          await client.query(
            'ROLLBACK'
          );

          return res.status(400).json({
            error:
              'Uno o más tipos de proveedor no son válidos',
          });
        }

        if (
          normalizedTypes.length >
          0
        ) {
          const validTypesResult =
            await client.query(
              `
              SELECT
                id_tipo_proveedor

              FROM tipo_proveedor

              WHERE
                id_tipo_proveedor =
                ANY($1::INTEGER[])
              `,
              [
                normalizedTypes
              ]
            );

          if (
            validTypesResult
              .rows.length !==
            normalizedTypes.length
          ) {
            await client.query(
              'ROLLBACK'
            );

            return res.status(400).json({
              error:
                'Uno o más tipos de proveedor no existen',
            });
          }
        }

        await client.query(
          `
          DELETE FROM proveedor_tipo

          WHERE id_proveedor = $1
          `,
          [
            providerId
          ]
        );

        for (
          const typeId of
          normalizedTypes
        ) {
          await client.query(
            `
            INSERT INTO proveedor_tipo (
              id_proveedor,
              id_tipo_proveedor
            )
            VALUES ($1, $2)
            `,
            [
              providerId,
              typeId,
            ]
          );
        }
      }
    } else if (existingProvider) {
      /*
       * Conservamos productos, catálogo
       * e historial del proveedor.
       */
      await client.query(
        `
        UPDATE proveedor

        SET
          estado = 'inactivo',
          updated_at = NOW(),
          updated_by = $1

        WHERE id_usuario = $2
        `,
        [
          actorId,
          idUsuario,
        ]
      );
    }

    // =====================================
    // AUDITORÍA
    // =====================================

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
        'usuario',
        $3,
        $4::jsonb,
        $5::jsonb,
        $6,
        $7,
        $8,
        NOW()
      )
      `,
      [
        actorId,

        roleChanged
          ? 'USER_ROLE_CHANGED'
          : 'USER_UPDATED',

        idUsuario,

        JSON.stringify({
          documento:
            currentUser.documento,

          nombre_usuario:
            currentUser
              .nombre_usuario,

          email:
            currentUser.email,

          telefono:
            currentUser.telefono,

          id_rol:
            currentUser.id_rol,

          nombre_rol:
            currentUser
              .nombre_rol,

          estado:
            currentUser.estado,

          token_version:
            currentUser
              .token_version,
        }),

        JSON.stringify({
          documento:
            updatedUser.documento,

          nombre_usuario:
            updatedUser
              .nombre_usuario,

          email:
            updatedUser.email,

          telefono:
            updatedUser.telefono,

          id_rol:
            updatedUser.id_rol,

          nombre_rol:
            finalRole.nombre_rol,

          estado:
            updatedUser.estado,

          token_version:
            updatedUser
              .token_version,
        }),

        roleChanged
          ? `Cambio de rol: ${currentUser.nombre_rol ?? 'Sin rol'} → ${finalRole.nombre_rol}`
          : 'Actualización administrativa del usuario',

        req.ip ?? null,

        req.get(
          'user-agent'
        ) ?? null,
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message:
        roleChanged
          ? 'Usuario y rol actualizados correctamente'
          : 'Usuario actualizado correctamente',

      requires_relogin:
        roleChanged,

      user: {
        ...updatedUser,

        rol: {
          id_rol:
            finalRole.id_rol,

          nombre_rol:
            finalRole.nombre_rol,
        },
      },
    });

  } catch (err) {
    await client.query(
      'ROLLBACK'
    );

    console.error(
      'Error actualizando usuario:',
      err
    );

    if (
      err.code === '23505'
    ) {
      return res.status(409).json({
        error:
          'El correo, documento o NIT ya se encuentra registrado',
      });
    }

    return res.status(500).json({
      error:
        err.message ||
        'Error interno al actualizar el usuario',
    });

  } finally {
    client.release();
  }
}

async function getUserFullDetail(req, res) {
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
        u.id_usuario,
        u.documento,
        u.nombre_usuario,
        u.email,
        u.telefono,

        u.estado,
        u.estado_acceso,
        u.estado_observaciones,
        u.estado_changed_at,
        u.estado_changed_by,

        u.last_login_at,
        u.failed_login_attempts,
        u.locked_until,
        u.password_changed_at,
        u.must_change_password,
        u.token_version,

        u.created_at,
        u.updated_at,

        (
          SELECT
            actor.nombre_usuario

          FROM usuario actor

          WHERE
            actor.id_usuario =
              u.estado_changed_by
        ) AS estado_changed_by_nombre,

        (
          SELECT
            actor.email

          FROM usuario actor

          WHERE
            actor.id_usuario =
              u.estado_changed_by
        ) AS estado_changed_by_email,

        r.id_rol,
        r.nombre_rol,

        a.id_asesor,
        a.nombre_cargo,
        a.sede,

        p.id_proveedor,
        p.razon_social,
        p.nit,
        p.direccion,
        p.calificacion,

        COALESCE(
          json_agg(DISTINCT tp.id_tipo_proveedor)
          FILTER (WHERE tp.id_tipo_proveedor IS NOT NULL),
          '[]'
        ) AS tipos_proveedor

      FROM usuario u
      LEFT JOIN rol r ON r.id_rol = u.id_rol
      LEFT JOIN asesor a ON a.id_usuario = u.id_usuario
      LEFT JOIN proveedor p ON p.id_usuario = u.id_usuario

      LEFT JOIN proveedor_tipo pt ON pt.id_proveedor = p.id_proveedor
      LEFT JOIN tipo_proveedor tp ON tp.id_tipo_proveedor = pt.id_tipo_proveedor

      WHERE u.id_usuario = $1

      GROUP BY
        u.id_usuario,
        r.id_rol,
        a.id_asesor,
  p.id_proveedor;
      `,
      [idUsuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    const row = result.rows[0];

    // ✅ Construcción dinámica del objeto
    let extraData = null;

    if (row.nombre_rol === 'Asesor') {
      extraData = {
        id_asesor: row.id_asesor,
        nombre_cargo: row.nombre_cargo,
        sede: row.sede,
      };
    }

    if (row.nombre_rol === 'Proveedor') {
      
      extraData = {
        id_proveedor: row.id_proveedor,
        razon_social: row.razon_social,
        nit: row.nit,
        direccion: row.direccion,
        calificacion: row.calificacion,
        tipos_proveedor: row.tipos_proveedor
      };

    }

    return res.status(200).json({
      user: {
        id_usuario:
          row.id_usuario,

        documento:
          row.documento,

        nombre_usuario:
          row.nombre_usuario,

        email:
          row.email,

        telefono:
          row.telefono,

        /*
        * Estado del proceso comercial.
        */
        estado:
          row.estado,

        /*
        * Estado de acceso al sistema.
        */
        estado_acceso:
          row.estado_acceso,

        estado_observaciones:
          row.estado_observaciones,

        estado_changed_at:
          row.estado_changed_at,

        estado_changed_by:
          row.estado_changed_by,

        estado_changed_by_user:
          row.estado_changed_by
            ? {
                id_usuario:
                  row.estado_changed_by,

                nombre_usuario:
                  row
                    .estado_changed_by_nombre,

                email:
                  row
                    .estado_changed_by_email,
              }
            : null,

        /*
        * Información de seguridad.
        */
        last_login_at:
          row.last_login_at,

        failed_login_attempts:
          Number(
            row.failed_login_attempts ??
            0
          ),

        locked_until:
          row.locked_until,

        password_changed_at:
          row.password_changed_at,

        must_change_password:
          row.must_change_password ===
          true,

        token_version:
          Number(
            row.token_version ??
            0
          ),

        created_at:
          row.created_at,

        updated_at:
          row.updated_at,

        rol: {
          id_rol:
            row.id_rol,

          nombre_rol:
            row.nombre_rol,
        },

        extra:
          extraData,
      },
    });

  } catch (err) {
    console.error('Error al obtener usuario:', err);
    return res.status(500).json({
      error: 'Error interno al obtener usuario',
    });
  }
}

async function changeUserAccessStatus(
  req,
  res
) {
  const idUsuario =
    Number(req.params.id);

  const actorId =
    Number(
      req.user?.id_usuario
    );

  const {
    estado_acceso,
    motivo,
  } = req.body;

  const nuevoEstado =
    String(
      estado_acceso ?? ''
    )
      .trim()
      .toLowerCase();

  const motivoNormalizado =
    String(
      motivo ?? ''
    )
      .trim();

  const estadosPermitidos =
    new Set([
      'activo',
      'inactivo',
      'bloqueado',
    ]);

  if (
    !Number.isInteger(idUsuario) ||
    idUsuario <= 0
  ) {
    return res.status(400).json({
      error:
        'El id del usuario no es válido',
    });
  }

  if (
    !Number.isInteger(actorId) ||
    actorId <= 0
  ) {
    return res.status(401).json({
      error:
        'No fue posible identificar al usuario autenticado',
    });
  }

  if (
    !estadosPermitidos.has(
      nuevoEstado
    )
  ) {
    return res.status(400).json({
      error:
        'El estado de acceso debe ser activo, inactivo o bloqueado',
    });
  }

  if (
    motivoNormalizado.length < 5
  ) {
    return res.status(400).json({
      error:
        'Debe indicar un motivo de al menos 5 caracteres',
    });
  }

  /*
   * No se permite que un usuario
   * bloquee o desactive su propia
   * cuenta.
   */
  if (
    idUsuario === actorId &&
    nuevoEstado !== 'activo'
  ) {
    return res.status(409).json({
      error:
        'No puede desactivar o bloquear su propia cuenta',
    });
  }

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * Bloqueamos el registro mientras
     * se realiza la operación.
     */
    const userResult =
      await client.query(
        `
        SELECT
          u.id_usuario,
          u.nombre_usuario,
          u.email,
          u.documento,

          u.estado,
          u.estado_acceso,
          u.estado_observaciones,
          u.estado_changed_at,
          u.estado_changed_by,

          u.id_rol,
          u.token_version,

          r.nombre_rol

        FROM usuario u

        LEFT JOIN rol r
          ON r.id_rol =
            u.id_rol

        WHERE u.id_usuario = $1

        FOR UPDATE OF u
        `,
        [
          idUsuario
        ]
      );

    if (
      userResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'Usuario no encontrado',
      });
    }

    const currentUser =
      userResult.rows[0];

    const estadoActual =
      String(
        currentUser
          .estado_acceso ??
        'activo'
      )
        .trim()
        .toLowerCase();

    if (
      estadoActual ===
      nuevoEstado
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(409).json({
        error:
          `El usuario ya se encuentra ${nuevoEstado}`,
      });
    }

    /*
     * Protegemos al último usuario
     * con rol administrativo.
     */
    const normalizedRole =
      String(
        currentUser
          .nombre_rol ?? ''
      )
        .trim()
        .toLowerCase();

    const isAdministrativeRole =
      [
        'administrador',
        'super administrador',
        'superadministrador',
      ].includes(
        normalizedRole
      );

    if (
      isAdministrativeRole &&
      nuevoEstado !== 'activo'
    ) {
      const administratorsResult =
        await client.query(
          `
          SELECT
            COUNT(*)::INTEGER
              AS cantidad

          FROM usuario u

          INNER JOIN rol r
            ON r.id_rol =
              u.id_rol

          WHERE
            u.id_usuario != $1

            AND u.estado_acceso =
              'activo'

            AND LOWER(
              TRIM(
                r.nombre_rol
              )
            ) IN (
              'administrador',
              'super administrador',
              'superadministrador'
            )
          `,
          [
            idUsuario
          ]
        );

      const activeAdministrators =
        Number(
          administratorsResult
            .rows[0]
            ?.cantidad ?? 0
        );

      if (
        activeAdministrators === 0
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'No puede desactivar al último administrador activo del sistema',
        });
      }
    }

    /*
     * token_version aumenta para
     * invalidar los tokens anteriores.
     *
     * Su validación se implementará
     * en el siguiente paso dentro de
     * auth.js.
     */
    const updateResult =
      await client.query(
        `
        UPDATE usuario

        SET
          estado_acceso = $1,

          estado_observaciones =
            $2,

          estado_changed_at =
            NOW(),

          estado_changed_by =
            $3,

          token_version =
            COALESCE(
              token_version,
              0
            ) + 1,

          failed_login_attempts =
            CASE
              WHEN $1 = 'activo'
                THEN 0
              ELSE
                failed_login_attempts
            END,

          locked_until =
            CASE
              WHEN $1 = 'activo'
                THEN NULL
              ELSE
                locked_until
            END,

          updated_at =
            NOW(),

          updated_by =
            $3

        WHERE id_usuario = $4

        RETURNING
          id_usuario,
          nombre_usuario,
          email,
          documento,
          estado,
          estado_acceso,
          estado_observaciones,
          estado_changed_at,
          estado_changed_by,
          token_version,
          updated_at,
          updated_by
        `,
        [
          nuevoEstado,
          motivoNormalizado,
          actorId,
          idUsuario,
        ]
      );

    const updatedUser =
      updateResult.rows[0];

    /*
     * Registro de auditoría.
     */
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
        'usuario',
        $3,
        $4::jsonb,
        $5::jsonb,
        $6,
        $7,
        $8,
        NOW()
      )
      `,
      [
        actorId,

        nuevoEstado === 'activo'
          ? 'USER_REACTIVATED'
          : nuevoEstado ===
              'bloqueado'
            ? 'USER_BLOCKED'
            : 'USER_DEACTIVATED',

        idUsuario,

        JSON.stringify({
          estado_acceso:
            estadoActual,

          token_version:
            currentUser
              .token_version,

          nombre_rol:
            currentUser
              .nombre_rol,
        }),

        JSON.stringify({
          estado_acceso:
            nuevoEstado,

          token_version:
            updatedUser
              .token_version,

          nombre_rol:
            currentUser
              .nombre_rol,
        }),

        motivoNormalizado,

        req.ip ?? null,

        req.get(
          'user-agent'
        ) ?? null,
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message:
        nuevoEstado === 'activo'
          ? 'Usuario reactivado correctamente'
          : nuevoEstado ===
              'bloqueado'
            ? 'Usuario bloqueado correctamente'
            : 'Usuario desactivado correctamente',

      user: {
        ...updatedUser,

        nombre_rol:
          currentUser
            .nombre_rol,
      },
    });

  } catch (err) {
    await client.query(
      'ROLLBACK'
    );

    console.error(
      'Error cambiando estado de acceso:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al cambiar el estado de acceso del usuario',
    });

  } finally {
    client.release();
  }
}

async function resetUserPassword(
  req,
  res
) {
  const idUsuario =
    Number(req.params.id);

  const actorId =
    Number(
      req.user?.id_usuario
    );

  const motivo =
    String(
      req.body?.motivo ?? ''
    )
      .trim();

  if (
    !Number.isInteger(idUsuario) ||
    idUsuario <= 0
  ) {
    return res.status(400).json({
      error:
        'El id del usuario no es válido',
    });
  }

  if (
    !Number.isInteger(actorId) ||
    actorId <= 0
  ) {
    return res.status(401).json({
      error:
        'No fue posible identificar al administrador',
    });
  }

  if (
    idUsuario === actorId
  ) {
    return res.status(409).json({
      error:
        'Para cambiar su propia contraseña utilice la opción de cambio personal',
    });
  }

  if (motivo.length < 5) {
    return res.status(400).json({
      error:
        'Debe indicar un motivo de al menos 5 caracteres',
    });
  }

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult =
      await client.query(
        `
        SELECT
          u.id_usuario,
          u.nombre_usuario,
          u.email,
          u.estado_acceso,
          u.must_change_password,
          u.token_version,
          r.nombre_rol

        FROM usuario u

        LEFT JOIN rol r
          ON r.id_rol =
            u.id_rol

        WHERE u.id_usuario = $1

        FOR UPDATE OF u
        `,
        [
          idUsuario
        ]
      );

    if (
      userResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'Usuario no encontrado',
      });
    }

    const user =
      userResult.rows[0];

    const temporaryPassword =
      generateTemporaryPassword();

    const passwordHash =
      await bcrypt.hash(
        temporaryPassword,
        12
      );

    const updateResult =
      await client.query(
        `
        UPDATE usuario

        SET
          password_hash = $1,

          must_change_password =
            TRUE,

          password_changed_at =
            NOW(),

          token_version =
            COALESCE(
              token_version,
              0
            ) + 1,

          failed_login_attempts =
            0,

          locked_until =
            NULL,

          updated_at =
            NOW(),

          updated_by =
            $2

        WHERE id_usuario = $3

        RETURNING
          id_usuario,
          nombre_usuario,
          email,
          must_change_password,
          password_changed_at,
          token_version
        `,
        [
          passwordHash,
          actorId,
          idUsuario,
        ]
      );


    const updatedUser = updateResult.rows[0];

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
        'USER_PASSWORD_RESET',
        'usuario',
        $2,
        $3::jsonb,
        $4::jsonb,
        $5,
        $6,
        $7,
        NOW()
      )
      `,
      [
        actorId,
        idUsuario,

        JSON.stringify({
          must_change_password:
            user.must_change_password,

          token_version:
            user.token_version,
        }),

        JSON.stringify({
          must_change_password:
            true,

          token_version:
            updatedUser
              .token_version,
        }),

        motivo,

        req.ip ?? null,

        req.get(
          'user-agent'
        ) ?? null,
      ]
    );

    await client.query('COMMIT');

    /*
     * La contraseña temporal se devuelve
     * una sola vez.
     *
     * Nunca se guarda en texto plano.
     */
    return res.status(200).json({
      message:
        'Contraseña restablecida correctamente',

      temporary_password:
        temporaryPassword,

      must_change_password:
        true,

      user: {
        id_usuario:
          updatedUser.id_usuario,

        nombre_usuario:
          updatedUser
            .nombre_usuario,

        email:
          updatedUser.email,
      },
    });

  } catch (err) {
    await client.query(
      'ROLLBACK'
    );

    console.error(
      'Error restableciendo contraseña:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al restablecer la contraseña',
    });

  } finally {
    client.release();
  }
}

async function changeOwnPassword(
  req,
  res
) {
  const idUsuario =
    Number(
      req.user?.id_usuario
    );

  const {
    current_password,
    new_password,
    confirm_password,
  } = req.body;

  if (
    !Number.isInteger(idUsuario) ||
    idUsuario <= 0
  ) {
    return res.status(401).json({
      error:
        'Usuario no autenticado',
    });
  }

  if (
    !current_password ||
    !new_password
  ) {
    return res.status(400).json({
      error:
        'La contraseña actual y la nueva contraseña son obligatorias',
    });
  }

  if (
    confirm_password !==
    undefined &&
    new_password !==
      confirm_password
  ) {
    return res.status(400).json({
      error:
        'La confirmación no coincide con la nueva contraseña',
    });
  }

  const policy =
    validatePasswordPolicy(
      new_password
    );

  if (!policy.valid) {
    return res.status(400).json({
      error:
        policy.error,
    });
  }

  if (
    current_password ===
    new_password
  ) {
    return res.status(400).json({
      error:
        'La nueva contraseña debe ser diferente a la contraseña actual',
    });
  }

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult =
      await client.query(
        `
        SELECT
          id_usuario,
          nombre_usuario,
          email,
          password_hash,
          must_change_password,
          token_version

        FROM usuario

        WHERE id_usuario = $1

        FOR UPDATE
        `,
        [
          idUsuario
        ]
      );

    if (
      userResult.rows.length === 0
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(404).json({
        error:
          'Usuario no encontrado',
      });
    }

    const user =
      userResult.rows[0];

    const currentPasswordValid =
      await bcrypt.compare(
        current_password,
        user.password_hash
      );

    if (
      !currentPasswordValid
    ) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(401).json({
        error:
          'La contraseña actual no es correcta',
        code:
          'INVALID_CURRENT_PASSWORD',
      });
    }

    const samePassword =
      await bcrypt.compare(
        new_password,
        user.password_hash
      );

    if (samePassword) {
      await client.query(
        'ROLLBACK'
      );

      return res.status(400).json({
        error:
          'La nueva contraseña debe ser diferente a la contraseña actual',
      });
    }

    const newPasswordHash =
      await bcrypt.hash(
        new_password,
        12
      );

    const updateResult =
      await client.query(
        `
        UPDATE usuario

        SET
          password_hash = $1,

          must_change_password =
            FALSE,

          password_changed_at =
            NOW(),

          token_version =
            COALESCE(
              token_version,
              0
            ) + 1,

          failed_login_attempts =
            0,

          locked_until =
            NULL,

          updated_at =
            NOW(),

          updated_by =
            $2

        WHERE id_usuario = $2

        RETURNING
          id_usuario,
          must_change_password,
          password_changed_at,
          token_version
        `,
        [
          newPasswordHash,
          idUsuario,
        ]
      );

    const updatedUser =
      updateResult.rows[0];

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
        'USER_PASSWORD_CHANGED',
        'usuario',
        $1,
        $2::jsonb,
        $3::jsonb,
        'Cambio personal de contraseña',
        $4,
        $5,
        NOW()
      )
      `,
      [
        idUsuario,

        JSON.stringify({
          must_change_password:
            user.must_change_password,

          token_version:
            user.token_version,
        }),

        JSON.stringify({
          must_change_password:
            false,

          token_version:
            updatedUser
              .token_version,
        }),

        req.ip ?? null,

        req.get(
          'user-agent'
        ) ?? null,
      ]
    );

    await client.query('COMMIT');

    /*
     * El token actual queda invalidado
     * porque token_version aumentó.
     */
    return res.status(200).json({
      message:
        'Contraseña actualizada correctamente',

      requires_relogin:
        true,
    });

  } catch (err) {
    await client.query(
      'ROLLBACK'
    );

    console.error(
      'Error cambiando contraseña:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al cambiar la contraseña',
    });

  } finally {
    client.release();
  }
}

function sanitizeAuditValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      sanitizeAuditValue
    );
  }

  if (
    typeof value !== 'object'
  ) {
    return value;
  }

  const sensitiveKeys = [
    'password',
    'password_hash',
    'temporary_password',
    'token',
    'secret',
  ];

  const sanitized = {};

  for (
    const [
      key,
      itemValue,
    ] of Object.entries(value)
  ) {
    const normalizedKey =
      key.toLowerCase();

    const isSensitive =
      sensitiveKeys.some(
        sensitiveKey =>
          normalizedKey.includes(
            sensitiveKey
          )
      );

    if (isSensitive) {
      continue;
    }

    sanitized[key] =
      sanitizeAuditValue(
        itemValue
      );
  }

  return sanitized;
}

async function getUserAudit(
  req,
  res
) {
  const idUsuario =
    Number(
      req.params.id
    );

  const page =
    Math.max(
      Number.parseInt(
        req.query.page,
        10
      ) || 1,
      1
    );

  const limit =
    Math.min(
      Math.max(
        Number.parseInt(
          req.query.limit,
          10
        ) || 20,
        1
      ),
      100
    );

  const action =
    String(
      req.query.action ?? ''
    ).trim();

  if (
    !Number.isInteger(idUsuario) ||
    idUsuario <= 0
  ) {
    return res.status(400).json({
      error:
        'El identificador del usuario no es válido',
      code:
        'INVALID_USER_ID',
    });
  }

  try {
    const userResult =
      await pool.query(
        `
        SELECT
          u.id_usuario,
          u.nombre_usuario,
          u.email

        FROM usuario u

        WHERE
          u.id_usuario = $1
        `,
        [
          idUsuario
        ]
      );

    if (
      userResult.rows.length === 0
    ) {
      return res.status(404).json({
        error:
          'El usuario no existe',
        code:
          'USER_NOT_FOUND',
      });
    }

    const conditions = [
      `a.entidad = 'usuario'`,
      `a.id_entidad = $1`,
    ];

    const parameters = [
      idUsuario
    ];

    if (action) {
      parameters.push(action);

      conditions.push(
        `a.accion = $${parameters.length}`
      );
    }

    const whereClause =
      conditions.join(
        ' AND '
      );

    const countResult =
      await pool.query(
        `
        SELECT
          COUNT(*)::INTEGER
            AS total

        FROM audit_log a

        WHERE
          ${whereClause}
        `,
        parameters
      );

    const total =
      Number(
        countResult
          .rows[0]
          ?.total ?? 0
      );

    const totalPages =
      Math.max(
        Math.ceil(
          total / limit
        ),
        1
      );

    const normalizedPage =
      Math.min(
        page,
        totalPages
      );

    const offset =
      (
        normalizedPage - 1
      ) * limit;

    const dataParameters = [
      ...parameters,
      limit,
      offset,
    ];

    const limitPosition =
      dataParameters.length - 1;

    const offsetPosition =
      dataParameters.length;

    const auditResult =
      await pool.query(
        `
        SELECT
          a.id_audit,
          a.id_usuario_actor,
          a.accion,
          a.entidad,
          a.id_entidad,
          a.datos_anteriores,
          a.datos_nuevos,
          a.motivo,
          a.ip,
          a.user_agent,
          a.created_at,

          actor.nombre_usuario
            AS actor_nombre,

          actor.email
            AS actor_email

        FROM audit_log a

        LEFT JOIN usuario actor
          ON actor.id_usuario =
            a.id_usuario_actor

        WHERE
          ${whereClause}

        ORDER BY
          a.created_at DESC,
          a.id_audit DESC

        LIMIT
          $${limitPosition}

        OFFSET
          $${offsetPosition}
        `,
        dataParameters
      );

    const audit =
      auditResult.rows.map(
        item => ({
          ...item,

          datos_anteriores:
            sanitizeAuditValue(
              item.datos_anteriores
            ),

          datos_nuevos:
            sanitizeAuditValue(
              item.datos_nuevos
            ),
        })
      );

    return res.status(200).json({
      user:
        userResult.rows[0],

      audit,

      pagination: {
        page:
          normalizedPage,
        limit,
        total,
        total_pages:
          totalPages,
      },

      filters: {
        action:
          action || null,
      },
    });
  } catch (error) {
    console.error(
      'Error consultando auditoría del usuario:',
      error
    );

    return res.status(500).json({
      error:
        'No fue posible consultar el historial del usuario',
      code:
        'USER_AUDIT_INTERNAL_ERROR',
    });
  }
}

module.exports = {
  getUsers,
  createUser,
  updateUser,
  resetUserPassword,
  changeOwnPassword,
  changeUserAccessStatus,
  getUsersByRol,
  getUserFullDetail,
  getUserAudit,
};