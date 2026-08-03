const express = require("express")
const router = express.Router()

const { 
  findCiiuByCode, 
  getAllCiiuCodes,
  searchCiiu // ✅ asegúrate de tenerlo
} = require("../services/ciiuService")

/// ✅ PRIMERO el search 🔥
router.get("/ciiu/search", (req, res) => {
  try {
    const { q } = req.query

    if (!q) {
      return res.status(400).json({
        error: "El parámetro 'q' es obligatorio"
      })
    }

    const results = searchCiiu(q)

    return res.json({
      count: results.length,
      results
    })

  } catch (err) {
    console.error("Error buscando CIIU:", err)

    return res.status(500).json({
      error: "Error interno"
    })
  }
})

/// ✅ DESPUÉS código dinámico
router.get("/ciiu/:codigo", (req, res) => {
  const item = findCiiuByCode(req.params.codigo)

  if (!item) {
    return res.status(404).json({ error: "Código CIIU no encontrado" })
  }

  return res.json(item)
})

/// ✅ LISTA GENERAL
router.get("/ciiu", (req, res) => {
  res.json(getAllCiiuCodes())
})

module.exports = router