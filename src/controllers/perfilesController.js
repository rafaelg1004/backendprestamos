const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { sanitizarString, esEmailValido } = require("../utils/formatters");

/**
 * Crear un nuevo perfil (cliente/inversionista - sin acceso al sistema)
 * POST /api/perfiles
 */
const crearPerfil = asyncHandler(async (req, res) => {
  const { nombre_completo, email, rol, telefono, identificacion, direccion } =
    req.body;

  // Verificar si la identificacion (cédula) ya existe en perfiles
  if (identificacion) {
    const { rows: existentesId } = await db.query(
      "SELECT id, nombre_completo FROM perfiles WHERE identificacion = $1",
      [identificacion],
    );

    if (existentesId.length > 0) {
      throw new AppError(
        `Ya existe un perfil con esta identificación: ${existentesId[0].nombre_completo}`,
        400,
        "IDENTIFICACION_EXISTS",
      );
    }
  }

  // Verificar si el email ya existe en perfiles
  const { rows: existentesPerfiles } = await db.query(
    "SELECT id FROM perfiles WHERE email = $1",
    [email.toLowerCase()],
  );

  if (existentesPerfiles.length > 0) {
    throw new AppError(
      `El email ya está registrado en perfiles`,
      400,
      "EMAIL_EXISTS",
    );
  }

  // Generar UUID para el perfil
  const perfilId = uuidv4();

  // Crear perfil SIN user_id (persona sin acceso al sistema)
  const {
    rows: [perfil],
  } = await db.query(
    `INSERT INTO perfiles (
      id, user_id, nombre_completo, email, rol, telefono, identificacion, direccion
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
    RETURNING *`,
    [
      perfilId,
      null, // user_id = null (sin acceso al sistema)
      sanitizarString(nombre_completo),
      email.toLowerCase(),
      rol,
      telefono || null,
      identificacion || null,
      direccion || null,
    ],
  );

  res.status(201).json({
    success: true,
    data: perfil,
    message: "Perfil creado exitosamente (sin acceso al sistema)",
  });
});

/**
 * Obtener todos los perfiles con filtros opcionales
 * GET /api/perfiles
 */
const obtenerPerfiles = asyncHandler(async (req, res) => {
  const { rol, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let queryText =
    "SELECT *, COUNT(*) OVER() as total_count FROM perfiles WHERE 1=1";
  const queryParams = [];
  let paramIndex = 1;

  // Filtros
  if (rol) {
    queryText += ` AND rol = $${paramIndex++}`;
    queryParams.push(rol);
  }

  if (search) {
    queryText += ` AND (nombre_completo ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  // Orden y Paginación
  queryText += ` ORDER BY fecha_registro DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limit, offset);

  try {
    const { rows: perfiles } = await db.query(queryText, queryParams);
    const totalCount =
      perfiles.length > 0 ? parseInt(perfiles[0].total_count) : 0;

    // Limpiar total_count de la respuesta
    const dataLimpiada = perfiles.map((p) => {
      const { total_count, ...perfilData } = p;
      return perfilData;
    });

    res.json({
      success: true,
      data: dataLimpiada,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    throw new AppError(
      "Error obteniendo perfiles: " + error.message,
      400,
      "DB_ERROR",
    );
  }
});

/**
 * Obtener un perfil por ID
 * GET /api/perfiles/:id
 */
const obtenerPerfil = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    rows: [perfil],
  } = await db.query("SELECT * FROM perfiles WHERE id = $1", [id]);

  if (!perfil) {
    throw new AppError("Perfil no encontrado", 404, "NOT_FOUND");
  }

  // Obtener préstamos e inversiones relacionados
  const { rows: prestamos } = await db.query(
    "SELECT * FROM prestamos WHERE cliente_id = $1",
    [id],
  );

  const { rows: inversiones } = await db.query(
    "SELECT * FROM inversiones WHERE inversionista_id = $1",
    [id],
  );

  perfil.prestamos = prestamos;
  perfil.inversiones = inversiones;

  res.json({
    success: true,
    data: perfil,
  });
});

/**
 * Actualizar un perfil
 * PUT /api/perfiles/:id
 */
