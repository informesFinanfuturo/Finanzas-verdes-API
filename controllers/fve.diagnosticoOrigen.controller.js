'use strict';
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');

function id(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function crearControlador({db=pool, acceso=accesoMipyme}={}) {
  async function obtenerDiagnosticoOrigen(req,res) {
    const idProceso=id(req.params.idProceso);
    const usuario=id(req.user?.id_usuario);
    if(!usuario) return res.status(401).json({error:'Sesion no autenticada'});
    if(!idProceso) return res.status(400).json({error:'Proceso FVE invalido'});
    try {
      const origen=await db.query(`SELECT id_proceso,id_mipyme,id_diagnostico
        FROM public.fve_proceso WHERE id_proceso=$1`,[idProceso]);
      if(!origen.rowCount) return res.status(404).json({error:'Proceso FVE no encontrado'});
      const p=origen.rows[0];
      if(!await acceso(db,p.id_mipyme,usuario)) {
        return res.status(403).json({error:'No autorizado para consultar este diagnostico'});
      }
      const d=await db.query(`SELECT * FROM public.diagnostico
        WHERE id_diagnostico=$1 AND id_mipyme=$2
          AND estado IS DISTINCT FROM 'eliminado'`,[p.id_diagnostico,p.id_mipyme]);
      if(!d.rowCount) return res.status(404).json({error:'El diagnostico original ya no esta disponible'});
      const diag=d.rows[0];
      const metricas=diag.metricas && typeof diag.metricas==='object' && !Array.isArray(diag.metricas)
        ? diag.metricas : {};
      // Sin convertir recomendaciones de IA en una seleccion humana.
      return res.json({diagnostico:diag,
        seleccion_guardada:Array.isArray(metricas.activos_seleccionados) && metricas.activos_seleccionados.length>0,
        cantidad_activos_seleccionados:Array.isArray(metricas.activos_seleccionados)?metricas.activos_seleccionados.length:0});
    } catch(e) {
      console.error('FVE diagnostico origen:',e);
      return res.status(500).json({error:'No fue posible cargar el diagnostico de origen'});
    }
  }
  return {obtenerDiagnosticoOrigen};
}
module.exports={crearControlador};
