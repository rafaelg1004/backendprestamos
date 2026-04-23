const express = require("express");
const router = express.Router();
const prestamosController = require("../controllers/prestamosController");
const {
  handleValidationErrors,
  validaciones,
  body,
} = require("../middleware/validate");
const { verificarAuth } = require("../middleware/auth");

// Ruta pública para consultar préstamos por cédula (sin autenticación)
router.get(
  "/publico/cedula/:cedula",
  prestamosController.obtenerPrestamosPorCedula,
);

// Todas las rutas siguientes requieren autenticación
router.use(verificarAuth);

// GET /api/prestamos - Listar préstamos
router.get("/", prestamosController.obtenerPrestamos);

// GET /api/prestamos/mora/listado - Préstamos en mora
router.get("/mora/listado", prestamosController.obtenerPrestamosMora);

// POST /api/prestamos - Crear préstamo
router.post(
  "/",
  [
    validaciones.uuid("cliente_id", "body"),
    validaciones.montoPositivo("monto_principal"),
    validaciones.tasaInteres("tasa_interes_mensual"),
    validaciones.tasaInteres("tasa_mora_diaria"),
    validaciones.fecha("fecha_inicio"),
    validaciones.fecha("fecha_vencimiento"),
    handleValidationErrors,
  ],
  prestamosController.crearPrestamo,
);

// GET /api/prestamos/:id - Obtener un préstamo
router.get(
  "/:id",
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.obtenerPrestamo,
);

// PUT /api/prestamos/:id - Actualizar préstamo
router.put(
  "/:id",
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.actualizarPrestamo,
);

// GET /api/prestamos/:id/liquidacion - Calcular liquidación
router.get(
  "/:id/liquidacion",
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.calcularLiquidacion,
);

// POST /api/prestamos/:id/pagar - Registrar pago de préstamo
router.post(
  "/:id/pagar",
  [
    validaciones.uuid("id"),
    validaciones.montoPositivo("monto_total"),
    validaciones.metodoPago(),
    handleValidationErrors,
  ],
  prestamosController.pagarPrestamo,
);

// DELETE /api/prestamos/:id - Eliminar préstamo
router.delete(
  "/:id",
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.eliminarPrestamo,
);

module.exports = router;
