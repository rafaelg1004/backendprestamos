const express = require('express');
const router = express.Router();
const movimientosController = require('../controllers/movimientosController');
const { handleValidationErrors, validaciones } = require('../middleware/validate');
const { verificarAuth } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verificarAuth);

// GET /api/movimientos - Listar movimientos
router.get('/', movimientosController.obtenerMovimientos);

// GET /api/movimientos/resumen/flujo-caja - Resumen de flujo de caja
router.get('/resumen/flujo-caja', movimientosController.obtenerResumenFlujoCaja);

// POST /api/movimientos - Crear movimiento
router.post(
  '/',
  [
    validaciones.uuid('perfil_id', 'body'),
    validaciones.montoPositivo('monto_total'),
    validaciones.tipoMovimiento('tipo'),
    validaciones.metodoPago(),
    handleValidationErrors
  ],
  movimientosController.crearMovimiento
);

// GET /api/movimientos/:id - Obtener un movimiento
router.get(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  movimientosController.obtenerMovimiento
);

// PUT /api/movimientos/:id - Actualizar movimiento
router.put(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  movimientosController.actualizarMovimiento
);

// DELETE /api/movimientos/:id - Eliminar movimiento
router.delete(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  movimientosController.eliminarMovimiento
);

module.exports = router;
