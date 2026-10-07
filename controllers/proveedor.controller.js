const pool = require('../db');
const { chromium } = require('playwright');


async function createTipoProveedor(req, res) {
  const {
    nombre_tipo,
    descripcion,
  } = req.body;

  try {
    // ✅ validación básica
    if (!nombre_tipo) {
      return res.status(400).json({
        error: 'nombre_tipo es obligatorio',
      });
    }

    // ✅ insertar
    const result = await pool.query(
      `
      INSERT INTO tipo_proveedor (
        nombre_tipo,
        descripcion,
        estado
      )
      VALUES ($1, $2, 'activo')
      RETURNING *
      `,
      [
        nombre_tipo.trim(),
        descripcion ?? null,
      ]
    );

    return res.status(201).json({
      message: 'Tipo de proveedor creado correctamente',
      tipo_proveedor: result.rows[0],
    });

  } catch (err) {
    console.error('Error al crear tipo_proveedor:', err);

    return res.status(500).json({
      error: 'Error interno al crear tipo_proveedor',
    });
  }
}

async function getTipoProveedores(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT
        id_tipo_proveedor,
        nombre_tipo,
        descripcion
      FROM tipo_proveedor
      ORDER BY nombre_tipo ASC
      `
    );

    return res.status(200).json({
      tipos_proveedor: result.rows,
    });

  } catch (err) {
    console.error('Error al obtener tipos de proveedor:', err);

    return res.status(500).json({
      error: 'Error interno al obtener tipos de proveedor',
    });
  }
}

async function getProveedoresAdmin(req, res) {
  try {
    const {
      buscar,
      estado,
      id_tipo_proveedor,
      origen,
      pagina = '1',
      limite = '20',
    } = req.query;

    const pageNumber = Math.max(parseInt(pagina, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limite, 10) || 20, 1), 100);
    const offset = (pageNumber - 1) * limitNumber;

    const conditions = [];
    const values = [];

    const addCondition = (expression, value) => {
      values.push(value);
      conditions.push(expression.replace('?', `$${values.length}`));
    };

    if (buscar?.trim()) {
      addCondition(
        `(
          d.razon_social ILIKE ?
          OR COALESCE(d.nit, '') ILIKE ?
          OR COALESCE(d.nombre_usuario, '') ILIKE ?
          OR COALESCE(d.email, '') ILIKE ?
        )`,
        `%${buscar.trim()}%`,
      );

      const searchValue = `%${buscar.trim()}%`;
      values.push(searchValue, searchValue, searchValue);

      const index = conditions.length - 1;
      conditions[index] = conditions[index]
          .replace('?', `$${values.length - 2}`)
          .replace('?', `$${values.length - 1}`)
          .replace('?', `$${values.length}`);
    }

    if (estado?.trim()) {
      const normalizedState = estado.trim().toLowerCase();

      if (!['activo', 'inactivo'].includes(normalizedState)) {
        return res.status(400).json({
          error: 'El estado debe ser activo o inactivo',
        });
      }

      addCondition('LOWER(d.estado_proveedor) = ?', normalizedState);
    }

    if (id_tipo_proveedor !== undefined) {
      const typeId = parseInt(id_tipo_proveedor, 10);

      if (Number.isNaN(typeId) || typeId <= 0) {
        return res.status(400).json({
          error: 'id_tipo_proveedor debe ser un número válido',
        });
      }

      addCondition(
        `EXISTS (
          SELECT 1
          FROM proveedor_tipo filtro_pt
          WHERE filtro_pt.id_proveedor = d.id_proveedor
            AND filtro_pt.id_tipo_proveedor = ?
        )`,
        typeId,
      );
    }

    if (origen?.trim()) {
      const normalizedOrigin = origen.trim().toLowerCase();
      const allowedOrigins = [
        'crawler',
        'manual',
        'mixto',
        'sin_catalogo',
      ];

      if (!allowedOrigins.includes(normalizedOrigin)) {
        return res.status(400).json({
          error: 'El origen del catálogo no es válido',
        });
      }

      addCondition('d.origen_catalogo = ?', normalizedOrigin);
    }

    const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

    /*
     * La entidad proveedor se consulta aunque no tenga
     * usuario asociado ni productos en el catálogo.
     */
    const baseCte = `
      WITH proveedor_data AS (
        SELECT
          p.id_proveedor,
          p.razon_social,
          p.nit,
          p.direccion,
          p.calificacion,
          p.estado AS estado_proveedor,
          p.created_at,
          p.updated_at,

          u.id_usuario,
          u.nombre_usuario,
          u.email,
          u.telefono,
          u.estado AS estado_usuario,

          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id_tipo_proveedor', tp.id_tipo_proveedor,
                  'nombre_tipo', tp.nombre_tipo,
                  'descripcion', tp.descripcion
                )
                ORDER BY tp.nombre_tipo
              )
              FROM proveedor_tipo pt
              INNER JOIN tipo_proveedor tp
                ON tp.id_tipo_proveedor = pt.id_tipo_proveedor
              WHERE pt.id_proveedor = p.id_proveedor
            ),
            '[]'::jsonb
          ) AS tipos_proveedor,

          (
            SELECT COUNT(*)::int
            FROM item_catalogo i
            WHERE i.id_proveedor = p.id_proveedor
          ) AS total_productos,

          (
            SELECT COUNT(*)::int
            FROM item_catalogo i
            WHERE i.id_proveedor = p.id_proveedor
              AND i.disponible = true
              AND LOWER(i.estado) = 'activo'
          ) AS productos_disponibles,

          (
            SELECT COUNT(*)::int
            FROM item_catalogo i
            WHERE i.id_proveedor = p.id_proveedor
              AND i.disponible = false
          ) AS productos_no_disponibles,

          (
            SELECT MAX(COALESCE(i.updated_at, i.created_at))
            FROM item_catalogo i
            WHERE i.id_proveedor = p.id_proveedor
          ) AS ultima_actualizacion_catalogo,

          CASE
            WHEN EXISTS (
              SELECT 1
              FROM item_catalogo i
              WHERE i.id_proveedor = p.id_proveedor
                AND i.url_origen IS NOT NULL
            )
            AND EXISTS (
              SELECT 1
              FROM item_catalogo i
              WHERE i.id_proveedor = p.id_proveedor
                AND i.url_origen IS NULL
            )
              THEN 'mixto'

            WHEN EXISTS (
              SELECT 1
              FROM item_catalogo i
              WHERE i.id_proveedor = p.id_proveedor
                AND i.url_origen IS NOT NULL
            )
              THEN 'crawler'

            WHEN EXISTS (
              SELECT 1
              FROM item_catalogo i
              WHERE i.id_proveedor = p.id_proveedor
            )
              THEN 'manual'

            ELSE 'sin_catalogo'
          END AS origen_catalogo

        FROM proveedor p
        LEFT JOIN usuario u
          ON u.id_usuario = p.id_usuario
      )
    `;

    const summaryResult = await pool.query(
      `
      ${baseCte}

      SELECT
        COUNT(*)::int AS total_proveedores,

        COUNT(*) FILTER (
          WHERE LOWER(d.estado_proveedor) = 'activo'
        )::int AS proveedores_activos,

        COUNT(*) FILTER (
          WHERE LOWER(d.estado_proveedor) = 'inactivo'
        )::int AS proveedores_inactivos,

        COUNT(*) FILTER (
          WHERE d.id_usuario IS NOT NULL
        )::int AS con_usuario,

        COUNT(*) FILTER (
          WHERE d.id_usuario IS NULL
        )::int AS sin_usuario,

        COUNT(*) FILTER (
          WHERE d.total_productos > 0
        )::int AS con_productos,

        COUNT(*) FILTER (
          WHERE d.total_productos = 0
        )::int AS sin_productos,

        COALESCE(SUM(d.total_productos), 0)::int AS total_productos,

        COALESCE(SUM(d.productos_disponibles), 0)::int
          AS productos_disponibles

      FROM proveedor_data d
      ${whereClause}
      `,
      values,
    );

    const countResult = await pool.query(
      `
      ${baseCte}

      SELECT COUNT(*)::int AS total
      FROM proveedor_data d
      ${whereClause}
      `,
      values,
    );

    const listValues = [...values, limitNumber, offset];
    const limitPosition = values.length + 1;
    const offsetPosition = values.length + 2;

    const providersResult = await pool.query(
      `
      ${baseCte}

      SELECT d.*
      FROM proveedor_data d
      ${whereClause}

      ORDER BY
        d.razon_social ASC,
        d.id_proveedor ASC

      LIMIT $${limitPosition}
      OFFSET $${offsetPosition}
      `,
      listValues,
    );

    const total = countResult.rows[0]?.total ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limitNumber);

    return res.status(200).json({
      summary: summaryResult.rows[0] ?? {
        total_proveedores: 0,
        proveedores_activos: 0,
        proveedores_inactivos: 0,
        con_usuario: 0,
        sin_usuario: 0,
        con_productos: 0,
        sin_productos: 0,
        total_productos: 0,
        productos_disponibles: 0,
      },
      pagination: {
        pagina: pageNumber,
        limite: limitNumber,
        total_registros: total,
        total_paginas: totalPages,
        tiene_anterior: pageNumber > 1,
        tiene_siguiente: pageNumber < totalPages,
      },
      proveedores: providersResult.rows,
    });
  } catch (error) {
    console.error('Error getProveedoresAdmin:', error);

    return res.status(500).json({
      error: 'Error interno al consultar proveedores',
    });
  }
}


module.exports = {
  createTipoProveedor,
  getTipoProveedores,
  getProveedoresAdmin,
};