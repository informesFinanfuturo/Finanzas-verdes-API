const ADMIN_ROLES = new Set([
  'administrador',
  'super administrador',
]);

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

async function getActorContext(db, actorId) {
  const id = Number(actorId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const result = await db.query(
    `
    SELECT
      u.id_usuario,
      r.nombre_rol,
      a.id_asesor,
      a.estado AS estado_asesor
    FROM usuario u
    INNER JOIN rol r
      ON r.id_rol = u.id_rol
    LEFT JOIN asesor a
      ON a.id_usuario = u.id_usuario
    WHERE u.id_usuario = $1
    LIMIT 1
    `,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    idUsuario: Number(row.id_usuario),
    role: normalizeRole(row.nombre_rol),
    idAsesor: row.id_asesor == null ? null : Number(row.id_asesor),
    asesorActivo: normalizeRole(row.estado_asesor || 'activo') === 'activo',
  };
}

async function canAccessMipyme(db, actorId, idMipyme) {
  const mipymeId = Number(idMipyme);
  const actor = await getActorContext(db, actorId);

  if (!actor || !Number.isInteger(mipymeId) || mipymeId <= 0) {
    return false;
  }

  if (ADMIN_ROLES.has(actor.role)) {
    return true;
  }

  if (actor.role === 'asesor') {
    if (!actor.idAsesor || !actor.asesorActivo) {
      return false;
    }

    const result = await db.query(
      `
      SELECT 1
      FROM asesor_mipyme
      WHERE id_asesor = $1
        AND id_mipyme = $2
      LIMIT 1
      `,
      [actor.idAsesor, mipymeId],
    );

    return result.rows.length > 0;
  }

  if (actor.role === 'cliente') {
    const result = await db.query(
      `
      SELECT 1
      FROM mipyme_usuario
      WHERE id_usuario = $1
        AND id_mipyme = $2
      LIMIT 1
      `,
      [actor.idUsuario, mipymeId],
    );

    return result.rows.length > 0;
  }

  return false;
}

async function getClientMipymeIds(db, clientUserId) {
  const idUsuario = Number(clientUserId);

  if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
    return [];
  }

  const result = await db.query(
    `
    SELECT mu.id_mipyme
    FROM mipyme_usuario mu
    INNER JOIN usuario u
      ON u.id_usuario = mu.id_usuario
    INNER JOIN rol r
      ON r.id_rol = u.id_rol
    WHERE mu.id_usuario = $1
      AND LOWER(TRIM(r.nombre_rol)) = 'cliente'
    `,
    [idUsuario],
  );

  return result.rows
    .map((row) => Number(row.id_mipyme))
    .filter(Number.isInteger);
}

async function canAccessClient(db, actorId, clientUserId) {
  const ids = await getClientMipymeIds(db, clientUserId);

  if (ids.length === 0) {
    return false;
  }

  for (const idMipyme of ids) {
    if (await canAccessMipyme(db, actorId, idMipyme)) {
      return true;
    }
  }

  return false;
}

async function requireMipymeAccess(db, actorId, idMipyme) {
  const allowed = await canAccessMipyme(db, actorId, idMipyme);

  if (!allowed) {
    const error = new Error('No tiene acceso a la Mipyme indicada');
    error.statusCode = 403;
    error.code = 'MIPYME_ACCESS_DENIED';
    throw error;
  }
}

async function requireClientAccess(db, actorId, clientUserId) {
  const allowed = await canAccessClient(db, actorId, clientUserId);

  if (!allowed) {
    const error = new Error('No tiene acceso al cliente indicado');
    error.statusCode = 403;
    error.code = 'CLIENT_ACCESS_DENIED';
    throw error;
  }
}

async function linkAdvisorToMipyme(db, actorId, idMipyme) {
  const actor = await getActorContext(db, actorId);
  const mipymeId = Number(idMipyme);

  if (!actor || !Number.isInteger(mipymeId) || mipymeId <= 0) {
    return false;
  }

  if (ADMIN_ROLES.has(actor.role)) {
    return true;
  }

  if (actor.role !== 'asesor' || !actor.idAsesor || !actor.asesorActivo) {
    return false;
  }

  await db.query(
    `
    INSERT INTO asesor_mipyme (id_asesor, id_mipyme)
    SELECT $1, $2
    WHERE NOT EXISTS (
      SELECT 1
      FROM asesor_mipyme
      WHERE id_asesor = $1
        AND id_mipyme = $2
    )
    `,
    [actor.idAsesor, mipymeId],
  );

  return true;
}

module.exports = {
  getActorContext,
  canAccessMipyme,
  canAccessClient,
  getClientMipymeIds,
  requireMipymeAccess,
  requireClientAccess,
  linkAdvisorToMipyme,
};
