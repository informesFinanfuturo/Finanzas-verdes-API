// controllers/roles.controller.js
const pool = require('../db');
const jwt = require('jsonwebtoken');

// GET /api/roles
async function getRols(
  req,
  res
) {
  try {
    /*
     * Cada rol se consulta una sola vez.
     *
     * Las subconsultas evitan duplicar
     * usuarios cuando se relacionan todos
     * los permisos disponibles.
     */
    const rolesQuery = `
      SELECT
        r.id_rol,
        r.nombre_rol,
        r.estado,
        r.created_at,
        r.updated_at,

        (
          SELECT
            COUNT(*)::INTEGER

          FROM usuario u

          WHERE
            u.id_rol =
              r.id_rol
        ) AS total_usuarios,

        (
          SELECT
            COUNT(*)::INTEGER

          FROM usuario u

          WHERE
            u.id_rol =
              r.id_rol

            AND LOWER(
              COALESCE(
                u.estado_acceso,
                'activo'
              )
            ) = 'activo'
        ) AS usuarios_activos,

        (
          SELECT
            COUNT(*)::INTEGER

          FROM permiso_rol pr

          WHERE
            pr.id_rol =
              r.id_rol
        ) AS permisos_asignados,

        CASE
          WHEN LOWER(
            TRIM(
              r.nombre_rol
            )
          ) IN (
            'administrador',
            'super administrador',
            'superadministrador'
          )
          THEN true
          ELSE false
        END AS es_rol_administrativo,

        COALESCE(
          (
            SELECT
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'id_permiso',
                    p.id_permiso,

                  'nombre_permiso',
                    p.nombre,

                  'estado_permiso',
                    p.estado,

                  'enabled',
                    pr.id_permiso
                      IS NOT NULL
                )

                ORDER BY
                  p.nombre ASC
              )

            FROM permiso p

            LEFT JOIN permiso_rol pr
              ON pr.id_permiso =
                p.id_permiso

              AND pr.id_rol =
                r.id_rol
          ),
          '[]'::JSONB
        ) AS permisos

      FROM rol r

      ORDER BY
        CASE
          WHEN LOWER(
            COALESCE(
              r.estado,
              ''
            )
          ) = 'activo'
          THEN 0
          ELSE 1
        END,

        r.nombre_rol ASC
    `;

    /*
     * Resumen global para las tarjetas
     * superiores del centro de control.
     */
    const summaryQuery = `
      SELECT
        (
          SELECT
            COUNT(*)::INTEGER
          FROM rol
        ) AS total_roles,

        (
          SELECT
            COUNT(*)::INTEGER
          FROM rol
          WHERE
            LOWER(
              COALESCE(
                estado,
                ''
              )
            ) = 'activo'
        ) AS roles_activos,

        (
          SELECT
            COUNT(*)::INTEGER
          FROM rol
          WHERE
            LOWER(
              COALESCE(
                estado,
                ''
              )
            ) = 'inactivo'
        ) AS roles_inactivos,

        (
          SELECT
            COUNT(*)::INTEGER
          FROM permiso
        ) AS total_permisos,

        (
          SELECT
            COUNT(*)::INTEGER
          FROM permiso
          WHERE
            LOWER(
              COALESCE(
                estado,
                ''
              )
            ) = 'activo'
        ) AS permisos_activos,

        (
          SELECT
            COUNT(*)::INTEGER

          FROM rol r

          WHERE NOT EXISTS (
            SELECT 1

            FROM permiso_rol pr

            WHERE
              pr.id_rol =
                r.id_rol
          )
        ) AS roles_sin_permisos
    `;

    const [
      rolesResult,
      summaryResult,
    ] = await Promise.all([
      pool.query(
        rolesQuery
      ),

      pool.query(
        summaryQuery
      ),
    ]);

    return res.status(200).json({
      rols:
        rolesResult.rows,

      summary:
        summaryResult.rows[0] ?? {
          total_roles: 0,
          roles_activos: 0,
          roles_inactivos: 0,
          total_permisos: 0,
          permisos_activos: 0,
          roles_sin_permisos: 0,
        },
    });

  } catch (err) {
    console.error(
      'Error al listar roles y permisos:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al listar roles y permisos',
      code:
        'GET_ACCESS_CONTROL_INTERNAL_ERROR',
    });
  }
}

// POST /api/roles

