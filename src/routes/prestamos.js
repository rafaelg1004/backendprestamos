const express = require("express");
const router = express.Router();
const prestamosController = require("../controllers/prestamosController");
const {
  handleValidationErrors,
  validaciones,
  body,
} = require("../middleware/validate");
const { verificarAuth, verificarPermisos } = require("../middleware/auth");
const upload = require("../middleware/upload");

// Ruta pública para consultar préstamos por cédula (sin autenticación)
router.get(
  "/publico/cedula/:cedula",
  prestamosController.obtenerPrestamosPorCedula,
);

// Todas las rutas siguientes requieren autenticación
router.use(verificarAuth);

// GET /api/prestamos - Listar préstamos
router.get("/", verificarPermisos(["ver_prestamos"]), prestamosController.obtenerPrestamos);

// GET /api/prestamos/filtros - Valores para filtros
router.get("/filtros", verificarPermisos(["ver_prestamos"]), prestamosController.obtenerFiltros);

// GET /api/prestamos/mora/listado - Préstamos en mora
router.get("/mora/listado", verificarPermisos(["ver_reportes"]), prestamosController.obtenerPrestamosMora);

// POST /api/prestamos - Crear préstamo
router.post(
  "/",
  [
    validaciones.uuid("cliente_id", "body"),
    validaciones.montoPositivo("monto_principal"),
    validaciones.tasaInteres("tasa_interes_mensual"),
    validaciones.tasaInteres("tasa_mora_diaria"),
    validaciones.fecha("fecha_inicio"),
    validaciones.fechaOpcional("fecha_vencimiento"),
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

// --- RUTAS DE DOCUMENTOS ---

// POST /api/prestamos/:id/documentos - Subir documento
router.post(
  "/:id/documentos",
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.prepararCarpetaPrestamo,
  upload.single('archivo'),
  prestamosController.subirDocumento
);

// GET /api/prestamos/:id/documentos - Listar documentos de un préstamo
router.get(
  "/:id/documentos",
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.obtenerDocumentos
);

// GET /api/prestamos/documentos/:docId/view-token - Obtener token de un solo uso
router.get(
  "/documentos/:docId/view-token",
  async (req, res, next) => {
    try {
      const { docId } = req.params;
      const db = require("../config/db");
      const { randomUUID } = require("crypto");
      
      const { rows } = await db.query("SELECT ruta_archivo FROM prestamo_documentos WHERE id = $1", [docId]);
      if (rows.length === 0) return res.status(404).json({ error: "Documento no encontrado" });
      
      const token = randomUUID();
      const ruta = rows[0].ruta_archivo;
      
      // Token válido por 2 minutos
      await db.query(
        "INSERT INTO single_use_tokens (token, ruta_archivo, expires_at) VALUES ($1, $2, NOW() + interval '2 minutes')",
        [token, ruta]
      );
      
      res.json({ success: true, token, ruta_archivo: ruta });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/prestamos/documentos/:docId - Eliminar un documento específico
router.delete(
  "/documentos/:docId",
  prestamosController.eliminarDocumento
);

// POST /api/prestamos/:id/pagos - Registrar pago libre (capital e intereses)
router.post(
  "/:id/pagos",
  prestamosController.prepararCarpetaPrestamo,
  upload.single('captura'),
  [validaciones.uuid("id"), handleValidationErrors],
  prestamosController.registrarPagoLibre
);


module.exports = router;
