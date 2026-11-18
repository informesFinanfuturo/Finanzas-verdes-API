'use strict';
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');
const v = require('../services/fveSeleccionValidaciones');

function crearControlador({db=pool,acceso=accesoMipyme}={}) {
  async function procesoAccesible(conexion,idProceso,usuario,bloqueo=false) {
    const resultado=await conexion.query(`SELECT p.*, d.metricas AS metricas_actuales,
      d.estado AS estado_diagnostico, d.titulo AS titulo_diagnostico
      FROM public.fve_proceso p JOIN public.diagnostico d ON d.id_diagnostico=p.id_diagnostico
      WHERE p.id_proceso=$1 ${bloqueo ? 'FOR UPDATE OF p' : ''}`, [idProceso]);
    if (!resultado.rowCount) return {error:'Proceso FVE no encontrado',status:404};
    const p=resultado.rows[0];
    if (!await acceso(conexion,p.id_mipyme,usuario)) return {error:'Sin acceso a este proceso',status:403};
    return {proceso:p};
  }
  function permitirCambios(p) {
    return (p.version_flujo == null || Number(p.version_flujo)===8) &&
      (Number(p.paso_actual)===2 || (Number(p.version_flujo)===8 && Number(p.paso_actual)===3)) &&
      ['en_preparacion','preparacion'].includes(String(p.estado || '').toLowerCase());
  }
  async function comprobarLineas(conexion,p,lineas) {
    const contexto=v.objeto(p.contexto_inicio);
    const foto=v.objeto(v.objeto(contexto.diagnostico).metricas);
    const actual=v.objeto(p.metricas_actuales);
    const diagnosticados=v.lista(actual.activos).length ? actual.activos : v.lista(foto.activos);
    const permitidos=new Set(diagnosticados.map(a=>v.id(a?.id_activo)).filter(Boolean));
    const ids=lineas.map(a=>a.id_activo);
    if(ids.some(id=>!permitidos.has(id))) throw new Error('Un activo no pertenece a este diagnostico.');
    const activos=await conexion.query(`SELECT id_activo,nombre,tipo,cantidad FROM public.activo
      WHERE id_mipyme=$1 AND id_activo=ANY($2::int[]) AND estado IS DISTINCT FROM 'eliminado'`,[p.id_mipyme,ids]);
    if(activos.rowCount!==ids.length) throw new Error('Un activo ya no pertenece al inventario vigente de la empresa.');
    const productosIds=lineas.map(a=>a.id_item).filter(Boolean);
    const productos=productosIds.length ? await conexion.query(`SELECT i.id_item,i.nombre,i.tipo_item,
      i.precio_base,i.disponible,i.estado,p.estado AS proveedor_estado
      FROM public.item_catalogo i JOIN public.proveedor p ON p.id_proveedor=i.id_proveedor
      WHERE i.id_item=ANY($1::int[])`,[productosIds]) : {rows:[]};
    const porActivo=new Map(activos.rows.map(a=>[Number(a.id_activo),a]));
    const porProducto=new Map(productos.rows.map(a=>[Number(a.id_item),a]));
    for(const a of lineas) {
      if(!a.id_item) continue;
      const item=porProducto.get(a.id_item);
      if(!item || !item.disponible || item.estado!=='activo' || item.proveedor_estado!=='activo')
        throw new Error('El producto seleccionado ya no esta disponible: '+a.id_item);
      if(!v.verificarCompatibilidad(porActivo.get(a.id_activo),item))
        throw new Error('El producto '+a.id_item+' no es compatible con el activo '+a.id_activo);
    }
    return {porActivo,porProducto};
  }
  async function guardarLineas(conexion,p,lineas,usuario) {
    await conexion.query('DELETE FROM public.fve_seleccion_linea WHERE id_proceso=$1',[p.id_proceso]);
    for(const linea of lineas) {
      await conexion.query(`INSERT INTO public.fve_seleccion_linea
        (id_proceso,id_activo,id_item,cantidad,origen,updated_by)
        VALUES($1,$2,$3,$4,$5,$6)`,[
          p.id_proceso,linea.id_activo,linea.id_item,linea.cantidad,'asesor_fve',usuario]);
    }
  }
  async function leerSeleccion(req,res) {
    const idProceso=v.id(req.params.idProceso),usuario=v.id(req.user?.id_usuario);
    if(!usuario)return res.status(401).json({error:'Usuario no autenticado'});
    if(!idProceso)return res.status(400).json({error:'Proceso invalido'});
    try {
      const accesoProceso=await procesoAccesible(db,idProceso,usuario);
      if(accesoProceso.error)return res.status(accesoProceso.status).json({error:accesoProceso.error});
      const p=accesoProceso.proceso;
      const guardadas=await db.query('SELECT id_activo,id_item,cantidad,origen FROM public.fve_seleccion_linea WHERE id_proceso=$1 ORDER BY id_linea',[idProceso]);
      const semilla=guardadas.rowCount ? guardadas.rows : v.contextoSeleccion(p.contexto_inicio,p.metricas_actuales);
      const foto=v.objeto(v.objeto(p.contexto_inicio).diagnostico);
      const fotoM=v.objeto(foto.metricas);
      const actuales=v.objeto(p.metricas_actuales);
      const diagnosticos=v.lista(actuales.activos).length ? actuales.activos : v.lista(fotoM.activos);
      const permitidos=new Set(diagnosticos.map(x=>v.id(x?.id_activo)).filter(Boolean));
      const diagnosticosIds=[...permitidos];
      const actualesDb=diagnosticosIds.length ? await db.query(`SELECT id_activo,nombre,tipo,cantidad FROM public.activo WHERE id_mipyme=$1
        AND id_activo=ANY($2::int[]) AND estado IS DISTINCT FROM 'eliminado'`,[p.id_mipyme,diagnosticosIds]) : {rows:[]};
      const dbActivos=new Map(actualesDb.rows.map(a=>[Number(a.id_activo),a]));
      const productosIds=[...new Set(semilla.map(a=>v.id(a.id_item)).filter(Boolean))];
      const rProductos=productosIds.length ? await db.query(`SELECT i.id_item,i.nombre,i.tipo_item,
        i.precio_base,i.disponible,i.estado,i.id_proveedor,p.razon_social AS nombre_proveedor,
        p.estado AS estado_proveedor FROM public.item_catalogo i
        JOIN public.proveedor p ON p.id_proveedor=i.id_proveedor
        WHERE i.id_item=ANY($1::int[])`,[productosIds]) : {rows:[]};
      const dbProductos=new Map(rProductos.rows.map(x=>[Number(x.id_item),x]));
      const lineas=semilla.filter(l=>permitidos.has(v.id(l.id_activo))).map(l=>{
        const a=dbActivos.get(v.id(l.id_activo));
        const item=dbProductos.get(v.id(l.id_item));
        const fotoActivo=diagnosticos.find(x=>v.id(x?.id_activo)===v.id(l.id_activo));
        return {id_activo:v.id(l.id_activo),activo_nombre:a?.nombre ?? fotoActivo?.nombre ?? `Activo #${l.id_activo}`,
          id_item:v.id(l.id_item),nombre_producto:item?.nombre ?? null,nombre_proveedor:item?.nombre_proveedor ?? null,
          precio_base:item?.precio_base ?? null,disponible:!!(item?.disponible && item.estado==='activo' && item.estado_proveedor==='activo'),
          cantidad:Number(l.cantidad)||1,origen:l.origen || 'pendiente'};
      });
      return res.json({lineas,guardado_fve:guardadas.rowCount>0,
        activos_disponibles:actualesDb.rows.map(a=>({id_activo:Number(a.id_activo),nombre:a.nombre, tipo:a.tipo})),
        paso_actual:Number(p.paso_actual),version_flujo:p.version_flujo || null});
    } catch(e) {
      console.error('Consultar seleccion FVE:',e);
      return res.status(500).json({error:'No se pudo consultar la seleccion FVE'});
    }
  }
  async function modificar(req,res,{confirmar=false}={}) {
    const idProceso=v.id(req.params.idProceso),usuario=v.id(req.user?.id_usuario);
    if(!usuario)return res.status(401).json({error:'Usuario no autenticado'});
    if(!idProceso)return res.status(400).json({error:'Proceso invalido'});
    let lineas;
    try {lineas=v.validarLineas(req.body?.lineas,{confirmar});}
    catch(e){return res.status(400).json({error:e.message});}
    let conexion;
    try {
      conexion=await db.connect(); await conexion.query('BEGIN');
      const accesoProceso=await procesoAccesible(conexion,idProceso,usuario,true);
      if(accesoProceso.error) {await conexion.query('ROLLBACK');return res.status(accesoProceso.status).json({error:accesoProceso.error});}
      const p=accesoProceso.proceso;
      if(!permitirCambios(p)) {await conexion.query('ROLLBACK');return res.status(409).json({error:'La negociacion no permite cambios de seleccion en este paso'});}
      try {await comprobarLineas(conexion,p,lineas);} catch(e){
        await conexion.query('ROLLBACK');return res.status(422).json({error:e.message});
      }
      await guardarLineas(conexion,p,lineas,usuario);
      const paso=confirmar ? 3 : 2;
      await conexion.query('UPDATE public.fve_proceso SET paso_actual=$2,version_flujo=8 WHERE id_proceso=$1',[idProceso,paso]);
      await conexion.query(`INSERT INTO public.audit_log
        (id_usuario_actor,accion,entidad,id_entidad,datos_nuevos,motivo,ip,user_agent)
        VALUES($1,$2,'fve_proceso',$3,$4::jsonb,$5,$6,$7)`,[
          usuario,confirmar?'FVE_SELECCION_CONFIRMADA':'FVE_SELECCION_GUARDADA',idProceso,
          JSON.stringify({lineas:lineas.map(l=>({id_activo:l.id_activo,id_item:l.id_item,cantidad:l.cantidad})),paso}),
          confirmar?'Confirmacion de activos y tecnologias':'Actualizacion de seleccion de FVE',req.ip||null,req.get?.('user-agent')||null]);
      await conexion.query('COMMIT');
      return res.json({ok:true,paso_actual:paso,version_flujo:8});
    } catch(e) {
      if(conexion){try{await conexion.query('ROLLBACK');}catch(_){}}
      console.error('Modificar seleccion FVE:',e);
      return res.status(500).json({error:'No se pudo guardar la seleccion FVE'});
    } finally {if(conexion)conexion.release();}
  }
  return {leerSeleccion,guardarBorrador:(req,res)=>modificar(req,res),
    confirmarSeleccion:(req,res)=>modificar(req,res,{confirmar:true})};
}
module.exports={crearControlador};
