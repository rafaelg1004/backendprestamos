const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { generateToken } = require("../config/jwt");
const { AppError } = require("../middleware/errorHandler");
const { sanitizarString } = require("../utils/formatters");
const { verificarAuth } = require("../middleware/auth");

/**
 * POST /api/auth/login
 * Iniciar sesión con email y password (solo usuarios con rol 'admin')
 */
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError(
        "Email y contraseña son requeridos",
        400,
        "MISSING_CREDENTIALS",
      );
    }

    // Buscar usuario por email
    const { rows: users } = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email],
    );
    const user = users[0];

    if (!user) {
      throw new AppError("Credenciales inválidas", 401, "INVALID_CREDENTIALS");
    }

    // Verificar password con bcrypt
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new AppError("Credenciales inválidas", 401, "INVALID_CREDENTIALS");
    }

    // Verificar que el usuario tenga rol 'admin'
    if (user.rol !== "admin") {
      throw new AppError(
        "Solo usuarios administrativos pueden iniciar sesión",
        403,
        "FORBIDDEN",
      );
    }

    // Actualizar último acceso
    await db.query("UPDATE users SET last_sign_in_at = NOW() WHERE id = $1", [
      user.id,
    ]);

    // Buscar perfil asociado si existe
    const { rows: perfiles } = await db.query(
      "SELECT * FROM perfiles WHERE user_id = $1",
      [user.id],
    );
    const perfil = perfiles[0];

    // Generar token JWT
    const token = generateToken({
      id: user.id,
      email: user.email,
      rol: user.rol,
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          rol: user.rol,
          nombre: perfil?.nombre_completo || user.email.split("@")[0],
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/register
 * Registrar nuevo usuario (solo si existe en perfiles, excepto admin)
 */
router.post("/register", async (req, res, next) => {
  try {
    const { identificacion, password } = req.body;

    if (!identificacion || !password) {
      throw new AppError(
        "Identificación y contraseña son requeridos",
        400,
        "MISSING_CREDENTIALS",
      );
    }

    // Buscar perfil por identificación
    const { rows: perfiles } = await db.query(
      "SELECT * FROM perfiles WHERE identificacion = $1",
      [identificacion],
    );
    const perfil = perfiles[0];

    // Solo admin puede registrarse sin estar en perfiles
    // Clientes e inversionistas DEBEN estar en perfiles primero
    if (!perfil) {
      throw new AppError(
        "No existe un perfil con esta identificación. Debe ser creado primero en el módulo de personas.",
        400,
        "PERFIL_NOT_FOUND",
      );
    }

    // Verificar si el perfil ya tiene un usuario asociado
    if (perfil.user_id) {
      throw new AppError(
        "Esta persona ya tiene un usuario registrado",
        400,
        "USER_EXISTS",
      );
    }

    // Verificar si el email ya existe en users
    const { rows: existentesUsers } = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [perfil.email.toLowerCase()],
    );

    if (existentesUsers.length > 0) {
      throw new AppError("El email ya está registrado", 400, "EMAIL_EXISTS");
    }

    // Encriptar password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generar UUID para el nuevo usuario
    const { v4: uuidv4 } = require("uuid");
    const userId = uuidv4();

    // Insertar usuario en tabla users
    await db.query(
      `INSERT INTO users (id, email, password, email_confirmed_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, perfil.email.toLowerCase(), hashedPassword],
    );

    // Actualizar perfil con el user_id
    const { rows: perfilesActualizados } = await db.query(
      `UPDATE perfiles 
       SET user_id = $1
       WHERE id = $2
       RETURNING id, nombre_completo, email, rol, identificacion`,
      [userId, perfil.id],
    );

    const perfilActualizado = perfilesActualizados[0];

    // NO generar token JWT - el usuario debe iniciar sesión manualmente

    res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente. Ahora puedes iniciar sesión.",
      data: {
        user: {
          id: userId,
          email: perfil.email.toLowerCase(),
          nombre_completo: perfil.nombre_completo,
          rol: perfil.rol,
          identificacion: perfil.identificacion,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/register-admin
 * Crear usuario admin sin necesidad de perfil previo
 * (Crea user + perfil automáticamente)
 */
router.post("/register-admin", async (req, res, next) => {
  try {
    const { email, password, nombre_completo, telefono, identificacion } =
      req.body;

    if (!email || !password || !nombre_completo) {
      throw new AppError(
        "Email, contraseña y nombre completo son requeridos",
        400,
        "MISSING_CREDENTIALS",
      );
    }

    // Verificar si el email ya existe en users
    const { rows: existentesUsers } = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (existentesUsers.length > 0) {
      throw new AppError("El email ya está registrado", 400, "EMAIL_EXISTS");
    }

    // Verificar si la identificación ya existe
    if (identificacion) {
      const { rows: existentesId } = await db.query(
        "SELECT id FROM perfiles WHERE identificacion = $1",
        [identificacion],
      );
      if (existentesId.length > 0) {
        throw new AppError(
          "La identificación ya está registrada",
          400,
          "IDENTIFICACION_EXISTS",
        );
      }
    }

    // Encriptar password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generar UUIDs
    const { v4: uuidv4 } = require("uuid");
    const userId = uuidv4();
    const perfilId = uuidv4();

    // Insertar usuario en tabla users
    await db.query(
      `INSERT INTO users (id, email, password, email_confirmed_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, email.toLowerCase(), hashedPassword],
    );

    // Crear perfil de admin vinculado al user
    await db.query(
      `INSERT INTO perfiles (id, user_id, nombre_completo, email, rol, telefono, identificacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        perfilId,
        userId,
        sanitizarString(nombre_completo),
        email.toLowerCase(),
        "admin",
        telefono || null,
        identificacion || null,
      ],
    );

    res.status(201).json({
      success: true,
      message:
        "Usuario administrador creado exitosamente. Ahora puedes iniciar sesión.",
      data: {
        user: {
          id: userId,
          email: email.toLowerCase(),
          nombre_completo,
          rol: "admin",
          identificacion,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * Cerrar sesión (JWT no requiere logout en servidor)
 */
router.post("/logout", async (req, res, next) => {
  try {
    // JWT no requiere logout en servidor
    // El cliente simplemente debe eliminar el token
    res.json({
      success: true,
      message: "Sesión cerrada exitosamente",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Obtener información del usuario actual
 */
router.get("/me", async (req, res, next) => {
  try {
    // El middleware verificarAuth ya agregó req.user
    if (!req.user) {
      throw new AppError("No autenticado", 401, "AUTH_MISSING");
    }

    // Obtener perfil completo
    const { rows: perfiles } = await db.query(
      "SELECT id, nombre_completo, email, rol, telefono FROM perfiles WHERE id = $1",
      [req.user.id],
    );
    const perfil = perfiles[0];

    if (!perfil) {
      throw new AppError("Perfil no encontrado", 404, "PROFILE_NOT_FOUND");
    }

    res.json({
      success: true,
      data: {
        user: perfil,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/auth/change-password
 * Cambiar contraseña del usuario actual
 */
router.put("/change-password", verificarAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError(
        "Contraseña actual y nueva son requeridas",
        400,
        "MISSING_PASSWORDS",
      );
    }

    if (newPassword.length < 6) {
      throw new AppError(
        "La nueva contraseña debe tener al menos 6 caracteres",
        400,
        "PASSWORD_TOO_SHORT",
      );
    }

    // Obtener usuario actual
    const { rows: users } = await db.query(
      "SELECT * FROM users WHERE id = $1",
      [req.user.id],
    );
    const user = users[0];

    if (!user) {
      throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
    }

    // Verificar contraseña actual
    const passwordValid = await bcrypt.compare(currentPassword, user.password);

    if (!passwordValid) {
      throw new AppError(
        "Contraseña actual incorrecta",
        401,
        "INVALID_PASSWORD",
      );
    }

    // Generar hash de nueva contraseña
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    // Actualizar contraseña
    await db.query(
      "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
      [newPasswordHash, req.user.id],
    );

    res.json({
      success: true,
      message: "Contraseña actualizada exitosamente",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/create-admin
 * Crear nuevo usuario administrativo (solo rol admin puede crear otros admins)
 */
router.post("/create-admin", verificarAuth, async (req, res, next) => {
  try {
    const { email, password, nombre } = req.body;

    if (!email || !password || !nombre) {
      throw new AppError(
        "Email, contraseña y nombre son requeridos",
        400,
        "MISSING_FIELDS",
      );
    }

    // Verificar que el usuario actual es admin
    if (req.user.rol !== "admin") {
      throw new AppError(
        "Solo administradores pueden crear usuarios administrativos",
        403,
        "FORBIDDEN",
      );
    }

    // Verificar que el email no exista
    const { rows: existingUsers } = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );

    if (existingUsers.length > 0) {
      throw new AppError("El email ya está en uso", 400, "EMAIL_EXISTS");
    }

    // Generar hash de contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Crear usuario administrativo
    const { rows: newUsers } = await db.query(
      "INSERT INTO users (email, password, rol, created_at) VALUES ($1, $2, 'admin', NOW()) RETURNING id, email, rol, created_at",
      [email, passwordHash],
    );

    res.json({
      success: true,
      message: "Usuario administrativo creado exitosamente",
      data: newUsers[0],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
