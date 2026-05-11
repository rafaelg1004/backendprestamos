const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const { deMilunidades, formatearMoneda } = require("../utils/calculos");

/**
 * Crear un nuevo movimiento
 * POST /api/movimientos
 */
const crearMovimiento = asyncHandler(async (req, res) => {
  console.log("[DEBUG] Body recibido:", JSON.stringify(req.body, null, 2));

  const {
    perfil_id,
    prestamo_id,
    inversion_id,
    monto_total,
    monto_capital = 0,
    monto_interes = 0,
    monto_mora = 0,
    metodo_pago,
    referencia_pago,
    url_captura,
    tipo,
    notas,
  } = req.body;

  // Validar que al menos tenga un préstamo o inversión relacionado
  if (!prestamo_id && !inversion_id) {
    throw new AppError(
      "Debe especificar un préstamo o inversión relacionada",
      400,
      "MISSING_RELATION",
    );
  }

  // Verificar que el perfil existe
  const { rows: perfiles } = await db.query(
    "SELECT id, rol FROM perfiles WHERE id = $1",
    [perfil_id]
  );
  const perfil = perfiles[0];

  if (!perfil) {
    throw new AppError("Perfil no encontrado", 404, "PERFIL_NOT_FOUND");
  }

  // Validar tipos de movimiento según el rol del perfil
  const tiposCliente = ["pago_cliente"];
  const tiposInversionista = ["recibo_inversion", "devolucion_inversion"];
  const tiposComunes = ["entrega_prestamo"];

  if (
    perfil.rol === "cliente" &&
    !tiposCliente.includes(tipo) &&
    !tiposComunes.includes(tipo)
  ) {
    throw new AppError(
      "Tipo de movimiento no válido para cliente",
      400,
      "INVALID_MOVEMENT_TYPE",
    );
  }

  if (
    perfil.rol === "inversionista" &&
    !tiposInversionista.includes(tipo) &&
    !tiposComunes.includes(tipo)
  ) {
    throw new AppError(
      "Tipo de movimiento no válido para inversionista",
      400,
      "INVALID_MOVEMENT_TYPE",
    );
  }

  // Verificar préstamo si se especificó
  if (prestamo_id) {
    const { rows: prestamos } = await db.query(
      "SELECT id, cliente_id FROM prestamos WHERE id = $1",
      [prestamo_id]
    );
    const prestamo = prestamos[0];

    if (!prestamo) {
      throw new AppError("Préstamo no encontrado", 404, "PRESTAMO_NOT_FOUND");
    }

    if (prestamo.cliente_id !== perfil_id) {
      throw new AppError(
        `El préstamo no pertenece al perfil especificado.`,
        400,
        "MISMATCH_PROFILE",
      );
    }
  }

  // Verificar inversión si se especificó
  if (inversion_id) {
    const { rows: inversiones } = await db.query(
      "SELECT id, inversionista_id FROM inversiones WHERE id = $1",
      [inversion_id]
    );
    const inversion = inversiones[0];

    if (!inversion) {
      throw new AppError("Inversión no encontrada", 404, "INVERSION_NOT_FOUND");
    }

    if (inversion.inversionista_id !== perfil_id) {
      throw new AppError(
        "La inversión no pertenece al perfil especificado",
        400,
        "MISMATCH_PROFILE",
      );
    }
  }

  // Crear movimiento con pg
  try {
    const { rows: [movimientoSimple] } = await db.query(
      `INSERT INTO movimientos (
        perfil_id, prestamo_id, inversion_id, monto_total, monto_capital, 
        monto_interes, monto_mora, metodo_pago, referencia_pago, 
        url_captura, tipo, fecha_operacion, notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING *`,
      [
        perfil_id,
        prestamo_id || null,
        inversion_id || null,
        monto_total,
        monto_capital,
        monto_interes,
        monto_mora,
        metodo_pago || null,
        referencia_pago || null,
        url_captura || null,
        tipo,
        new Date().toISOString(),
        notas || null,
      ]
    );

    // Obtener movimiento completo con relaciones para la respuesta
    const { rows: [movimiento] } = await db.query(
      `SELECT m.*, 
        json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email) as perfil,
        json_build_object('id', pr.id, 'monto_principal', pr.monto_principal) as prestamo,
        json_build_object('id', i.id, 'monto_invertido', i.monto_invertido) as inversion
      FROM movimientos m
      JOIN perfiles p ON m.perfil_id = p.id
      LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
      LEFT JOIN inversiones i ON m.inversion_id = i.id
      WHERE m.id = $1`,
      [movimientoSimple.id]
    );

    res.status(201).json({
      success: true,
      data: movimiento,
      message: "Movimiento registrado exitosamente",
    });
  } catch (error) {
    throw new AppError(
      "Error creando movimiento: " + error.message,
      400,
      "DB_ERROR",
    );
  }

  res.status(201).json({
    success: true,
    data: movimiento,
    message: "Movimiento registrado exitosamente",
  });
});

