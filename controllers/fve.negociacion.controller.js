'use strict';
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');
const v = require('../services/fveSeleccionValidaciones');
const n = require('../services/fveNegocio');
const { generarPdfPropuesta } = require('../services/fvePdf');
const json=v=>JSON.stringify(v);
class ErrorHttp extends Error {constructor(status,message){super(message);this.status=status;}}
const fallo=(status,msg)=>{throw new ErrorHttp(status,msg);};
function crearControlador({db=pool,acceso=accesoMipyme}={}){
  async function proceso(conexion,idProceso,usuario,{bloquear=false}={}){
    const r=await conexion.query(`SELECT p.*,d.estado AS diagnostico_estado,
      d.titulo AS diagnostico_titulo,m.nombre_mipyme FROM public.fve_proceso p
      JOIN public.diagnostico d ON d.id_diagnostico=p.id_diagnostico
      JOIN public.mipyme m ON m.id_mipyme=p.id_mipyme
      WHERE p.id_proceso=$1 ${bloquear?'FOR UPDATE OF p':''}`,[idProceso]);
    if(!r.rowCount)fallo(404,'Negociacion FVE no encontrada');
    const p=r.rows[0];
    if(!await acceso(conexion,p.id_mipyme,usuario))fallo(403,'Sin acceso a esta empresa');
    if(p.diagnostico_estado==='eliminado')fallo(409,'El diagnostico de origen ya no esta vigente');
    return p;
  }
  const validaUsuario=req=>{
    const usuario=n.id(req.user?.id_usuario),idProceso=n.id(req.params.idProceso);
    if(!usuario)fallo(401,'Sesion no autenticada');
    if(!idProceso)fallo(400,'Proceso FVE invalido');
    return {usuario,idProceso};
  };
  async function ult(conexion,idProceso,soloPresentadas=false){
    const r=await conexion.query(`SELECT id_propuesta,id_proceso,numero_version,estado,
      detalle,total_inversion,created_at,presented_at,pdf_sha256,created_by FROM public.fve_propuesta_version
      WHERE id_proceso=$1 ${soloPresentadas?"AND estado='presentada'":''}
      ORDER BY numero_version DESC LIMIT 1`,[idProceso]);
    return r.rows[0]||null;
  }
  async function detalleEstado(conexion,idProceso){
    const [pr,dec,fin,via,cie,ev]=await Promise.all([
      conexion.query(`SELECT id_propuesta,numero_version,estado,total_inversion,created_at,presented_at,pdf_sha256,
        detalle FROM public.fve_propuesta_version WHERE id_proceso=$1 ORDER BY numero_version DESC`,[idProceso]),
      conexion.query(`SELECT d.*,p.numero_version FROM public.fve_decision_propuesta d JOIN public.fve_propuesta_version p
        ON p.id_propuesta=d.id_propuesta WHERE p.id_proceso=$1 ORDER BY d.id_decision DESC`,[idProceso]),
      conexion.query(`SELECT f.*,p.numero_version FROM public.fve_financiamiento_propuesta f JOIN public.fve_propuesta_version p
        ON p.id_propuesta=f.id_propuesta WHERE p.id_proceso=$1 ORDER BY f.id_financiamiento DESC`,[idProceso]),
      conexion.query(`SELECT v.*,p.numero_version FROM public.fve_viabilidad_propuesta v JOIN public.fve_propuesta_version p
        ON p.id_propuesta=v.id_propuesta WHERE p.id_proceso=$1 ORDER BY v.id_viabilidad DESC`,[idProceso]),
      conexion.query(`SELECT * FROM public.fve_cierre_negociacion WHERE id_proceso=$1`,[idProceso]),
      conexion.query(`SELECT id_evento,accion,detalle,created_by,created_at FROM public.fve_evento_negociacion
        WHERE id_proceso=$1 ORDER BY id_evento DESC LIMIT 100`,[idProceso]),
    ]);
    return {propuestas:pr.rows,decisiones:dec.rows,financiaciones:fin.rows,viabilidades:via.rows,
      cierre:cie.rows[0]||null,historial:ev.rows};
  }
  function paso(p,esperado){
    if(Number(p.version_flujo)!==8)fallo(409,'La negociacion debe utilizar el flujo de ocho pasos');
    if(Number(p.paso_actual)!==esperado)fallo(409,`Esta operacion requiere el paso ${esperado}; paso actual ${p.paso_actual}`);
  }
  async function evento(db,p,usuario,accion,detalle={}){
    await db.query(`INSERT INTO public.fve_evento_negociacion(id_proceso,accion,detalle,created_by)
      VALUES($1,$2,$3::jsonb,$4)`,[p.id_proceso,accion,json(detalle),usuario]);
  }
  async function withTx(req,res,op){
    let conn;
    try{
      const {usuario,idProceso}=validaUsuario(req);
      conn=await db.connect();await conn.query('BEGIN');
      const p=await proceso(conn,idProceso,usuario,{bloquear:true});
      if((await conn.query('SELECT 1 FROM public.fve_cierre_negociacion WHERE id_proceso=$1',[idProceso])).rowCount)
        fallo(409,'La negociacion ya fue cerrada y no admite modificaciones');
      const respuesta=await op(conn,p,usuario);
      await conn.query('COMMIT');return res.json(respuesta);
    }catch(e){if(conn)try{await conn.query('ROLLBACK');}catch(_){}
      if(!(e instanceof ErrorHttp))console.error('FVE transaccion:',e);
      return res.status(e.status||500).json({error:e instanceof ErrorHttp?e.message:'No fue posible completar la operacion FVE'});
    }finally{if(conn)conn.release();}
  }
  async function consultar(req,res){
    try{
      const {usuario,idProceso}=validaUsuario(req);
      const p=await proceso(db,idProceso,usuario);
      const d=await detalleEstado(db,idProceso);
      return res.json({proceso:{id_proceso:p.id_proceso,id_diagnostico:p.id_diagnostico,
        nombre_mipyme:p.nombre_mipyme,estado:p.estado,paso_actual:Number(p.paso_actual),version_flujo:p.version_flujo},...d});
    }catch(e){if(!(e instanceof ErrorHttp))console.error('Consultar negociacion:',e);
      return res.status(e.status||500).json({error:e instanceof ErrorHttp?e.message:'No fue posible consultar la negociacion'});}
  }
  async function diagnosticoOrigen(req,res){
    try{
      const {usuario,idProceso}=validaUsuario(req);
      const p=await proceso(db,idProceso,usuario);
      const r=await db.query(`SELECT d.* FROM public.diagnostico d
        WHERE d.id_diagnostico=$1 AND d.id_mipyme=$2 AND d.estado IS DISTINCT FROM 'eliminado'`,
        [p.id_diagnostico,p.id_mipyme]);
      if(!r.rowCount)fallo(404,'El diagnostico de origen ya no existe');
      return res.json({diagnostico:r.rows[0]});
    }catch(e){if(!(e instanceof ErrorHttp))console.error('Diagnostico FVE:',e);
      return res.status(e.status||500).json({error:e instanceof ErrorHttp?e.message:'No se pudo recuperar el diagnostico'});}
  }
  async function obtenerLineas(conexion,p){
    const r=await conexion.query(`SELECT s.id_activo,s.id_item,s.cantidad,a.nombre AS activo_nombre,a.tipo AS activo_tipo,
      i.nombre AS producto_nombre,i.tipo_item,i.precio_base,i.disponible,i.estado AS producto_estado,
      i.id_proveedor,proveedor.razon_social AS proveedor_nombre,proveedor.estado AS proveedor_estado,
      ev.id_evaluacion,ev.estado AS estado_ambiental,ev.apto_para_propuesta,ev.ahorro_anual_estimado,
      ev.unidad AS unidad_ahorro,ev.version_parametros AS version_regla
      FROM public.fve_seleccion_linea s
      JOIN public.activo a ON a.id_activo=s.id_activo AND a.id_mipyme=$2 AND a.estado IS DISTINCT FROM 'eliminado'
      JOIN public.item_catalogo i ON i.id_item=s.id_item
      JOIN public.proveedor proveedor ON proveedor.id_proveedor=i.id_proveedor
      LEFT JOIN LATERAL (SELECT e.id_evaluacion,e.estado,e.apto_para_propuesta,e.ahorro_anual_estimado,
        e.unidad,e.version_parametros FROM public.fve_evaluacion_activo e
        WHERE e.id_proceso=$1 AND e.id_activo=s.id_activo AND e.id_item=s.id_item
        ORDER BY e.id_evaluacion DESC LIMIT 1) ev ON true
      WHERE s.id_proceso=$1 ORDER BY s.id_linea`,[p.id_proceso,p.id_mipyme]);
    const totalFilas=await conexion.query('SELECT count(*)::integer AS n FROM public.fve_seleccion_linea WHERE id_proceso=$1',[p.id_proceso]);
    if(!r.rowCount||r.rowCount!==Number(totalFilas.rows[0].n))fallo(422,'La seleccion contiene activos o productos no disponibles. Regresa al paso 2.');
    for(const l of r.rows){
      if(!l.id_item || !l.disponible || l.producto_estado!=='activo'||l.proveedor_estado!=='activo')
        fallo(409,`Producto ${l.id_item||'(sin elegir)'} no disponible. Regresa a la seleccion`);
      if(!v.verificarCompatibilidad({nombre:l.activo_nombre,tipo:l.activo_tipo},
        {nombre:l.producto_nombre,tipo_item:l.tipo_item}))fallo(422,'Producto no compatible con el activo '+l.id_activo);
      if(!Number.isSafeInteger(Number(l.precio_base))||Number(l.precio_base)<0)fallo(422,'Precio no valido del catalogo para el producto '+l.id_item);
    }
    return r.rows.map(l=>({id_activo:l.id_activo,activo_nombre:l.activo_nombre,
      id_item:l.id_item,producto_nombre:l.producto_nombre,id_proveedor:l.id_proveedor,
      proveedor_nombre:l.proveedor_nombre,precio_unitario:Number(l.precio_base),cantidad:Number(l.cantidad),
      estado_ambiental:l.apto_para_propuesta===true&&l.estado_ambiental==='elegible'?'elegible':
        (l.estado_ambiental==='elegible'?'pendiente_validacion':(l.estado_ambiental||'pendiente_dato')),id_evaluacion:l.id_evaluacion,
      ahorro_estimado_anual:l.apto_para_propuesta===true&&l.estado_ambiental==='elegible'?
        l.ahorro_anual_estimado:null,unidad_ahorro:l.unidad_ahorro,version_regla:l.version_regla}));
  }
  async function prepararPropuesta(req,res){return withTx(req,res,async(c,p,u)=>{
    if(![3,4].includes(Number(p.paso_actual)))fallo(409,'Confirma la seleccion antes de elaborar la propuesta');
    if(Number(p.version_flujo)!==8)fallo(409,'Flujo FVE incompatible');
    const lineas=await obtenerLineas(c,p);
    const detalle=n.crearDetalle(lineas,{id_proceso:p.id_proceso,id_diagnostico:p.id_diagnostico,
      nombre_mipyme:p.nombre_mipyme,observacion:req.body?.observacion});
    const anterior=await ult(c,p.id_proceso);
    let r;
    if(anterior?.estado==='borrador'){
      r=await c.query(`UPDATE public.fve_propuesta_version SET detalle=$2::jsonb,
        total_inversion=$3,updated_at=now() WHERE id_propuesta=$1 AND estado='borrador'
        RETURNING id_propuesta,numero_version,estado,detalle,total_inversion`,[anterior.id_propuesta,json(detalle),detalle.total_inversion]);
    }else{
      const numero=Number(anterior?.numero_version||0)+1;
      r=await c.query(`INSERT INTO public.fve_propuesta_version
        (id_proceso,numero_version,estado,detalle,total_inversion,created_by)
        VALUES($1,$2,'borrador',$3::jsonb,$4,$5)
        RETURNING id_propuesta,numero_version,estado,detalle,total_inversion`,[p.id_proceso,numero,json(detalle),detalle.total_inversion,u]);
    }
    await c.query('UPDATE public.fve_proceso SET paso_actual=4,version_flujo=8 WHERE id_proceso=$1',[p.id_proceso]);
    await evento(c,p,u,'BORRADOR_PREPARADO',{id_propuesta:r.rows[0].id_propuesta,version:r.rows[0].numero_version,total:detalle.total_inversion});
    return {ok:true,paso_actual:4,propuesta:r.rows[0]};
  });}
  async function volverAPropuesta(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,4);
    const borrador=await ult(c,p.id_proceso);
    if(!borrador || borrador.estado!=='borrador')fallo(409,'La propuesta ya no es editable');
    await c.query('UPDATE public.fve_proceso SET paso_actual=3 WHERE id_proceso=$1',[p.id_proceso]);
    await evento(c,p,u,'BORRADOR_DEVUELTO_A_PROPUESTA',{id_propuesta:borrador.id_propuesta});
    return {ok:true,paso_actual:3};
  });}
  async function vistaPreviaPdf(req,res){
    let conexion;
    try{
      const {usuario,idProceso}=validaUsuario(req);
      const idPropuesta=n.id(req.params.idPropuesta);
      if(!idPropuesta)fallo(400,'Propuesta invalida');
      conexion=await db.connect();
      await conexion.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const p=await proceso(conexion,idProceso,usuario);
      paso(p,4);
      const actual=await ult(conexion,idProceso);
      if(!actual || Number(actual.id_propuesta)!==idPropuesta || actual.estado!=='borrador')
        fallo(409,'No existe un borrador actual para previsualizar');
      await conexion.query('COMMIT');conexion.release();conexion=null;
      const pdf=await generarPdfPropuesta({...actual,diagnostico_titulo:p.diagnostico_titulo});
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`inline; filename="FVE_${idProceso}_V${actual.numero_version}_vista-previa.pdf"`);
      res.setHeader('Cache-Control','private, no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      return res.send(pdf.buffer);
    }catch(e){
      if(conexion)try{await conexion.query('ROLLBACK');}catch(_){}
      if(!(e instanceof ErrorHttp))console.error('Vista previa FVE:',e);
      const status=e.status||500;
      return res.status(status).json({error:e instanceof ErrorHttp?e.message:
        status===503?'No fue posible preparar el PDF en el servidor. Verifica el motor de impresion.':
        'No fue posible generar la vista previa de esta propuesta'});
    }finally{if(conexion)conexion.release();}
  }
  async function presentar(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,4);const actual=await ult(c,p.id_proceso);
    if(!actual||actual.estado!=='borrador')fallo(409,'No existe borrador editable de propuesta');
    const detalle=actual.detalle;
    const ids=detalle.lineas.map(l=>l.id_item);
    const items=await c.query(`SELECT i.id_item,i.precio_base,i.disponible,i.estado,p.estado AS proveedor_estado
      FROM public.item_catalogo i JOIN public.proveedor p ON p.id_proveedor=i.id_proveedor
      WHERE i.id_item=ANY($1::int[]) FOR SHARE OF i,p`,[ids]);
    const cambio=n.cambioPrecio(detalle,items.rows);
    if(cambio)fallo(409,cambio);
    const pdf=await generarPdfPropuesta({...actual,diagnostico_titulo:p.diagnostico_titulo});
    const r=await c.query(`UPDATE public.fve_propuesta_version SET estado='presentada',
      presented_at=now(),pdf_bytes=$2,pdf_sha256=$3 WHERE id_propuesta=$1 AND estado='borrador'
      RETURNING id_propuesta,numero_version,pdf_sha256`,[actual.id_propuesta,pdf.buffer,pdf.sha256]);
    if(!r.rowCount)fallo(409,'La propuesta ya se presento');
    await c.query('UPDATE public.fve_proceso SET paso_actual=5 WHERE id_proceso=$1',[p.id_proceso]);
    await evento(c,p,u,'PROPUESTA_PRESENTADA',{id_propuesta:actual.id_propuesta,sha256:pdf.sha256});
    return {ok:true,paso_actual:5,propuesta:r.rows[0],paginas:pdf.paginas};
  });}
  async function descargarPdf(req,res){
    try{
      const {usuario,idProceso}=validaUsuario(req),idPropuesta=n.id(req.params.idPropuesta);
      if(!idPropuesta)fallo(400,'Propuesta invalida');
      await proceso(db,idProceso,usuario);
      const r=await db.query(`SELECT id_propuesta,numero_version,pdf_bytes,pdf_sha256 FROM public.fve_propuesta_version
        WHERE id_proceso=$1 AND id_propuesta=$2 AND estado='presentada'`,[idProceso,idPropuesta]);
      if(!r.rowCount||!r.rows[0].pdf_bytes)fallo(404,'PDF no disponible');
      const p=r.rows[0];res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition',`attachment; filename="FVE_${idProceso}_V${p.numero_version}.pdf"`);
      res.setHeader('Cache-Control','private, no-store');
      return res.send(p.pdf_bytes);
    }catch(e){if(!(e instanceof ErrorHttp))console.error('Descargar propuesta:',e);
      return res.status(e.status||500).json({error:e instanceof ErrorHttp?e.message:'No se pudo descargar la propuesta'});}
  }
  async function decision(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,5);const actual=await ult(c,p.id_proceso,true);
    if(!actual)fallo(409,'Primero presenta una propuesta PDF');
    const decision=String(req.body?.decision||'');
    if(!['interesado','suspendido','desinteresado'].includes(decision))fallo(400,'Decision invalida');
    const observacion=n.texto(req.body?.observacion,1500);
    const r=await c.query(`INSERT INTO public.fve_decision_propuesta
      (id_propuesta,decision,observacion,created_by) VALUES($1,$2,$3,$4) RETURNING *`,
      [actual.id_propuesta,decision,observacion,u]);
    const siguiente=decision==='interesado'?6:decision==='desinteresado'?8:5;
    if(decision==='desinteresado'){
      await c.query(`INSERT INTO public.fve_cierre_negociacion
        (id_proceso,id_propuesta,tipo_cierre,observacion,created_by)
        VALUES($1,$2,'desistida',$3,$4)`,[p.id_proceso,actual.id_propuesta,observacion,u]);
    }
    await c.query('UPDATE public.fve_proceso SET paso_actual=$2 WHERE id_proceso=$1',[p.id_proceso,siguiente]);
    await evento(c,p,u,'DECISION_CLIENTE',{decision,id_propuesta:actual.id_propuesta});
    return {ok:true,paso_actual:siguiente,decision:r.rows[0]};
  });}
  async function reanudar(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,5);const actual=await ult(c,p.id_proceso,true);
    if(!actual)fallo(409,'No existe propuesta presentada');
    const r=await c.query(`SELECT decision FROM public.fve_decision_propuesta
      WHERE id_propuesta=$1 ORDER BY id_decision DESC LIMIT 1`,[actual.id_propuesta]);
    if(r.rows[0]?.decision!=='suspendido')fallo(409,'Solo una negociacion suspendida puede reanudarse');
    await evento(c,p,u,'NEGOCIACION_REANUDADA',{id_propuesta:actual.id_propuesta});
    return {ok:true,paso_actual:5};
  });}
  async function interesActual(c,actual){
    const r=await c.query(`SELECT decision FROM public.fve_decision_propuesta
       WHERE id_propuesta=$1 ORDER BY id_decision DESC LIMIT 1`,[actual.id_propuesta]);
    if(r.rows[0]?.decision!=='interesado')fallo(409,'El cliente debe indicar interes en la propuesta presentada');
  }
  async function financiacion(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,6);const actual=await ult(c,p.id_proceso,true);
    if(!actual)fallo(409,'No hay propuesta presentada');
    await interesActual(c,actual);
    let d;try{d=n.validarModalidad(req.body,Number(actual.total_inversion));}
    catch(e){fallo(422,e.message);}
    const r=await c.query(`INSERT INTO public.fve_financiamiento_propuesta
      (id_propuesta,modalidad,recursos_propios,credito_solicitado,observacion,updated_by)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id_propuesta) DO UPDATE SET modalidad=EXCLUDED.modalidad,
      recursos_propios=EXCLUDED.recursos_propios,credito_solicitado=EXCLUDED.credito_solicitado,
      observacion=EXCLUDED.observacion,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING *`,[actual.id_propuesta,d.modalidad,d.recursos_propios,d.credito_solicitado,n.texto(req.body?.observacion),u]);
    await c.query('UPDATE public.fve_proceso SET paso_actual=7 WHERE id_proceso=$1',[p.id_proceso]);
    await evento(c,p,u,'FINANCIACION_SELECCIONADA',{id_propuesta:actual.id_propuesta,...d});
    return {ok:true,paso_actual:7,financiacion:r.rows[0]};
  });}
  async function viabilidad(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,7);const actual=await ult(c,p.id_proceso,true);
    if(!actual)fallo(409,'No existe propuesta presentada');
    const f=await c.query(`SELECT * FROM public.fve_financiamiento_propuesta WHERE id_propuesta=$1`,[actual.id_propuesta]);
    if(!f.rowCount)fallo(409,'Registra la modalidad de financiacion');
    if(req.body?.estado_credito==='aprobado') {
      const rol=String(req.user?.nombre_rol||'').normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').toLowerCase();
      if(!['administrador','super administrador'].includes(rol))
        fallo(403,'Solo Administracion puede registrar aprobacion crediticia con soporte');
    }
    let d;try{d=n.validarViabilidad(req.body,{recursos_propios:Number(f.rows[0].recursos_propios),
      credito_solicitado:Number(f.rows[0].credito_solicitado)});}catch(e){fallo(422,e.message);}
    const r=await c.query(`INSERT INTO public.fve_viabilidad_propuesta
      (id_propuesta,estado,recursos_propios_confirmados,estado_credito,monto_credito_aprobado,
       referencia_soporte,observacion,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(id_propuesta) DO UPDATE SET estado=EXCLUDED.estado,
       recursos_propios_confirmados=EXCLUDED.recursos_propios_confirmados,
       estado_credito=EXCLUDED.estado_credito,monto_credito_aprobado=EXCLUDED.monto_credito_aprobado,
       referencia_soporte=EXCLUDED.referencia_soporte,observacion=EXCLUDED.observacion,
       updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
       [actual.id_propuesta,d.estado,d.recursos_propios_confirmados,d.estado_credito,
        d.monto_credito_aprobado,d.referencia_soporte,d.observacion,u]);
    const siguiente=d.estado==='viable'?8:7;
    await c.query('UPDATE public.fve_proceso SET paso_actual=$2 WHERE id_proceso=$1',[p.id_proceso,siguiente]);
    await evento(c,p,u,'VIABILIDAD_EVALUADA',{id_propuesta:actual.id_propuesta,...d});
    return {ok:true,paso_actual:siguiente,viabilidad:r.rows[0]};
  });}
  async function reformular(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,7);const actual=await ult(c,p.id_proceso,true);
    if(!actual)fallo(409,'No existe version presentada');
    const r=await c.query(`SELECT estado FROM public.fve_viabilidad_propuesta WHERE id_propuesta=$1`,[actual.id_propuesta]);
    if(r.rows[0]?.estado!=='no_viable')fallo(409,'Solo se reformula cuando la financiacion no es viable');
    await c.query('UPDATE public.fve_proceso SET paso_actual=3 WHERE id_proceso=$1',[p.id_proceso]);
    await evento(c,p,u,'REFORMULACION_SOLICITADA',{desde_version:actual.numero_version,observacion:n.texto(req.body?.observacion,1000)});
    return {ok:true,paso_actual:3,version_anterior:actual.numero_version};
  });}
  async function aceptar(req,res){return withTx(req,res,async(c,p,u)=>{
    paso(p,8);const actual=await ult(c,p.id_proceso,true);
    if(!actual)fallo(409,'No existe propuesta presentada');
    await interesActual(c,actual);
    const r=await c.query(`SELECT estado FROM public.fve_viabilidad_propuesta WHERE id_propuesta=$1`,[actual.id_propuesta]);
    if(r.rows[0]?.estado!=='viable')fallo(409,'La financiacion no esta registrada como viable');
    // No se afirma elegibilidad verde sin resultado tecnico aplicable a cada linea.
    const sinElegibilidad=(actual.detalle?.lineas||[]).filter(l=>l.estado_ambiental!=='elegible');
    if(sinElegibilidad.length)fallo(422,'No se puede cerrar como financiacion verde: faltan evaluaciones elegibles para '+sinElegibilidad.length+' activo(s)');
    const r2=await c.query(`INSERT INTO public.fve_cierre_negociacion
      (id_proceso,id_propuesta,tipo_cierre,observacion,created_by) VALUES($1,$2,'aceptada',$3,$4) RETURNING *`,
      [p.id_proceso,actual.id_propuesta,n.texto(req.body?.observacion),u]);
    await evento(c,p,u,'NEGOCIACION_ACEPTADA',{id_propuesta:actual.id_propuesta,version:actual.numero_version});
    return {ok:true,paso_actual:8,cierre:r2.rows[0]};
  });}
  return {consultar,diagnosticoOrigen,prepararPropuesta,volverAPropuesta,vistaPreviaPdf,presentar,descargarPdf,decision,reanudar,financiacion,viabilidad,reformular,aceptar};
}
module.exports={crearControlador};
