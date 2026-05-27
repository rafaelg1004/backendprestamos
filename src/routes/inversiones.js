const express = require('express');
const router = express.Router();
const inversionesController = require('../controllers/inversionesController');
const { handleValidationErrors, validaciones } = require('../middleware/validate');
const { verificarAuth, verificarPermisos } = require('../middleware/auth');

// Ruta PÚBLICA - Debe ir ANTES de aplicar el middleware verificarAuth
router.get("/publico/cedula/:cedula", inversionesController.obtenerInversionistaPorCedulaPublico);

// Todas las rutas requieren autenticación
router.use(verificarAuth);
// Adicionalmente, todas las operaciones de inversiones requieren el permiso ver_inversiones
router.use(verificarPermisos(['ver_inversiones']));

// GET /api/inversiones - Listar inversiones
router.get('/', inversionesController.obtenerInversiones);

// POST /api/inversiones - Crear inversión
router.post(
  '/',
  [
    validaciones.uuid('inversionista_id', 'body'),
    validaciones.montoPositivo('monto_invertido'),
    validaciones.tasaInteres('tasa_interes_pactada'),
    handleValidationErrors
  ],
  inversionesController.crearInversion
);

// GET /api/inversiones/:id - Obtener una inversión
router.get(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  inversionesController.obtenerInversion
);

// PUT /api/inversiones/:id - Actualizar inversión
router.put(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  inversionesController.actualizarInversion
);

// POST /api/inversiones/:id/pagar - Registrar pago a inversionista (Interés/Capital)
router.post(
  '/:id/pagar',
  [
    validaciones.uuid('id'),
    validaciones.montoPositivo('monto_total'),
    handleValidationErrors
  ],
  inversionesController.registrarPagoInversionista
);


// DELETE /api/inversiones/:id - Eliminar inversión
router.delete(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  inversionesController.eliminarInversion
);

module.exports = router;
