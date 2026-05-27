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
    let authHeader = req.headers.authorization;
    
    // Permitir token por query string para descargas/visualización de archivos
    if (!authHeader && req.query.token) {
      authHeader = `Bearer ${req.query.token}`;
    }

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(
        "No se proporcionó token de autenticación",
        401,
        "AUTH_MISSING",
      );
    }

    const token = authHeader.split(" ")[1];

    // Verificar si el token ha sido invalidado (logout)
    try {
      const { rows: blacklisted } = await db.query(
        "SELECT token FROM token_blacklist WHERE token = $1",
        [token]
      );
      if (blacklisted.length > 0) {
        throw new AppError("Sesión cerrada previamente", 401, "AUTH_INVALIDATED");
      }
    } catch (dbErr) {
      // Si la tabla no existe aún o hay otro error, logueamos pero permitimos pasar
      // para no romper la app si la base de datos no está actualizada.
      if (dbErr.code !== '42P01') { // 42P01 is undefined_table
        console.error("Error comprobando blacklist:", dbErr);
      }
    }

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
    
    // Add permisos to user request
    req.user.permisos = user.permisos || [];

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
 * Verifica que el usuario tenga los permisos necesarios (JSONB array)
 */
const verificarPermisos = (requiredPermisos) => {
  return (req, res, next) => {
    if (!req.user || !req.user.permisos) {
      return next(new AppError("No autenticado o sin permisos", 401, "AUTH_MISSING"));
    }

    // Verificar que tenga TODOS los permisos requeridos
    const hasAllPermissions = requiredPermisos.every(permiso => 
      req.user.permisos.includes(permiso)
    );

    if (!hasAllPermissions) {
      return next(new AppError("No tiene los permisos necesarios para esta acción", 403, "FORBIDDEN"));
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
    
    // Verificar blacklist
    try {
      const { rows: blacklisted } = await db.query(
        "SELECT token FROM token_blacklist WHERE token = $1",
        [token]
      );
      if (blacklisted.length > 0) {
        return next(); // Tratamos como si no hubiera token si está invalidado
      }
    } catch (dbErr) {
      if (dbErr.code !== '42P01') console.error("Error comprobando blacklist:", dbErr);
    }

    const decoded = verifyToken(token);

    if (decoded) {
      req.user = decoded;

      const { rows: users } = await db.query(
        "SELECT * FROM users WHERE id = $1",
        [decoded.id],
      );
      const user = users[0];

      if (user) {
        req.user.permisos = user.permisos || [];
        
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
  verificarPermisos,
  authOpcional,
};
