
'use strict';

async function accesoMipyme(db, idMipyme, idUsuario) {
  if (
    !Number.isSafeInteger(idMipyme) ||
    idMipyme < 1 ||
    !Number.isSafeInteger(idUsuario) ||
    idUsuario < 1
  ) {
    return false;
  }

  const r = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM public.mipyme m
      JOIN public.usuario u
        ON u.id_usuario = $2
      JOIN public.rol ro
        ON ro.id_rol = u.id_rol
      WHERE m.id_mipyme = $1
        AND m.estado IS DISTINCT FROM 'eliminado'
        AND (
          lower(ro.nombre_rol) IN (
            'administrador',
            'super administrador'
          )
          OR (
            lower(ro.nombre_rol) = 'asesor'
            AND EXISTS (
              SELECT 1
              FROM public.asesor a
              JOIN public.asesor_mipyme am
                ON am.id_asesor = a.id_asesor
              WHERE a.id_usuario = u.id_usuario
                AND am.id_mipyme = m.id_mipyme
                AND a.estado = 'activo'
            )
          )
        )
    ) AS permitido
  `, [idMipyme, idUsuario]);

  return r.rows[0]?.permitido === true;
}

module.exports = { accesoMipyme };
