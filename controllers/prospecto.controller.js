
'use strict';

const pool = require('../db');

const {
  accesoMipyme
} = require('../services/accesoMipyme');

// ETAPA 1:
// Consulta de clientes registrados en Finanzas Verdes.
// Todavia NO consulta LINIX ni AICOLL.

async function consultarProspecto(req, res) {
  const documento = String(
    req.body?.documento ?? ''
  ).trim();

  const idUsuario = Number(
    req.user?.id_usuario
  );

  if (
    !Number.isSafeInteger(idUsuario) ||
    idUsuario < 1
  ) {
    return res.status(401).json({
      error: 'Usuario no autenticado'
    });
  }

  if (!/^\d{5,15}$/.test(documento)) {
    return res.status(400).json({
      error:
        'Ingrese un documento de 5 a 15 digitos'
    });
  }

  try {
    // Buscar en la base local.
    // No se consulta ningun servicio externo.
    const r = await pool.query(`
      SELECT
        u.id_usuario,
        u.nombre_usuario,
        u.documento,
        u.email,
        u.telefono,

        m.id_mipyme,
        m.nombre_mipyme,
        m.nit,
        m.municipio,
        m.direccion,
        m.codigo_ciiu

      FROM public.usuario u

      JOIN public.rol ro
        ON ro.id_rol = u.id_rol

      JOIN public.mipyme_usuario mu
        ON mu.id_usuario = u.id_usuario

      JOIN public.mipyme m
        ON m.id_mipyme = mu.id_mipyme

      WHERE (
        u.documento = $1
        OR m.nit = $1
      )

        AND lower(ro.nombre_rol) = 'cliente'

        AND u.estado = 'activo'

        AND m.estado IS DISTINCT FROM 'eliminado'

      ORDER BY m.id_mipyme

      LIMIT 50
    `, [documento]);

    // No entregar informacion de empresas
    // que el asesor no puede consultar.
    let fila = null;

    for (const candidato of r.rows) {
      const autorizado = await accesoMipyme(
        pool,
        candidato.id_mipyme,
        idUsuario
      );

      if (autorizado) {
        fila = candidato;
        break;
      }
    }

    if (!fila) {
      return res.status(503).json({
        codigo: 'FUENTE_EXTERNA_PENDIENTE',

        error:
          'No hay información local accesible para ' +
          'este documento. La consulta a LINIX y ' +
          'AICOLL todavía no está integrada; ' +
          'no es posible evaluar al cliente.'
      });
    }

    const clienteLocal = {
      id_usuario: fila.id_usuario,
      nombre_usuario: fila.nombre_usuario,
      documento: fila.documento,
      email: fila.email,
      telefono: fila.telefono,
      id_mipyme: fila.id_mipyme,
      nombre_mipyme: fila.nombre_mipyme,
      direccion_negocio: fila.direccion
    };

    return res.status(200).json({
      cliente: {
        documento: fila.documento,

        // Nombre completo registrado localmente.
        nombres: fila.nombre_usuario,
        apellidos: null,

        municipio: fila.municipio,
        sucursal: null,
        direccion_negocio: fila.direccion,
        codigo_ciiu: fila.codigo_ciiu,
        celular: fila.telefono,
        correo: fila.email
      },

      // No inventar evaluaciones financieras.
      puntajes: {
        puntaje_linix: null,
        puntaje_aicoll: null,
        puntaje_externo: null
      },

      consulta: null,

      estado_local: {
        es_cliente_finanzas_verdes: true,
        cliente: clienteLocal,
        prospecto: null
      },

      origen: 'FINANZAS_VERDES_LOCAL',

      integraciones: {
        linix: 'no_consultado',
        aicoll: 'no_consultado'
      }
    });

  } catch (error) {
    console.error(
      'Consulta local de prospectos:',
      error
    );

    return res.status(500).json({
      error:
        'No fue posible consultar la informacion ' +
        'local del cliente'
    });
  }
}

module.exports = {
  consultarProspecto
};
