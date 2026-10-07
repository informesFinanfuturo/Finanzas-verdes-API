const pool = require('../db');
const { requireMipymeAccess } = require('../utils/accessControl');

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function createRequerimiento(req, res) {
  const {
    tipo_requerimiento,
    nombre,
    descripcion,
    especificaciones,
    presupuesto_estimado,
    fecha_limite,
    id_mipyme,
  } = req.body;

  const createdBy = Number(req.user?.id_usuario);
  const idMipyme = Number(id_mipyme);
  const tipo = String(tipo_requerimiento ?? '').trim();
  const nombreLimpio = String(nombre ?? '').trim();
  const descripcionLimpia =
    descripcion == null || String(descripcion).trim().isEmpty
      ? null
      : String(descripcion).trim();

  if (!Number.isInteger(createdBy) || createdBy <= 0) {
    return res.status(401).json({
      error: 'Usuario no autenticado',
    });
  }

  if (!tipo || !nombreLimpio || !Number.isInteger(idMipyme) || idMipyme <= 0) {
    return res.status(400).json({
      error: 'tipo_requerimiento, nombre e id_mipyme son obligatorios',
    });
  }

  if (!isValidDateOnly(fecha_limite)) {
    return res.status(400).json({
      error: 'fecha_limite es obligatoria y debe tener formato YYYY-MM-DD',
    });
  }

  if (fecha_limite < todayIsoDate()) {
    return res.status(400).json({
      error: 'La fecha límite no puede estar en el pasado',
    });
  }

  let specsParsed = null;

  if (especificaciones != null) {
    try {
      specsParsed =
        typeof especificaciones === 'string'
          ? JSON.parse(especificaciones)
          : especificaciones;
    } catch (_) {
      return res.status(400).json({
        error: 'especificaciones debe ser un JSON válido',
      });
    }
  }

  let presupuesto = null;

  if (
    presupuesto_estimado !== undefined &&
    presupuesto_estimado !== null &&
    presupuesto_estimado !== ''
  ) {
    presupuesto = Number(presupuesto_estimado);

    if (!Number.isFinite(presupuesto) || presupuesto < 0) {
      return res.status(400).json({
        error: 'presupuesto_estimado debe ser un número mayor o igual a cero',
      });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await requireMipymeAccess(client, createdBy, idMipyme);

    const result = await client.query(
      `
      INSERT INTO requerimiento (
        tipo_requerimiento,
        nombre,
        descripcion,
        especificaciones,
        presupuesto_estimado,
        fecha_limite,
        id_mipyme,
        estado,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'abierto',
        NOW(), NULL, $8, NULL
      )
      RETURNING *
      `,
      [
        tipo,
        nombreLimpio,
        descripcionLimpia,
        specsParsed,
        presupuesto,
        fecha_limite,
        idMipyme,
        createdBy,
      ]
    );

    const requerimiento = result.rows[0];

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
        'CREATE_REQUIREMENT',
        'requerimiento',
        $2,
        '{}'::jsonb,
        $3::jsonb,
        $4,
        $5,
        $6,
        NOW()
      )
      `,
      [
        createdBy,
        requerimiento.id_requerimiento,
        JSON.stringify({
          tipo_requerimiento: requerimiento.tipo_requerimiento,
          nombre: requerimiento.nombre,
          fecha_limite: requerimiento.fecha_limite,
          id_mipyme: requerimiento.id_mipyme,
          estado: requerimiento.estado,
        }),
        'Creación de requerimiento para proveedores',
        req.ip ?? null,
        req.get('user-agent') ?? null,
      ]
    );

    await client.query('COMMIT');

    try {
      await sendEmailProveedores(requerimiento);
    } catch (emailError) {
      console.error(
        'Error enviando notificaciones a proveedores:',
        emailError
      );
    }

    return res.status(201).json({
      message: 'Requerimiento creado correctamente',
      requerimiento,
    });
  } catch (err) {
    await client.query('ROLLBACK');

    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }

    console.error('Error createRequerimiento:', err);

    return res.status(500).json({
      error: 'Error al crear requerimiento',
    });
  } finally {
    client.release();
  }
}

async function sendEmailProveedores(requerimiento) {
  // TODO: conectar el mecanismo definitivo de notificación a proveedores.
  return true;
}

module.exports = {
  createRequerimiento,
};
