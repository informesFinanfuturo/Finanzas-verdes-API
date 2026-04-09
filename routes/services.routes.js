const express = require("express")
const router = express.Router()
const { findCiiuByCode, getAllCiiuCodes } = require("../services/ciiuService")

router.get("/ciiu/:codigo", (req, res) => {
  const item = findCiiuByCode(req.params.codigo)

  if (!item) {
    return res.status(404).json({ error: "Código CIIU no encontrado" })
  }

  return res.json(item) 
});

router.get("/ciiu", getAllCiiuCodes)

module.exports = router