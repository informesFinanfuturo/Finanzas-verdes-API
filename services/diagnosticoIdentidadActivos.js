'use strict';
// Solo vincula una sugerencia con un activo REAL de la misma fuente.
// Nunca usa un indice de lista como ID ni elige entre varios candidatos.
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function id(v){const n=Number(v);return v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(n)&&n>0?n:null}
function coincideNombre(a,b){const x=norm(a),y=norm(b);return !!x&&!!y&&(x===y||(x.length>=10&&y.startsWith(x+' '))||(y.length>=10&&x.startsWith(y+' ')))}
function resolver(snapshot,inventario){
 if(!snapshot||!Array.isArray(inventario))return {id:null,causa:'sin_datos'};
 const valido=id(snapshot.id_activo);
 if(valido){const hit=inventario.filter(x=>id(x.id_activo)===valido);if(hit.length===1)return {id:valido,causa:'id_existente'};}
 const nombre=snapshot.nombre_activo??snapshot.nombre;
 const matches=inventario.filter(x=>id(x.id_activo)&&coincideNombre(x.nombre,nombre));
 if(matches.length===1)return {id:id(matches[0].id_activo),causa:'nombre_unico'};
 return {id:null,causa:matches.length?'ambiguo':'sin_coincidencia'};
}
module.exports={resolver,norm,coincideNombre,id};
