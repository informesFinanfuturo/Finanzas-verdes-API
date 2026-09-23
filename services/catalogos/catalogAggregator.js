const {
  extractCatalogLaPipa
} = require('./laPipaCrawler');

async function extractAllCatalogs() {

  const laPipa =
    await extractCatalogLaPipa();

  return [

    ...laPipa,

  ];

}

module.exports = {
  extractAllCatalogs,
};