const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const { verificarAuth } = require("../middleware/auth");

// Todas las rutas requieren autenticación
router.use(verificarAuth);

// GET /api/dashboard/resumen - Resumen general (usa vista_balance_general)
router.get("/resumen", dashboardController.obtenerResumen);

// GET /api/dashboard/clientes/detalle - Detalle de clientes con balances
router.get("/clientes/detalle", dashboardController.obtenerDetalleClientes);

// GET /api/dashboard/inversionistas/detalle - Detalle de inversionistas
router.get(
  "/inversionistas/detalle",
  dashboardController.obtenerDetalleInversionistas,
);

// GET /api/dashboard/alertas/vencimientos - Alertas de vencimientos próximos
router.get(
  "/alertas/vencimientos",
  dashboardController.obtenerAlertasVencimientos,
);

// GET /api/dashboard/movimientos/recientes - Movimientos recientes
router.get(
  "/movimientos/recientes",
  dashboardController.obtenerMovimientosRecientes,
);

module.exports = router;
