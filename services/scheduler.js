const cron = require('node-cron');
const {
  iniciarSincronizacionAutomatica,
} = require(
  '../controllers/catalogo.controller'
);

function iniciarScheduler() {

  // Cada 5 minutos
  cron.schedule('15 11 * * *', async () => {

    try {

      console.log('Ejecutando tarea automática');

      const result = await iniciarSincronizacionAutomatica();

      console.log(
        'Resultado del proceso automático:',
        JSON.stringify(
          result,
          null,
          2,
        ),
      );

    } catch (err) {

      console.error(
        'Error en tarea programada:',
        err
      );

    }

  });

}

module.exports = {
  iniciarScheduler,
};