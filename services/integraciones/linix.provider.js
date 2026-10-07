const MODE =
  process.env.EXTERNAL_INTEGRATION_MODE ||
  'disabled';


function normalizeDocument(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim();
}


function createConfigurationError(message) {
  const error = new Error(message);

  error.code = 'LINIX_NOT_CONFIGURED';
  error.statusCode = 503;

  return error;
}


function buildMockClient(documento) {
  return {
    documento,

    nombres:
      'Cliente',

    apellidos:
      'Prueba',

    municipio:
      'Manizales',

    sucursal:
      'Sucursal prueba',

    direccion_negocio:
      'Dirección de prueba',

    codigo_ciiu:
      '4711',

    celular:
      '3000000000',

    correo:
      'cliente.prueba@example.com',
  };
}


async function getLinixClientByDocument(
  document
) {
  const documento =
    normalizeDocument(document);

  if (!documento) {
    const error =
      new Error(
        'El documento es obligatorio'
      );

    error.statusCode = 400;

    throw error;
  }


  /*
   * ==========================================================
   * MODO MOCK
   * ==========================================================
   *
   * Permite desarrollar todo Finanzas Verdes antes de tener
   * disponible la API real de LINIX.
   */
  if (MODE === 'mock') {
    return buildMockClient(
      documento
    );
  }


  /*
   * ==========================================================
   * INTEGRACIÓN REAL
   * ==========================================================
   *
   * Esta rama será implementada cuando LINIX entregue:
   *
   * - URL
   * - endpoint
   * - autenticación
   * - estructura de respuesta
   * - códigos de error
   *
   * El resto de Finanzas Verdes NO deberá cambiar.
   */
  if (MODE === 'real') {
    throw createConfigurationError(
      'La integración real con LINIX aún no ha sido configurada'
    );
  }


  throw createConfigurationError(
    'La integración con LINIX está deshabilitada'
  );
}


module.exports = {
  getLinixClientByDocument,
};