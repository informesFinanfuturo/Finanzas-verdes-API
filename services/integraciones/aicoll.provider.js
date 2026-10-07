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

  error.code = 'AICOLL_NOT_CONFIGURED';
  error.statusCode = 503;

  return error;
}


/*
 * Generamos puntajes únicamente para pruebas.
 *
 * Los valores NO se almacenarán en PostgreSQL.
 */
function buildMockScores(documento) {
  const seed =
    documento
      .split('')
      .reduce(
        (total, character) => {
          const number =
            Number(character);

          return Number.isFinite(number)
            ? total + number
            : total;
        },
        0
      );

  return {
    puntaje_linix:
      650 + (seed % 151),

    puntaje_aicoll:
      670 + (seed % 131),

    puntaje_externo:
      640 + (seed % 161),
  };
}


async function getAicollScoresByDocument(
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


  if (MODE === 'mock') {
    return buildMockScores(
      documento
    );
  }


  /*
   * La integración real se implementará aquí
   * cuando Aicoll entregue su especificación.
   */
  if (MODE === 'real') {
    const error =
      createConfigurationError(
        'La integración real con Aicoll aún no ha sido configurada'
      );

    throw error;
  }


  throw createConfigurationError(
    'La integración con Aicoll está deshabilitada'
  );
}


module.exports = {
  getAicollScoresByDocument,
};