const actualizarPerfil = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nombre_completo, telefono, email, identificacion, direccion } =
    req.body;

  // Verificar que el perfil existe
  const { rows: existentes } = await db.query(
    "SELECT id FROM perfiles WHERE id = $1",
    [id],
  );

  if (existentes.length === 0) {
    throw new AppError("Perfil no encontrado", 404, "NOT_FOUND");
  }

  // Construir objeto de actualización
  const updates = {};
  if (nombre_completo)
    updates.nombre_completo = sanitizarString(nombre_completo);
  if (telefono !== undefined) updates.telefono = telefono;
  if (identificacion !== undefined) updates.identificacion = identificacion;
  if (direccion !== undefined) updates.direccion = direccion;
  if (email) {
    if (!esEmailValido(email)) {
      throw new AppError("Email no válido", 400, "INVALID_EMAIL");
    }
    updates.email = email.toLowerCase();
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new AppError("No hay campos para actualizar", 400, "MISSING_FIELDS");
  }

  const setClause = keys
    .map((key, index) => `${key} = $${index + 1}`)
    .join(", ");
  const {
    rows: [perfil],
  } = await db.query(
    `UPDATE perfiles SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(updates), id],
  );

  res.json({
    success: true,
    data: perfil,
    message: "Perfil actualizado exitosamente",
  });
});

/**
 * Eliminar un perfil
 * DELETE /api/perfiles/:id
 */
const eliminarPerfil = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verificar que el perfil existe
  const { rows: existentes } = await db.query(
    "SELECT id, rol FROM perfiles WHERE id = $1",
    [id],
  );

  if (existentes.length === 0) {
    throw new AppError("Perfil no encontrado", 404, "NOT_FOUND");
  }

  // Obtener user_id del perfil
  const perfil = existentes[0];

  // Eliminar perfil (esto también eliminará el user por CASCADE)
  await db.query("DELETE FROM perfiles WHERE id = $1", [id]);

  // Eliminar user asociado (si no se eliminó por CASCADE)
  if (perfil.user_id) {
    await db.query("DELETE FROM users WHERE id = $1", [perfil.user_id]);
  }

  res.json({
    success: true,
    message: "Perfil eliminado exitosamente",
  });
});

/**
 * Obtener resumen financiero de un perfil
 * GET /api/perfiles/:id/resumen
 */
const obtenerResumenPerfil = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    rows: [perfil],
  } = await db.query(
    "SELECT id, nombre_completo, rol FROM perfiles WHERE id = $1",
    [id],
  );

  if (!perfil) {
    throw new AppError("Perfil no encontrado", 404, "NOT_FOUND");
  }

  let resumen = {};

  if (perfil.rol === "cliente") {
    // Obtener estadísticas de préstamos usando pg
    const { rows: prestamos } = await db.query(
      "SELECT estado, monto_principal FROM prestamos WHERE cliente_id = $1",
      [id],
    );

    resumen = {
      totalPrestamos: prestamos.length,
      prestamosActivos: prestamos.filter((p) => p.estado === "activo").length,
      prestamosMora: prestamos.filter((p) => p.estado === "mora").length,
      montoTotalPrestado: prestamos.reduce(
        (sum, p) => sum + parseFloat(p.monto_principal),
        0,
      ),
    };
  } else if (perfil.rol === "inversionista") {
    // Obtener estadísticas de inversiones usando pg
    const { rows: inversiones } = await db.query(
      "SELECT estado, monto_invertido FROM inversiones WHERE inversionista_id = $1",
      [id],
    );

    resumen = {
      totalInversiones: inversiones.length,
      inversionesActivas: inversiones.filter((i) => i.estado === "activo")
        .length,
      montoTotalInvertido: inversiones.reduce(
        (sum, i) => sum + parseFloat(i.monto_invertido),
        0,
      ),
    };
  }

  res.json({
    success: true,
    data: {
      perfil,
      resumen,
    },
  });
});

module.exports = {
  crearPerfil,
  obtenerPerfiles,
  obtenerPerfil,
  actualizarPerfil,
  eliminarPerfil,
  obtenerResumenPerfil,
};