async function createRole(req, res) {
  const {
    nombre_rol,
  } = req.body;

  try {

    if (!nombre_rol) {
      return res.status(400).json({
        error: 'nombre es obligatorio',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO "rol" (
        nombre_rol,
        estado,
        created_at,
        updated_at
      )
      VALUES ($1, 'activo', NOW(), NULL)
      RETURNING
       nombre_rol,
        estado,
        created_at,
        updated_at
      `,
      [
        nombre_rol
      ]
    );

    // 5️⃣ Respuesta
    return res.status(201).json({
      message: 'Rol creado correctamente',
      rol: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear rol:', err);
    return res.status(500).json({
      error: 'Error interno al crear rol',
    });
  }
}

async function updateRol(req, res) {
  const { id } = req.params;

  const {
    nombre_rol,
    estado,
  } = req.body;

  try {
    // 1️⃣ Validaciones básicas
    if (!id) {
      return res.status(400).json({
        error: 'El id del rol es obligatorio',
      });
    }

    // 2️⃣ Verificar que el usuario exista
    const current = await pool.query(
      'SELECT id_rol FROM rol WHERE id_rol = $1',
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Rol no encontrado',
      });
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

    if (nombre_rol) add('nombre_rol', nombre_rol);
    if (estado) add('estado', estado);

    // ✅ Auditoría (SIEMPRE)
    fields.push('updated_at = NOW()');

    if (fields.length === 0) {
      return res.status(400).json({
        error: 'No hay campos para actualizar',
      });
    }

    const result = await pool.query(
      `
      UPDATE rol
      SET ${fields.join(', ')}
      WHERE id_rol = $${index}
      RETURNING
        id_rol,
        nombre_rol,
        estado,
        created_at,
        updated_at
      `,
      [...values, id]
    );

    return res.status(200).json({
      message: 'Rol actualizado correctamente',
      rol: result.rows[0],
    });

  } catch (err) {
    console.error('Error al actualizar rol:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar rol',
    });
  }
}

async function togglePermisoRol(req, res) {
  const { id_rol, id_permiso } = req.body;

  try {
    if (!id_rol || !id_permiso) {
      return res.status(400).json({
        error: 'id_rol e id_permiso son obligatorios',
      });
    }

    // 1️⃣ Verificar si ya existe la relación
    const exists = await pool.query(
      `
      SELECT 1
      FROM permiso_rol
      WHERE id_rol = $1 AND id_permiso = $2
      `,
      [id_rol, id_permiso]
    );

    // 2️⃣ Si existe → eliminar
    if (exists.rows.length > 0) {
      await pool.query(
        `
        DELETE FROM permiso_rol
        WHERE id_rol = $1 AND id_permiso = $2
        `,
        [id_rol, id_permiso]
      );

      return res.status(200).json({
        message: 'Permiso desconectado del rol',
        enabled: false,
      });
    }

    // 3️⃣ Si NO existe → insertar
    await pool.query(
      `
      INSERT INTO permiso_rol (id_rol, id_permiso)
      VALUES ($1, $2)
      `,
      [id_rol, id_permiso]
    );

    return res.status(200).json({
      message: 'Permiso conectado al rol',
      enabled: true,
    });

  } catch (err) {
    console.error('Error al conectar/desconectar permiso:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar permiso del rol',
    });
  }
}

async function getRolById(req, res) {
  const { id } = req.params;

  try {
    if (!id) {
      return res.status(400).json({
        error: 'id_rol es obligatorio',
      });
    }

    const result = await pool.query(
      `
      SELECT
        r.id_rol,
        r.nombre_rol,
        r.estado,
        r.created_at,
        json_agg(
          json_build_object(
            'id_permiso', p.id_permiso,
            'nombre_permiso', p.nombre,
            'enabled', pr.id_permiso IS NOT NULL
          )
          ORDER BY p.id_permiso
        ) AS permisos
      FROM rol r
      CROSS JOIN permiso p
      LEFT JOIN permiso_rol pr
        ON pr.id_rol = r.id_rol
       AND pr.id_permiso = p.id_permiso
      WHERE r.id_rol = $1
      GROUP BY r.id_rol
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Rol no encontrado',
      });
    }

    return res.status(200).json({
      rol: result.rows[0],
    });

  } catch (err) {
    console.error('Error al obtener rol con permisos:', err);
    return res.status(500).json({
      error: 'Error interno al obtener el rol',
    });
  }
}

