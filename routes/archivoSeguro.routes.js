'use strict';
const router = require('express').Router();
const path = require('path');
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');

router.get('/:nombre', async (req, res) => {
  const nombre = String(req.params.nombre || '');

  if (!/^[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|gif)$/i.test(nombre)) {
    return res.sendStatus(404);
  }

  try {
    const encontrado = await pool.query(
      'SELECT id_archivo FROM public.archivo WHERE nombre_fisico = $1 LIMIT 1',
      [nombre]
    );

    if (!encontrado.rowCount) return res.sendStatus(404);

    const idArchivo = encontrado.rows[0].id_archivo;
    const actor = Number(req.user.id_usuario);

    const empresas = await pool.query(`
      SELECT DISTINCT id_mipyme FROM (
        SELECT a.id_mipyme
        FROM public.archivo_activo aa
        JOIN public.activo a ON a.id_activo = aa.id_activo
        WHERE aa.id_archivo = $1

        UNION

        SELECT c.id_mipyme
        FROM public.consumo_archivo ca
        JOIN public.consumo c ON c.id_consumo = ca.id_consumo
        WHERE ca.id_archivo = $1
      ) AS relaciones
    `, [idArchivo]);

    let autorizado = false;

    for (const fila of empresas.rows) {
      const empresa = Number(fila.id_mipyme);

      if (await accesoMipyme(pool, empresa, actor)) {
        autorizado = true;
        break;
      }

      const propio = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM public.mipyme_usuario
          WHERE id_mipyme = $1 AND id_usuario = $2
        ) AS permitido
      `, [empresa, actor]);

      if (propio.rows[0]?.permitido) {
        autorizado = true;
        break;
      }
    }

    if (!autorizado) {
      const producto = await pool.query(`
        SELECT EXISTS (
          SELECT 1
          FROM public.item_catalogo_archivo ia
          JOIN public.item_catalogo i
            ON i.id_item = ia.id_item_catalogo
          JOIN public.proveedor p
            ON p.id_proveedor = i.id_proveedor
          WHERE ia.id_archivo = $1
            AND i.disponible IS TRUE
            AND i.estado = 'activo'
            AND p.estado = 'activo'
        ) AS permitido
      `, [idArchivo]);

      autorizado = producto.rows[0]?.permitido === true;
    }

    if (!autorizado) return res.sendStatus(403);

    return res.sendFile(nombre, {
      root: path.join(__dirname, '..', 'uploads'),
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Imagen autenticada:', error);
    return res.sendStatus(500);
  }
});

module.exports = router;
