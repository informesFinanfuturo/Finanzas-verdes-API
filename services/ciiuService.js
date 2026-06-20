const path = require("path");
const XLSX = require("xlsx");

let CIIU_DATA = null;

function loadCiiuExcel() {
  if (!CIIU_DATA) {
    const filePath = path.join(__dirname, "../data/codigoCiiu.xlsx");
    const workbook = XLSX.readFile(filePath);

    // Leer primera hoja del libro
    const sheetName = workbook.SheetNames[1];
    const sheet = workbook.Sheets[sheetName];

    // Convertir Excel → JSON
    CIIU_DATA = XLSX.utils.sheet_to_json(sheet);
  }

  return CIIU_DATA;
}

function findCiiuByCode(code) {
  const data = loadCiiuExcel();
  return data.find(item => String(item.codigo).toUpperCase() === code.toUpperCase()) || null;
}


function getAllCiiuCodes() {
  const data = loadCiiuExcel();

  // Devuelve solo los códigos, como lista de strings
  return data
    .map((item) => String(item.codigo).trim())
    .filter((codigo) => codigo.isNotEmpty); // opcional: evitar vacíos
}


module.exports = {
  findCiiuByCode,
  getAllCiiuCodes
};