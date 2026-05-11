/**
 * Middleware para validar requests usando express-validator
 */

const { validationResult, body, param, query } = require("express-validator");
const { AppError } = require("./errorHandler");

/**
 * Middleware que maneja los errores de validación
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: "Error de validación",
      details: errors.array(),
    });
  }
  next();
};

// Validaciones comunes
const validaciones = {
  // UUID
  uuid: (campo, ubicacion = "param") => {
    const validator = ubicacion === "param" ? param(campo) : body(campo);
    return validator.isUUID().withMessage(`${campo} debe ser un UUID válido`);
  },

  // Email
  email: (campo = "email", ubicacion = "body") => {
    const validator = ubicacion === "body" ? body(campo) : param(campo);
    return validator
      .optional({ checkFalsy: true })
      .isEmail()
      .normalizeEmail()
      .withMessage("El email no es válido");
  },

  // Teléfono
  telefono: (campo = "telefono") => {
    return body(campo)
      .optional()
      .matches(/^[\d\s\-\+\(\)]{7,20}$/)
      .withMessage("El teléfono no es válido");
  },

  // Monto positivo
  montoPositivo: (campo) => {
    return body(campo)
      .isInt({ min: 1 })
      .withMessage(`${campo} debe ser un número positivo`);
  },

  // Tasa de interés
  tasaInteres: (campo) => {
    return body(campo)
      .isDecimal({ decimal_digits: "0,2", min: 0, max: 100 })
      .withMessage(`${campo} debe ser un porcentaje válido (0-100)`);
  },

  // Fecha
  fecha: (campo) => {
    return body(campo)
      .isISO8601()
      .withMessage(`${campo} debe ser una fecha válida`);
  },

  // Enum de tipo persona
  tipoPersona: (campo = "rol") => {
    return body(campo)
      .isIn(["inversionista", "cliente"])
      .withMessage("El tipo debe ser inversionista o cliente");
  },

  // Enum de tipo movimiento
  tipoMovimiento: (campo = "tipo") => {
    return body(campo)
      .isIn([
        "entrega_prestamo",
        "pago_cliente",
        "recibo_inversion",
        "devolucion_inversion",
      ])
      .withMessage("Tipo de movimiento no válido");
  },

  // Método de pago
  metodoPago: (campo = "metodo_pago") => {
    return body(campo)
      .optional()
      .isIn(["efectivo", "transferencia", "otro", "liquidacion"])
      .withMessage("Método de pago no válido");
  },

  // Notas
  notas: (campo = "notas") => {
    return body(campo)
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Las notas no pueden exceder 500 caracteres");
  },
};

module.exports = {
  handleValidationErrors,
  validaciones,
  body,
  param,
  query,
};