async function replaceRolePermissions(
  req,
  res
) {
  const roleId =
    Number(
      req.params.id
    );

  const actorId =
    Number(
      req.user
        ?.id_usuario
    );

  const permissionIdsReceived =
    req.body
      ?.permission_ids;

  const reason =
    String(
      req.body
        ?.motivo ?? ''
    ).trim();

  if (
    !Number.isInteger(
      actorId
    ) ||
    actorId <= 0
  ) {
    return res.status(401).json({
      error:
        'No fue posible identificar al administrador',
      code:
        'ADMIN_NOT_IDENTIFIED',
    });
  }

  if (
    !Number.isInteger(
      roleId
    ) ||
    roleId <= 0
  ) {
    return res.status(400).json({
      error:
        'El identificador del rol no es válido',
      code:
        'INVALID_ROLE_ID',
    });
  }

  if (
    !Array.isArray(
      permissionIdsReceived
    )
  ) {
    return res.status(400).json({
      error:
        'permission_ids debe ser una lista',
      code:
        'INVALID_PERMISSION_LIST',
    });
  }

  if (
    reason.length < 5
  ) {
    return res.status(400).json({
      error:
        'Debe indicar un motivo de al menos 5 caracteres',
      code:
        'CHANGE_REASON_REQUIRED',
    });
  }

  /*
   * Convertimos los valores a números,
   * eliminamos repetidos y rechazamos
   * identificadores inválidos.
   */
  const permissionIds =
    [
      ...new Set(
        permissionIdsReceived.map(
          value =>
            Number(value)
        )
      ),
    ];

  const hasInvalidIds =
    permissionIds.some(
      id =>
        !Number.isInteger(id) ||
        id <= 0
    );

  if (hasInvalidIds) {
    return res.status(400).json({
      error:
        'La lista contiene permisos inválidos',
      code:
        'INVALID_PERMISSION_ID',
    });
  }

  const client =
    await pool.connect();

  try {
    await client.query(
      'BEGIN'
    );

    /*
     * Bloqueamos el rol durante la operación
     * para evitar modificaciones simultáneas.
     */
    const roleResult =
      await client.query(
        `
        SELECT
          id_rol,
          nombre_rol,
          estado

        FROM rol

        WHERE
          id_rol = $1

        FOR UPDATE
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
          'Rol no encontrado',
        code:
          'ROLE_NOT_FOUND',
      });
    }

    const role =
      roleResult.rows[0];

    /*
     * Comprobamos que todos los permisos
     * enviados existan y estén activos.
     */
    let selectedPermissions = [];

    if (
      permissionIds.length > 0
    ) {
      const permissionsResult =
        await client.query(
          `
          SELECT
            id_permiso,
            nombre,
            estado

          FROM permiso

          WHERE
            id_permiso =
              ANY(
                $1::INTEGER[]
              )

          ORDER BY
            nombre ASC
          `,
          [
            permissionIds
          ]
        );

      selectedPermissions =
        permissionsResult.rows;

      if (
        selectedPermissions.length !==
        permissionIds.length
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(400).json({
          error:
            'Uno o más permisos no existen',
          code:
            'PERMISSION_NOT_FOUND',
        });
      }

      const inactivePermission =
        selectedPermissions.find(
          permission =>
            String(
              permission.estado ?? ''
            )
              .trim()
              .toLowerCase() !==
            'activo'
        );

      if (inactivePermission) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            `El permiso "${inactivePermission.nombre}" se encuentra inactivo`,
          code:
            'PERMISSION_INACTIVE',
          permission:
            inactivePermission,
        });
      }
    }

    /*
     * Estado anterior del rol.
     */
    const previousResult =
      await client.query(
        `
        SELECT
          p.id_permiso,
          p.nombre

        FROM permiso_rol pr

        INNER JOIN permiso p
          ON p.id_permiso =
            pr.id_permiso

        WHERE
          pr.id_rol = $1

        ORDER BY
          p.nombre ASC
        `,
        [
          roleId
        ]
      );

    const previousPermissions =
      previousResult.rows;

    const previousIds =
      previousPermissions.map(
        permission =>
          Number(
            permission.id_permiso
          )
      );

    const addedIds =
      permissionIds.filter(
        id =>
          !previousIds.includes(id)
      );

    const removedIds =
      previousIds.filter(
        id =>
          !permissionIds.includes(id)
      );

    /*
     * Si no cambió nada, no generamos
     * auditoría ni invalidamos sesiones.
     */
    if (
      addedIds.length === 0 &&
      removedIds.length === 0
    ) {
      await client.query(
        'COMMIT'
      );

      return res.status(200).json({
        message:
          'El rol ya tenía esta configuración',
        changed:
          false,
        permissions:
          previousPermissions,
      });
    }

    /*
     * Reemplazo completo dentro de una única
     * transacción: nunca queda parcialmente
     * actualizado.
     */
    await client.query(
      `
      DELETE FROM permiso_rol

      WHERE
        id_rol = $1
      `,
      [
        roleId
      ]
    );

    if (
      permissionIds.length > 0
    ) {
      await client.query(
        `
        INSERT INTO permiso_rol (
          id_rol,
          id_permiso
        )

        SELECT
          $1,
          permission_id

        FROM UNNEST(
          $2::INTEGER[]
        ) AS permission_id
        `,
        [
          roleId,
          permissionIds,
        ]
      );
    }

    await client.query(
      `
      UPDATE rol

      SET
        updated_at = NOW()

      WHERE
        id_rol = $1
      `,
      [
        roleId
      ]
    );

    /*
     * Un rol administrativo no puede dejar
     * al sistema sin permisos esenciales.
     */
    const normalizedRoleName =
      String(
        role.nombre_rol ?? ''
      )
        .trim()
        .toLowerCase();

    const administrativeNames =
      new Set([
        'administrador',
        'super administrador',
        'superadministrador',
      ]);

    if (
      administrativeNames.has(
        normalizedRoleName
      )
    ) {
      const criticalPermissions = [
        'Obtener roles',
        'Asignar permisos rol',
        'Editar rol',
      ];

      const uncoveredResult =
        await client.query(
          `
          SELECT
            critical.nombre

          FROM UNNEST(
            $1::TEXT[]
          ) AS critical(nombre)

          WHERE NOT EXISTS (
            SELECT 1

            FROM usuario u

            INNER JOIN rol r
              ON r.id_rol =
                u.id_rol

            INNER JOIN permiso_rol pr
              ON pr.id_rol =
                r.id_rol

            INNER JOIN permiso p
              ON p.id_permiso =
                pr.id_permiso

            WHERE
              LOWER(
                COALESCE(
                  u.estado_acceso,
                  'activo'
                )
              ) = 'activo'

              AND LOWER(
                COALESCE(
                  r.estado,
                  ''
                )
              ) = 'activo'

              AND LOWER(
                TRIM(
                  r.nombre_rol
                )
              ) IN (
                'administrador',
                'super administrador',
                'superadministrador'
              )

              AND LOWER(
                TRIM(
                  p.nombre
                )
              ) =
              LOWER(
                TRIM(
                  critical.nombre
                )
              )
          )
          `,
          [
            criticalPermissions
          ]
        );

      if (
        uncoveredResult.rows.length > 0
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'El cambio dejaría al sistema sin permisos administrativos esenciales',
          code:
            'CRITICAL_PERMISSION_REQUIRED',
          permisos_requeridos:
            uncoveredResult.rows.map(
              item =>
                item.nombre
            ),
        });
      }
    }

    /*
     * Los tokens actuales conservan permisos
     * anteriores. Incrementar token_version
     * obliga a iniciar sesión nuevamente.
     */
    const affectedUsersResult =
      await client.query(
        `
        UPDATE usuario

        SET
          token_version =
            COALESCE(
              token_version,
              0
            ) + 1,

          updated_at =
            NOW()

        WHERE
          id_rol = $1

        RETURNING
          id_usuario
        `,
        [
          roleId
        ]
      );

    const affectedUsers =
      affectedUsersResult
        .rows.length;

    const addedPermissions =
      selectedPermissions.filter(
        permission =>
          addedIds.includes(
            Number(
              permission.id_permiso
            )
          )
      );

    const removedPermissions =
      previousPermissions.filter(
        permission =>
          removedIds.includes(
            Number(
              permission.id_permiso
            )
          )
      );

    /*
     * Registro único de auditoría con el
     * estado anterior y el nuevo.
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
        'REPLACE_ROLE_PERMISSIONS',
        'rol',
        $2,
        $3::JSONB,
        $4::JSONB,
        $5,
        $6,
        $7,
        NOW()
      )
      `,
      [
        actorId,

        roleId,

        JSON.stringify({
          id_rol:
            roleId,

          nombre_rol:
            role.nombre_rol,

          permisos:
            previousPermissions,
        }),

        JSON.stringify({
          id_rol:
            roleId,

          nombre_rol:
            role.nombre_rol,

          permisos:
            selectedPermissions,

          agregados:
            addedPermissions,

          retirados:
            removedPermissions,

          usuarios_afectados:
            affectedUsers,
        }),

        reason,

        req.ip ||
          req.socket
            ?.remoteAddress ||
          null,

        req.get(
          'user-agent'
        ) || null,
      ]
    );

    await client.query(
      'COMMIT'
    );

    return res.status(200).json({
      message:
        'Permisos actualizados correctamente',

      changed:
        true,

      role: {
        id_rol:
          roleId,

        nombre_rol:
          role.nombre_rol,
      },

      changes: {
        added:
          addedPermissions,

        removed:
          removedPermissions,

        affected_users:
          affectedUsers,
      },

      permissions:
        selectedPermissions,
    });

  } catch (err) {
    await client.query(
      'ROLLBACK'
    );

    console.error(
      'Error reemplazando permisos del rol:',
      err
    );

    return res.status(500).json({
      error:
        'Error interno al actualizar los permisos del rol',
      code:
        'REPLACE_ROLE_PERMISSIONS_INTERNAL_ERROR',
    });

  } finally {
    client.release();
  }
}

module.exports = {
  getRols,
  createRole,
  updateRol,
  togglePermisoRol,
  getRolById,
  replaceRolePermissions,
};