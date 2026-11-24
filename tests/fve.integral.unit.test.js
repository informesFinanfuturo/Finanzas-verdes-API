'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const n=require('../services/fveNegocio');
const pdf=require('../services/fvePdf');
function linea(){return {id_activo:11,id_item:2,activo_nombre:'Nevera anterior',producto_nombre:'Nevera eficiente',
  id_proveedor:4,proveedor_nombre:'Proveedor',cantidad:2,precio_unitario:1240000,estado_ambiental:'pendiente_dato'};}
test('calcula montos solo desde precios catalogo',()=>{
 const a=n.crearDetalle([linea()],{id_proceso:2,id_diagnostico:24,nombre_mipyme:'Prueba'});
 assert.equal(a.total_inversion,2480000);assert.equal(a.lineas[0].subtotal,2480000);
 assert.equal(a.lineas[0].estado_ambiental,'pendiente_dato');
});
test('rechaza precio monetario con decimales',()=>assert.throws(()=>n.crearDetalle([{...linea(),precio_unitario:123.45}])));
test('rechaza cantidades negativas o cero',()=>assert.throws(()=>n.crearDetalle([{...linea(),cantidad:0}])));
test('rechaza montos mayores a entero seguro',()=>assert.throws(()=>n.crearDetalle([{...linea(),precio_unitario:1e12,cantidad:10000}])));
test('validacion financiacion propia completa',()=>{
 assert.deepEqual(n.validarModalidad({modalidad:'recursos_propios',recursos_propios:300,credito_solicitado:0},300),
 {modalidad:'recursos_propios',recursos_propios:300,credito_solicitado:0});
});
test('creditos mixtos deben financiar el total',()=>assert.throws(()=>n.validarModalidad({modalidad:'mixta',recursos_propios:100,credito_solicitado:199},300)));
test('modalidad propia no admite credito residual',()=>assert.throws(()=>n.validarModalidad({modalidad:'recursos_propios',recursos_propios:200,credito_solicitado:100},300)));
test('requiere evidencia para credito aprobado',()=>assert.throws(()=>n.validarViabilidad({estado_credito:'aprobado',monto_credito_aprobado:200},{recursos_propios:0,credito_solicitado:200})));
test('no permite aprobar mas dinero que el solicitado',()=>assert.throws(()=>n.validarViabilidad({estado_credito:'aprobado',monto_credito_aprobado:300,referencia_soporte:'ABC'},{recursos_propios:0,credito_solicitado:200})));
test('viabilidad no afirma aprobacion sin evidencia',()=>{
 const v=n.validarViabilidad({estado_credito:'aprobado',monto_credito_aprobado:200,referencia_soporte:'Referencia de verificacion',recursos_propios_confirmados:true},{recursos_propios:100,credito_solicitado:200});
 assert.equal(v.estado,'viable');
});
test('credito rechazado es no viable',()=>assert.equal(n.validarViabilidad({estado_credito:'rechazado'},{credito_solicitado:200,recursos_propios:0}).estado,'no_viable'));
test('no acepta precios cambiados antes de presentar',()=>{
 const a=n.crearDetalle([linea()]);
 assert.match(n.cambioPrecio(a,[{id_item:2,precio_base:1240100,disponible:true,estado:'activo',proveedor_estado:'activo'}]),/cambio/);
});
test('no presenta productos deshabilitados',()=>{
 const a=n.crearDetalle([linea()]);
 assert.ok(n.cambioPrecio(a,[{id_item:2,precio_base:1240000,disponible:false,estado:'activo',proveedor_estado:'activo'}]));
});
test('HTML institucional reproducible, sin estados tecnicos crudos',()=>{
 const a={id_proceso:5,numero_version:2,detalle:n.crearDetalle([linea()],{id_diagnostico:24,nombre_mipyme:'Empresa de prueba'})};
 const h1=pdf.construirHtmlPropuesta(a),h2=pdf.construirHtmlPropuesta(a);
 assert.equal(h1,h2);
 assert.match(h1,/Propuesta de inversi\u00f3n/);
 assert.match(h1,/data:image\/png;base64/);
 assert.doesNotMatch(h1,/pendiente_dato/);
});
test('PDF binario y huella SHA-256', {skip:!process.env.FVE_TEST_PDF}, async()=>{
 const a={id_proceso:5,numero_version:2,detalle:n.crearDetalle([linea()],{id_diagnostico:24,nombre_mipyme:'Empresa de prueba'})};
 const r=await pdf.generarPdfPropuesta(a);
 assert.equal(r.buffer.subarray(0,4).toString(),'%PDF');
 assert.match(r.sha256,/^[a-f0-9]{64}$/);
 assert.ok(r.buffer.length>1300);
});
test('PDF con muchos productos usa varias paginas', {skip:!process.env.FVE_TEST_PDF}, async()=>{
 const l=Array.from({length:60},(_,i)=>({...linea(),id_activo:i+1}));
 const a={id_proceso:5,numero_version:2,detalle:n.crearDetalle(l)};
 const r=await pdf.generarPdfPropuesta(a);
 assert.ok(r.paginas>=2);
});
