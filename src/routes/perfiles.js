const express = require('express');
const router = express.Router();
const perfilesController = require('../controllers/perfilesController');
const { handleValidationErrors, validaciones } = require('../middleware/validate');
const { verificarAuth } = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(verificarAuth);

// GET /api/perfiles - Listar perfiles
router.get('/', perfilesController.obtenerPerfiles);

// POST /api/perfiles - Crear perfil
router.post(
  '/',
  [
    validaciones.email(),
    validaciones.tipoPersona('rol'),
    handleValidationErrors
  ],
  perfilesController.crearPerfil
);

// GET /api/perfiles/:id - Obtener un perfil
router.get(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  perfilesController.obtenerPerfil
);

// GET /api/perfiles/:id/resumen - Resumen financiero del perfil
router.get(
  '/:id/resumen',
  [validaciones.uuid('id'), handleValidationErrors],
  perfilesController.obtenerResumenPerfil
);

// PUT /api/perfiles/:id - Actualizar perfil
router.put(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  perfilesController.actualizarPerfil
);

// DELETE /api/perfiles/:id - Eliminar perfil
router.delete(
  '/:id',
  [validaciones.uuid('id'), handleValidationErrors],
  perfilesController.eliminarPerfil
);

module.exports = router;
