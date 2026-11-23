'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const v=require('../services/fveSeleccionValidaciones');

test('diagnostico conserva una seleccion estricta y trazable',()=>{
  assert.deepEqual(v.validarIds([1,2]),[1,2]);
  assert.deepEqual(v.validarAlternativas([{id_activo:1,id_item:10},{id_activo:2,id_item:20}],[1,2]),[
    {id_activo:1,id_item:10,fuente:'usuario'},{id_activo:2,id_item:20,fuente:'usuario'}]);
  assert.throws(()=>v.validarIds([1,1]),/unicos/);
  assert.throws(()=>v.validarAlternativas([{id_activo:1,id_item:10}],[1,2]),/cada activo/);
  assert.throws(()=>v.validarAlternativas([{id_activo:9,id_item:11}],[1]),/ajenas/);
});
test('resumen admite solamente metricas declaradas, no convierte texto en cifras',()=>{
  assert.deepEqual(v.validarResumen({inversion_total_requerida:12345,foo:'x'}),{inversion_total_requerida:12345});
  assert.throws(()=>v.validarResumen({reduccion_agua:'10'}),/invalido/);
});
test('un proceso historico no recibe sugerencias IA como si fueran confirmadas',()=>{
  const snapshot={diagnostico:{metricas:{activos_seleccionados:[4],activos:[{id_activo:4,producto_recomendado:{id_item:15}}]}}};
  assert.deepEqual(v.contextoSeleccion(snapshot,{}),[{id_activo:4,id_item:null,origen:'pendiente',cantidad:1}]);
});
test('la seleccion explicitamente reparada tiene prioridad sobre el snapshot antiguo',()=>{
  const foto={diagnostico:{metricas:{activos_seleccionados:[4],alternativas_seleccionadas:[{id_activo:4,id_item:15}]}}};
  const vivo={alternativas_seleccionadas:[{id_activo:4,id_item:18}]};
  assert.deepEqual(v.contextoSeleccion(foto,vivo),[{id_activo:4,id_item:18,origen:'recuperado_diagnostico_actual',cantidad:1}]);
});
test('conserva el producto del snapshot cuando no existe una seleccion posterior',()=>{
  const foto={diagnostico:{metricas:{activos_seleccionados:[4],alternativas_seleccionadas:[{id_activo:4,id_item:15}]}}};
  assert.deepEqual(v.contextoSeleccion(foto,{}),[{id_activo:4,id_item:15,origen:'diagnostico_inicial',cantidad:1}]);
});
test('si la foto no tiene producto se admite recuperacion explicita posterior y se identifica origen',()=>{
  const foto={diagnostico:{metricas:{activos_seleccionados:[4]}}};
  const vivo={alternativas_seleccionadas:[{id_activo:4,id_item:18}]};
  assert.deepEqual(v.contextoSeleccion(foto,vivo),[{id_activo:4,id_item:18,origen:'recuperado_diagnostico_actual',cantidad:1}]);
});
test('no convierte el inventario completo en seleccion',()=>{
  const foto={diagnostico:{metricas:{activos:[{id_activo:1},{id_activo:2}]}}};
  assert.deepEqual(v.contextoSeleccion(foto,{}),[]);
});
test('valida cantidad y producto al confirmar, mantiene borradores pendientes',()=>{
  assert.deepEqual(v.validarLineas([{id_activo:3,id_item:null,cantidad:1}]),[{id_activo:3,id_item:null,cantidad:1}]);
  assert.throws(()=>v.validarLineas([{id_activo:3,id_item:null,cantidad:1}],{confirmar:true}),/producto/);
  assert.throws(()=>v.validarLineas([{id_activo:3,id_item:17,cantidad:0}]),/cantidades/);
  assert.throws(()=>v.validarLineas([{id_activo:3,id_item:17,cantidad:1},{id_activo:3,id_item:18,cantidad:1}]),/invalidos/);
});
test('solo permite categorias compatibles, incluidos reductores sobre griferia',()=>{
  assert.equal(v.verificarCompatibilidad({tipo:'Neveras',nombre:'Nevera clasica'},{tipo_item:'Nevera',nombre:'Nevera inverter'}),true);
  assert.equal(v.verificarCompatibilidad({tipo:'Neveras',nombre:'Nevera clasica'},{tipo_item:'Sanitarios',nombre:'Sanitario'}),false);
  assert.equal(v.verificarCompatibilidad({tipo:'Grifos',nombre:'Grifo'},{tipo_item:'Reductores',nombre:'Reductor de caudal'}),true);
});
