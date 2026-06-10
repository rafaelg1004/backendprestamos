const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
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

  // Verificar si el email ya existe en perfiles (solo si se proporciona)
  if (email) {
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
      email ? email.toLowerCase() : null,
      rol,
      telefono || null,
      identificacion || null,
      direccion || null,
    ],
  );

  // Si el rol es inversionista, crearle su billetera virtual para intereses automáticamente
  if (rol === "inversionista") {
    await db.query(
      "INSERT INTO cuentas (nombre, tipo, saldo_actual, perfil_id) VALUES ($1, $2, $3, $4)",
      [`Billetera - ${sanitizarString(nombre_completo)}`, 'billetera', 0, perfilId]
    );
  }

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

  let queryText = `
    SELECT p.*, 
           c.id as billetera_id, 
           c.saldo_actual as billetera_saldo,
           COUNT(*) OVER() as total_count 
    FROM perfiles p
    LEFT JOIN cuentas c ON p.id = c.perfil_id AND c.tipo = 'billetera'
    WHERE 1=1
  `;
  const queryParams = [];
  let paramIndex = 1;

  // Filtros
  if (rol) {
    queryText += ` AND p.rol = $${paramIndex++}`;
    queryParams.push(rol);
  }

  if (search) {
    queryText += ` AND (p.nombre_completo ILIKE $${paramIndex} OR p.email ILIKE $${paramIndex})`;
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  // Orden y Paginación
  queryText += ` ORDER BY p.fecha_registro DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
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
  if (email !== undefined) {
    if (email && !esEmailValido(email)) {
      throw new AppError("Email no válido", 400, "INVALID_EMAIL");
    }
    updates.email = email ? email.toLowerCase() : null;
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
    // 1. Obtener lista de préstamos del cliente
    const { rows: prestamos } = await db.query(
      "SELECT id, monto_principal, tasa_interes_mensual, estado, fecha_inicio FROM prestamos WHERE cliente_id = $1 ORDER BY fecha_inicio DESC",
      [id],
    );

    // 2. Obtener movimientos de pagos de este cliente
    const { rows: movimientos } = await db.query(
      "SELECT prestamo_id, monto_capital, monto_interes FROM movimientos WHERE perfil_id = $1 AND tipo = 'pago_cliente'",
      [id]
    );

    let cap_inicial = 0, cap_pag = 0, int_pag = 0, cap_pend = 0, int_pend = 0;
    let suma_tasa_ponderada = 0;
    let capital_activo_total = 0;

    for (const pres of prestamos) {
      const montoInicial = parseFloat(pres.monto_principal || 0);
      cap_inicial += montoInicial;

      let cPag = 0, iPag = 0;
      for (const mov of movimientos) {
        if (mov.prestamo_id === pres.id) {
          cPag += parseFloat(mov.monto_capital || 0);
          iPag += parseFloat(mov.monto_interes || 0);
        }
      }
      cap_pag += cPag;
      int_pag += iPag;

      const pendiente = (montoInicial - cPag);
      cap_pend += pendiente;

      if (pres.estado !== 'pagado' && pendiente > 0) {
        const tasa = parseFloat(pres.tasa_interes_mensual || 0);
        suma_tasa_ponderada += (tasa * pendiente);
        capital_activo_total += pendiente;

        // Calcular intereses pendientes aproximados
        const fechaPres = new Date(pres.fecha_inicio);
        const hoy = new Date();
        const mesesTranscurridos = (hoy - fechaPres) / (1000 * 60 * 60 * 24 * 30.44);
        const interesEsperado = montoInicial * (tasa / 100) * mesesTranscurridos;
        int_pend += Math.max(0, interesEsperado - iPag);
      }
    }

    const tasa_promedio = capital_activo_total > 0 ? (suma_tasa_ponderada / capital_activo_total) : 0;

    resumen = {
      totalPrestamos: prestamos.length,
      prestamosActivos: prestamos.filter((p) => p.estado === "activo").length,
      prestamosMora: prestamos.filter((p) => p.estado === "mora").length,
      montoTotalPrestado: Math.round(cap_inicial),
      capital_inicial: Math.round(cap_inicial),
      capital_pagado: Math.round(cap_pag),
      intereses_pagados: Math.round(int_pag),
      capital_pendiente: Math.round(cap_pend),
      intereses_pendientes: Math.round(int_pend),
      tasa_promedio: parseFloat(tasa_promedio.toFixed(2))
    };
  } else if (perfil.rol === "inversionista") {
    // 2. Obtener lista de inversiones activas
    const { rows: inversiones } = await db.query(
      "SELECT id, monto_invertido, tasa_interes_pactada, estado, fecha_inversion FROM inversiones WHERE inversionista_id = $1 ORDER BY fecha_inversion DESC",
      [id]
    );

    // 3. Obtener movimientos de este inversionista
    const { rows: movimientos } = await db.query(
      "SELECT inversion_id, monto_capital, monto_interes FROM movimientos WHERE perfil_id = $1 AND tipo = 'devolucion_inversion'",
      [id]
    );

    let inv_inicial = 0, cap_dev = 0, int_pag = 0, cap_adeud = 0, int_est = 0;
    let suma_tasa_ponderada = 0;
    let capital_activo_total = 0;

    for (const inv of inversiones) {
      const invInicial = parseFloat(inv.monto_invertido || 0);
      inv_inicial += invInicial;

      let cDev = 0, iPag = 0;
      for (const mov of movimientos) {
        if (mov.inversion_id === inv.id) {
          cDev += parseFloat(mov.monto_capital || 0);
          iPag += parseFloat(mov.monto_interes || 0);
        }
      }
      cap_dev += cDev;
      int_pag += iPag;
      
      const adeudado = (invInicial - cDev);
      cap_adeud += adeudado;

      if (inv.estado !== 'finalizada' && adeudado > 0) {
        const tasa = parseFloat(inv.tasa_interes_pactada || 0);
        suma_tasa_ponderada += (tasa * adeudado);
        capital_activo_total += adeudado;

        const fechaInv = new Date(inv.fecha_inversion);
        const hoy = new Date();
        const mesesTranscurridos = (hoy - fechaInv) / (1000 * 60 * 60 * 24 * 30.44);
        const interesEsperado = invInicial * (tasa / 100) * mesesTranscurridos;
        int_est += Math.max(0, interesEsperado - iPag);
      }
    }

    const tasa_promedio = capital_activo_total > 0 ? (suma_tasa_ponderada / capital_activo_total) : 0;

    resumen = {
      totalInversiones: inversiones.length,
      inversionesActivas: inversiones.filter((i) => i.estado === "activo").length,
      montoTotalInvertido: Math.round(inv_inicial),
      inversion_inicial: Math.round(inv_inicial),
      capital_devuelto: Math.round(cap_dev),
      intereses_pagados: Math.round(int_pag),
      capital_todavia_adeudado: Math.round(cap_adeud),
      intereses_acumulados_estimados: Math.round(int_est),
      tasa_promedio: parseFloat(tasa_promedio.toFixed(2))
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
