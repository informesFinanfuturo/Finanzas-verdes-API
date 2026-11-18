'use strict';
// Alta automatica de usuarios predeterminados deshabilitada por seguridad.
// El inicio normal de la API se realiza mediante index.js.
function createDefaultUser() {
  throw new Error('El alta automatica de usuarios predeterminados esta deshabilitada. Utilice la administracion de usuarios autorizada.');
}
module.exports = { createDefaultUser };
if (require.main === module) {
  console.error('[BLOQUEADO] Creacion automatica de usuario predeterminado deshabilitada.');
  process.exitCode = 1;
}