/**
 * Obtener todos los movimientos con filtros
 * GET /api/movimientos
 */
const obtenerMovimientos = asyncHandler(async (req, res) => {
  const {
    perfil_id,
    tipo,
    prestamo_id,
    inversion_id,
    fecha_desde,
    fecha_hasta,
    metodo_pago,
    page = 1,
    limit = 20,
  } = req.query;

  const offset = (page - 1) * limit;
  let queryText = `
    SELECT m.*, 
      json_build_object(
        'id', p.id, 
        'nombre_completo', p.nombre_completo, 
        'identificacion', p.identificacion,
        'email', p.email
      ) as perfil,
      json_build_object(
        'id', pr.id, 
        'monto_principal', pr.monto_principal,
        'estado', pr.estado,
        'fecha_inicio', pr.fecha_inicio
      ) as prestamo,
      json_build_object(
        'id', inv.id, 
        'monto_invertido', inv.monto_invertido,
        'estado', inv.estado
      ) as inversion,
      COUNT(*) OVER() as total_count
    FROM movimientos m
    JOIN perfiles p ON m.perfil_id = p.id
    LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
    LEFT JOIN inversiones inv ON m.inversion_id = inv.id
    WHERE 1=1
  `;
  const queryParams = [];
  let paramIndex = 1;

  if (perfil_id) {
    queryText += ` AND m.perfil_id = $${paramIndex++}`;
    queryParams.push(perfil_id);
  }
  if (tipo) {
    queryText += ` AND m.tipo = $${paramIndex++}`;
    queryParams.push(tipo);
  }
  if (prestamo_id) {
    queryText += ` AND m.prestamo_id = $${paramIndex++}`;
    queryParams.push(prestamo_id);
  }
  if (inversion_id) {
    queryText += ` AND m.inversion_id = $${paramIndex++}`;
    queryParams.push(inversion_id);
  }
  if (metodo_pago) {
    queryText += ` AND m.metodo_pago = $${paramIndex++}`;
    queryParams.push(metodo_pago);
  }
  if (fecha_desde) {
    queryText += ` AND m.fecha_operacion >= $${paramIndex++}`;
    queryParams.push(fecha_desde);
  }
  if (fecha_hasta) {
    queryText += ` AND m.fecha_operacion <= $${paramIndex++}`;
    queryParams.push(fecha_hasta);
  }

  queryText += ` ORDER BY m.fecha_operacion DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limit, offset);

  try {
    const { rows: movimientos } = await db.query(queryText, queryParams);
    const totalCount = movimientos.length > 0 ? parseInt(movimientos[0].total_count) : 0;

    const dataLimpiada = movimientos.map(m => {
      const { total_count, ...movData } = m;
      return movData;
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
      "Error obteniendo movimientos: " + error.message,
      400,
      "DB_ERROR",
    );
  }
});

/**
 * Obtener un movimiento por ID
 * GET /api/movimientos/:id
 */
const obtenerMovimiento = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { rows: [movimiento] } = await db.query(
    `SELECT m.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email, 'telefono', p.telefono) as perfil,
      json_build_object('id', pr.id, 'estado', pr.estado) as prestamo,
      json_build_object('id', i.id, 'estado', i.estado) as inversion
    FROM movimientos m
    JOIN perfiles p ON m.perfil_id = p.id
    LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
    LEFT JOIN inversiones i ON m.inversion_id = i.id
    WHERE m.id = $1`,
    [id]
  );

  if (!movimiento) {
    throw new AppError("Movimiento no encontrado", 404, "NOT_FOUND");
  }

  res.json({
    success: true,
    data: movimiento,
  });
});

/**
 * Actualizar un movimiento
 * PUT /api/movimientos/:id
 */
const actualizarMovimiento = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Verificar que el movimiento existe
  const { rows: existentes } = await db.query(
    "SELECT id FROM movimientos WHERE id = $1",
    [id]
  );

  if (existentes.length === 0) {
    throw new AppError("Movimiento no encontrado", 404, "NOT_FOUND");
  }

  // Solo permitir actualizar ciertos campos
  const allowedFields = [
    "notas",
    "referencia_pago",
    "url_captura",
    "metodo_pago",
  ];
  const filteredUpdates = {};

  Object.keys(updates).forEach((key) => {
    if (allowedFields.includes(key)) {
      filteredUpdates[key] = updates[key];
    }
  });

  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError("No hay campos para actualizar", 400, "MISSING_FIELDS");
  }

  const keys = Object.keys(filteredUpdates);
  const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(", ");
  
  const { rows: [movimiento] } = await db.query(
    `UPDATE movimientos SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(filteredUpdates), id]
  );

  res.json({
    success: true,
    data: movimiento,
    message: "Movimiento actualizado exitosamente",
  });
});

