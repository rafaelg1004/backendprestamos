/**
 * Middleware de autenticación
 * Este middleware verifica que el usuario esté autenticado mediante JWT
 */

const { verifyToken } = require("../config/jwt");
const db = require("../config/db");
const { AppError } = require("./errorHandler");

/**
 * Verifica que el token JWT sea válido
 */
const verificarAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        "No se proporcionó token de autenticación",
        401,
        "AUTH_MISSING",
      );
    }

    const token = authHeader.split(" ")[1];

    // Verificar token JWT
    const decoded = verifyToken(token);

    if (!decoded) {
      throw new AppError("Token inválido o expirado", 401, "AUTH_INVALID");
    }

    // Agregar usuario al request
    req.user = decoded;

    // Obtener usuario desde tabla users
    const { rows: users } = await db.query(
      "SELECT * FROM users WHERE id = $1",
      [decoded.id],
    );
    const user = users[0];

    if (!user) {
      throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
    }

    // Obtener perfil asociado
    const { rows: perfiles } = await db.query(
      "SELECT * FROM perfiles WHERE user_id = $1",
      [decoded.id],
    );
    const perfil = perfiles[0];

    if (perfil) {
      req.perfil = perfil;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Verifica que el usuario tenga un rol específico
 */
const verificarRol = (roles) => {
  return (req, res, next) => {
    if (!req.perfil) {
      return next(new AppError("Perfil no encontrado", 403, "PROFILE_MISSING"));
    }

    if (!roles.includes(req.perfil.rol)) {
      return next(
        new AppError("No tiene permisos para esta acción", 403, "FORBIDDEN"),
      );
    }

    next();
  };
};

/**
 * Middleware opcional - no requiere auth pero la usa si está presente
 */
const authOpcional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    if (decoded) {
      req.user = decoded;

      const { rows: users } = await db.query(
        "SELECT * FROM users WHERE id = $1",
        [decoded.id],
      );
      const user = users[0];

      if (user) {
        const { rows: perfiles } = await db.query(
          "SELECT * FROM perfiles WHERE user_id = $1",
          [decoded.id],
        );
        const perfil = perfiles[0];

        if (perfil) {
          req.perfil = perfil;
        }
      }
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  verificarAuth,
  verificarRol,
  authOpcional,
};
