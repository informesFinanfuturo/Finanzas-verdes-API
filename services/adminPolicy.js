'use strict';

// El sistema distingue nombres para futura escalabilidad, pero hoy ambos son
// administradores equivalentes. Nunca se confia en el nombre enviado por Flutter.
function normalizeRole(name) {
  return String(name || '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function isAdministrator(name) {
  return ['administrador', 'super administrador'].includes(normalizeRole(name));
}

function isActiveAccount(row) {
  return String(row.estado || '').toLowerCase() === 'activo' &&
    String(row.estado_acceso || '').toLowerCase() === 'activo' &&
    String(row.estado_rol || 'activo').toLowerCase() === 'activo';
}

const LOCK_KEY = 17023; // Bloqueo transaccional comun para edicion de usuarios/roles.

async function lockAdministratorChanges(db) {
  await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
}

// Se ejecuta dentro de la MISMA transaccion que actualiza el usuario.
// Un segundo administrador activo (de cualquiera de los dos roles) basta.
async function assertKeepsLastAdministrator(db, current, requestedRoleId, requestedState) {
  if (!isAdministrator(current.nombre_rol) || !isActiveAccount(current)) return;
  const newRoleId = requestedRoleId == null ? current.id_rol : Number(requestedRoleId);
  let newRoleName = current.nombre_rol;
  let newRoleState = current.estado_rol;
  if (newRoleId !== Number(current.id_rol)) {
    const r = await db.query(
      'SELECT nombre_rol, estado FROM public.rol WHERE id_rol = $1', [newRoleId]
    );
    if (!r.rowCount) {
      const e = new Error('Rol destino inexistente');e.httpStatus=400;throw e;
    }
    newRoleName = r.rows[0].nombre_rol;
    newRoleState = r.rows[0].estado;
  }
  const remains = isAdministrator(newRoleName) && isActiveAccount({
    estado: requestedState == null ? current.estado : requestedState,
    estado_acceso: current.estado_acceso,
    estado_rol: newRoleState,
  });
  if (remains) return;
  const result = await db.query(`
    SELECT COUNT(*)::int AS total
    FROM public.usuario u
    JOIN public.rol r ON r.id_rol = u.id_rol
    WHERE u.id_usuario <> $1
      AND lower(u.estado) = 'activo'
      AND lower(u.estado_acceso) = 'activo'
      AND lower(r.estado) = 'activo'
      AND lower(trim(r.nombre_rol)) IN ('administrador', 'super administrador')
  `, [current.id_usuario]);
  if (Number(result.rows[0]?.total || 0) < 1) {
    const e = new Error('No puede desactivar o degradar la ultima cuenta administrativa activa');
    e.httpStatus=409;throw e;
  }
}

module.exports = { normalizeRole, isAdministrator, isActiveAccount,
  lockAdministratorChanges, assertKeepsLastAdministrator };
