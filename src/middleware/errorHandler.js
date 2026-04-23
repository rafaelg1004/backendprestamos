/**
 * Middleware para manejo centralizado de errores
 */

class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Manejador de errores central
 */
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);

  // Errores de PostgreSQL
  if (err.code && err.code.startsWith("22")) {
    return res.status(400).json({
      success: false,
      error: "Error de datos inválidos",
      details: err.message,
    });
  }

  if (err.code && err.code.startsWith("23")) {
    return res.status(400).json({
      success: false,
      error: "Error de restricción de base de datos",
      details: err.message,
    });
  }

  // Errores de validación de Express Validator
  if (err.array && typeof err.array === "function") {
    return res.status(400).json({
      success: false,
      error: "Error de validación",
      details: err.array(),
    });
  }

  // Errores operacionales conocidos
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  // Errores no controlados
  return res.status(500).json({
    success: false,
    error: "Error interno del servidor",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};

/**
 * Manejador para rutas no encontradas
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta ${req.originalUrl} no encontrada`,
  });
};

/**
 * Wrapper para controladores async
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
};
