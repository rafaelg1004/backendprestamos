const express = require("express");
const router = express.Router();
const cuentasController = require("../controllers/cuentasController");
const { verificarAuth } = require("../middleware/auth");

router.use(verificarAuth);

router.get("/", cuentasController.obtenerCuentas);
router.get("/:id", cuentasController.obtenerCuentaPorId);
router.post("/", cuentasController.crearCuenta);
router.put("/:id", cuentasController.actualizarCuenta);
router.delete("/:id", cuentasController.eliminarCuenta);

module.exports = router;
