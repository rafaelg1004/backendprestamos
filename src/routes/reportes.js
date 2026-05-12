const express = require("express");
const router = express.Router();
const reportesController = require("../controllers/reportesController");
const { verificarAuth } = require("../middleware/auth");

router.use(verificarAuth);

router.get("/rentabilidad", reportesController.obtenerRentabilidad);
router.get("/cartera", reportesController.obtenerEstadoCartera);

module.exports = router;
