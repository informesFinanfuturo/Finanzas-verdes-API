const {
  getLinixClientByDocument,
} = require(
  './linix.provider'
);

const {
  getAicollScoresByDocument,
} = require(
  './aicoll.provider'
);


async function consultarClienteExterno(
  documento
) {

  /*
   * ==========================================================
   * 1. LINIX
   * ==========================================================
   *
   * LINIX es la fuente principal del cliente.
   *
   * Si no tenemos cliente, no tiene sentido continuar
   * consultando puntajes.
   */

  const cliente =
    await getLinixClientByDocument(
      documento
    );


  if (!cliente) {
    return {
      cliente: null,

      puntajes: null,

      integraciones: {
        linix: {
          estado:
            'sin_resultados',
        },

        aicoll: {
          estado:
            'no_consultado',
        },
      },
    };
  }


  /*
   * ==========================================================
   * 2. AICOLL
   * ==========================================================
   *
   * Aicoll puede fallar sin invalidar la información
   * proveniente de LINIX.
   */

  let puntajes = null;

  let aicollStatus = {
    estado:
      'disponible',
  };


  try {

    puntajes =
      await getAicollScoresByDocument(
        documento
      );

  } catch (error) {

    console.error(
      'Error consultando Aicoll:',
      error.message
    );

    aicollStatus = {
      estado:
        'no_disponible',

      mensaje:
        'No fue posible obtener los puntajes',
    };

  }


  return {
    cliente,

    puntajes,

    integraciones: {

      linix: {
        estado:
          'disponible',
      },

      aicoll:
        aicollStatus,

    },
  };
}


module.exports = {
  consultarClienteExterno,
};