'use strict';
// Reparacion explicita y auditada de referencias antiguas a activos.
const { normalizar, claseActivo } = require('./diagnosticoAlternativas');
const { accesoMipyme } = require('./accesoMipyme');
const pool = require('../db');

const id = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
function nombreDiagnostico(a) { return String(a?.nombre_activo ?? a?.nombre ?? '').trim(); }
function tipoDiagnostico(a) { return String(a?.tipo_activo ?? a?.tipo ?? '').trim(); }
function ubicacion(metricas, idOriginal) {
  const lista = Array.isArray(metricas?.activos) ? metricas.activos : [];
  return lista.filter(x => id(x?.id_activo) === idOriginal);
}
const tipos = {nevera:'Neveras',congelador:'Refrigeración',iluminacion:'Iluminación',
  aire:'Climatización',lavadora:'Lavadoras',secadora:'Secadoras',griferia:'Grifos',
  reductor:'Reductores de caudal',horno:'Hornos',sanitario:'Sanitarios',
  lavavajillas:'Lava vajillas',televisor:'Televisores',vitrina:'Vitrinas'};
function clase(a) { return claseActivo({nombre:nombreDiagnostico(a), tipo:tipoDiagnostico(a)}); }
function candidatosValidos(snapshot, filas) {
  const c=clase(snapshot);
  return filas.filter(row => {
    const cc=claseActivo(row);
    return !!c && c===cc;
  }).sort((a,b) => Number(normalizar(a.nombre)!==normalizar(nombreDiagnostico(snapshot))) -
    Number(normalizar(b.nombre)!==normalizar(nombreDiagnostico(snapshot)))).slice(0,50);
}
function crearControlador({db=pool,acceso=accesoMipyme}={}) {
  async function consultarPendiente({idDiagnostico,idActivo,idMipyme,metricas}, dbClient=db) {
    const coincidencias=ubicacion(metricas,idActivo);
    if(coincidencias.length!==1) return null;
    const snapshot=coincidencias[0];
    const nombre=nombreDiagnostico(snapshot);
    const categoria=clase(snapshot);
    if(!nombre || !categoria) return {codigo:'ACTIVO_SIN_VINCULO',
      error:'El diagnostico no contiene datos suficientes para vincular el activo.',
      opciones:[],puede_registrar:false};
    const r=await dbClient.query(`SELECT id_activo,nombre,tipo,marca,modelo,cantidad
       FROM public.activo WHERE id_mipyme=$1 AND estado IS DISTINCT FROM 'eliminado'
       ORDER BY id_activo`,[idMipyme]);
    return {codigo:'ACTIVO_SIN_VINCULO',
      error:'El activo del diagnostico no coincide con un registro vigente del inventario.',
      activo_diagnostico:{id_activo:idActivo,nombre,tipo:tipoDiagnostico(snapshot)||tipos[categoria],categoria},
      opciones:candidatosValidos(snapshot,r.rows).map(x=>({id_activo:id(x.id_activo),nombre:x.nombre,tipo:x.tipo,marca:x.marca,modelo:x.modelo})),
      puede_registrar:true};
  }
  async function vincular(req,res) {
    const idDiag=id(req.params.idDiagnostico),idAnt=id(req.params.idActivo),usuario=id(req.user?.id_usuario);
    const idReal=id(req.body?.id_activo_real),crear=req.body?.crear_desde_diagnostico===true;
    if(!usuario) return res.status(401).json({error:'Sesion no autenticada'});
    if(!idDiag||!idAnt) return res.status(400).json({error:'Identificadores invalidos'});
    if ((crear && idReal) || (!crear && !idReal)) return res.status(400).json({error:'Indica un activo del inventario o confirma el registro de uno nuevo.'});
    let client;
    try {
      client=await db.connect(); await client.query('BEGIN');
      const r=await client.query(`SELECT id_mipyme,metricas,estado FROM public.diagnostico
        WHERE id_diagnostico=$1 FOR UPDATE`,[idDiag]);
      if(!r.rowCount||r.rows[0].estado==='eliminado'){
        await client.query('ROLLBACK');return res.status(404).json({error:'Diagnostico no encontrado'});
      }
      const d=r.rows[0];
      if(!await acceso(client,d.id_mipyme,usuario)){
        await client.query('ROLLBACK');return res.status(403).json({error:'Sin acceso a la empresa'});
      }
      const coinciden=ubicacion(d.metricas,idAnt);
      if(coinciden.length!==1){
        await client.query('ROLLBACK');return res.status(409).json({error:'La referencia del diagnostico cambio. Actualiza la pantalla.'});
      }
      const snapshot=coinciden[0],categoria=clase(snapshot);
      if(!categoria||!nombreDiagnostico(snapshot)){
        await client.query('ROLLBACK');return res.status(422).json({error:'El diagnostico no permite identificar el equipo. Registra y revisa el activo manualmente.'});
      }
      const yaValido=await client.query(`SELECT 1 FROM public.activo
        WHERE id_activo=$1 AND id_mipyme=$2 AND estado IS DISTINCT FROM 'eliminado'`,[idAnt,d.id_mipyme]);
      if(yaValido.rowCount){
        await client.query('ROLLBACK');return res.status(409).json({error:'Este activo ya existe. Actualiza la pantalla y vuelve a consultar.'});
      }
      let nuevoId=idReal;
      if(crear){
        // Se registra solo por autorizacion expresa del asesor, no se inventan datos tecnicos.
        const nombre=nombreDiagnostico(snapshot).slice(0,250);
        const tipo=tipoDiagnostico(snapshot) || tipos[categoria] || 'Otro';
        const creado=await client.query(`INSERT INTO public.activo
          (nombre,tipo,marca,modelo,descripcion,estado,id_mipyme,created_at,created_by)
          VALUES($1,$2,NULL,NULL,$3,'activo',$4,now(),$5) RETURNING id_activo`,[
          nombre,tipo,`Registrado a solicitud del asesor desde el diagnostico ${idDiag}; datos tecnicos por verificar.`,d.id_mipyme,usuario]);
        nuevoId=id(creado.rows[0].id_activo);
      } else {
        const existente=await client.query(`SELECT id_activo,nombre,tipo FROM public.activo
          WHERE id_activo=$1 AND id_mipyme=$2 AND estado IS DISTINCT FROM 'eliminado'`,[idReal,d.id_mipyme]);
        if(!existente.rowCount || claseActivo(existente.rows[0])!==categoria){
          await client.query('ROLLBACK');return res.status(422).json({error:'El activo no pertenece a la empresa o es de otra categoria.'});
        }
      }
      const metricas=structuredClone(d.metricas||{});
      const repetido=(metricas.activos||[]).some(a=>id(a.id_activo)===nuevoId);
      if(repetido){
        await client.query('ROLLBACK');return res.status(409).json({error:'Este activo ya esta incluido en el diagnostico.'});
      }
      for(const a of metricas.activos){
        if(id(a.id_activo)===idAnt){
          a.id_activo_original=a.id_activo;
          a.id_activo=nuevoId;
          a.vinculacion_inventario={id_anterior:idAnt,id_actual:nuevoId,
            usuario,fecha:new Date().toISOString(),accion:crear?'registro_explicito':'vinculo_explicito'};
        }
      }
      if(Array.isArray(metricas.activos_seleccionados)){
        metricas.activos_seleccionados=metricas.activos_seleccionados.map(x=>id(x)===idAnt?nuevoId:x);
      }
      if(Array.isArray(metricas.alternativas_seleccionadas)){
        metricas.alternativas_seleccionadas=metricas.alternativas_seleccionadas.map(a=>
          id(a?.id_activo)===idAnt?{...a,id_activo:nuevoId}:a);
      }
      const guardado=await client.query(`UPDATE public.diagnostico SET metricas=$2::jsonb,
        updated_at=now(),updated_by=$3 WHERE id_diagnostico=$1 RETURNING *`,[
        idDiag,JSON.stringify(metricas),usuario]);
      await client.query('COMMIT');
      return res.json({ok:true,id_activo_real:nuevoId,creado:crear,diagnostico:guardado.rows[0]});
    }catch(e){
      if(client)try{await client.query('ROLLBACK');}catch(_){}
      console.error('Vincular activo diagnostico:',e);
      return res.status(500).json({error:'No se pudo vincular el activo. No se aplicaron cambios.'});
    }finally{if(client)client.release();}
  }
  return {consultarPendiente,vincular};
}
module.exports={crearControlador,candidatosValidos,ubicacion,id,clase};
