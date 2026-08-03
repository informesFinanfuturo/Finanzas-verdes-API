const path = require("path");
const XLSX = require("xlsx");
const pool = require('../db');


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

function normKey(k) {
  return String(k)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // sin tildes
    .replace(/\s+/g, "_") // espacios -> _
    .replace(/[^A-Za-z0-9_]/g, "") // limpia
    .toLowerCase();
}

async function importQuestionsFromExcel(req, res) {
  const { idSection } = req.params;
  if (!idSection) {
    return res.status(400).json({ error: "idSection es obligatorio" });
  }

  try {
    const filePath = path.join(__dirname, "../data/diagnostico.xlsm");
    const workbook = XLSX.readFile(filePath);

    // Hoja 3 => índice 2
    const sheetName = workbook.SheetNames[12];
    const sheet = workbook.Sheets[sheetName];

    // Leer con headers originales
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (!rawRows.length) {
      return res.status(400).json({ error: "El Excel está vacío" });
    }

    // Normalizar headers por fila
    const rows = rawRows.map(r => {
      const o = {};
      for (const k of Object.keys(r)) {
        o[normKey(k)] = r[k];
      }
      return o;
    });

    //console.log(rows.slice(0, 5));

    await pool.query("BEGIN");

    let questionsInserted = 0;
    let answersInserted = 0;

    let lastCapa = null; // ✅ forward‑fill para celdas combinadas

    for (const row of rows) {
      // posibles claves normalizadas
      const capaRaw = row.capa ?? row.field ?? null;
      const pregunta = (row.pregunta ?? "").toString().trim();

      // forward‑fill de Capa
      if (capaRaw) lastCapa = capaRaw.toString().trim();
      const capa = lastCapa;

      if (!pregunta || !capa) continue; // ahora sí pasa

      // 1) crear pregunta
      const qRes = await pool.query(
        `
        INSERT INTO question (
          question, description, "order", field, "idSection"
        )
        VALUES ($1, NULL, NULL, $2, $3)
        RETURNING id
        `,
        [pregunta, capa, idSection]
      );
      const idQuestion = qRes.rows[0].id;
      questionsInserted++;

      // 2) opciones (0..4)
      const options = [
        row.opcion_1 ?? row.opcion1,
        row.opcion_2 ?? row.opcion2,
        row.opcion_3 ?? row.opcion3,
        row.opcion_4 ?? row.opcion4,
        row.opcion_5 ?? row.opcion5,
      ];

      for (let score = 0; score < options.length; score++) {
        const text = options[score];
        if (!text) continue;

        await pool.query(
          `
          INSERT INTO answer (answer, description, score, "idQuestion")
          VALUES ($1, NULL, $2, $3)
          `,
          [text.toString().trim(), score, idQuestion]
        );
        answersInserted++;
      }
    }

    await pool.query("COMMIT");

    return res.json({
      ok: true,
      message: "Preguntas importadas correctamente",
      idSection,
      questionsInserted,
      answersInserted,
    });

  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Error importando Excel:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function normalize(str) {
  return String(str || '')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function searchCiiu(query) {
  if (!query) return [];

  const data = loadCiiuExcel();
  const q = normalize(query);

  return data
    .filter(item => {
      const codigo = normalize(item.codigo);
      // ⚠️ ajusta el nombre del campo según tu Excel
      const nombre = normalize(item.nombre || item.descripcion || item.actividad);

      return codigo.includes(q) || nombre.includes(q);
    })
    .slice(0, 20); // ✅ limitar resultados (importantísimo)
}




module.exports = {
  findCiiuByCode,
  getAllCiiuCodes,
  importQuestionsFromExcel,
  searchCiiu,
};