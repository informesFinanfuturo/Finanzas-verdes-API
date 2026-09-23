const cron = require('node-cron');
const { syncTodosLosCatalogos } = require('../controllers/catalogo.controller');

function iniciarScheduler() {

  // Cada 5 minutos
  cron.schedule('15 11 * * *', async () => {

    try {

      console.log('Ejecutando tarea automática');

      await syncTodosLosCatalogos();

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