/**
 * Eliminar un movimiento
 * DELETE /api/movimientos/:id
 */
const eliminarMovimiento = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verificar que el movimiento existe
  const { rows: existentes } = await db.query(
    "SELECT id, tipo FROM movimientos WHERE id = $1",
    [id]
  );

  if (existentes.length === 0) {
    throw new AppError("Movimiento no encontrado", 404, "NOT_FOUND");
  }

  const movimiento = existentes[0];

  // No permitir eliminar movimientos de entrega de préstamo o recibo de inversión
  if (
    movimiento.tipo === "entrega_prestamo" ||
    movimiento.tipo === "recibo_inversion"
  ) {
    throw new AppError(
      "No se pueden eliminar movimientos iniciales",
      400,
      "CANNOT_DELETE_INITIAL",
    );
  }

  await db.query("DELETE FROM movimientos WHERE id = $1", [id]);

  res.json({
    success: true,
    message: "Movimiento eliminado exitosamente",
  });
});

/**
 * Obtener resumen financiero de movimientos
 * GET /api/movimientos/resumen/flujo-caja
 */
const obtenerResumenFlujoCaja = asyncHandler(async (req, res) => {
  const { fecha_desde, fecha_hasta } = req.query;

  let queryText = "SELECT * FROM movimientos WHERE 1=1";
  const queryParams = [];
  let paramIndex = 1;

  if (fecha_desde) {
    queryText += ` AND fecha_operacion >= $${paramIndex++}`;
    queryParams.push(fecha_desde);
  }

  if (fecha_hasta) {
    queryText += ` AND fecha_operacion <= $${paramIndex++}`;
    queryParams.push(fecha_hasta);
  }

  const { rows: movimientos } = await db.query(queryText, queryParams);

  // Calcular totales
  const resumen = {
    entradas: { recibos_inversion: 0, pagos_clientes: 0, total: 0 },
    salidas: { entregas_prestamo: 0, devoluciones_inversion: 0, total: 0 },
    neto: 0,
    por_tipo: {},
  };

  movimientos.forEach((m) => {
    const tipo = m.tipo;
    const montoTotal = parseFloat(m.monto_total);

    if (!resumen.por_tipo[tipo]) {
      resumen.por_tipo[tipo] = {
        cantidad: 0, total: 0, capital: 0, interes: 0, mora: 0,
      };
    }

    resumen.por_tipo[tipo].cantidad++;
    resumen.por_tipo[tipo].total += montoTotal;
    resumen.por_tipo[tipo].capital += parseFloat(m.monto_capital) || 0;
    resumen.por_tipo[tipo].interes += parseFloat(m.monto_interes) || 0;
    resumen.por_tipo[tipo].mora += parseFloat(m.monto_mora) || 0;

    if (tipo === "recibo_inversion" || tipo === "pago_cliente") {
      if (tipo === "recibo_inversion") {
        resumen.entradas.recibos_inversion += montoTotal;
      } else {
        resumen.entradas.pagos_clientes += montoTotal;
      }
      resumen.entradas.total += montoTotal;
      resumen.neto += montoTotal;
    } else {
      if (tipo === "entrega_prestamo") {
        resumen.salidas.entregas_prestamo += montoTotal;
      } else {
        resumen.salidas.devoluciones_inversion += montoTotal;
      }
      resumen.salidas.total += montoTotal;
      resumen.neto -= montoTotal;
    }
  });

  res.json({
    success: true,
    data: resumen,
    periodo: {
      desde: fecha_desde || "inicio",
      hasta: fecha_hasta || "hoy",
    },
  });
});

module.exports = {
  crearMovimiento,
  obtenerMovimientos,
  obtenerMovimiento,
  actualizarMovimiento,
  eliminarMovimiento,
  obtenerResumenFlujoCaja,
};
