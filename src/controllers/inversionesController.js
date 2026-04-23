const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const {
  calcularInteresSimple,
  calcularRetornoInversion,
  calcularMesesTranscurridos,
} = require("../utils/calculos");

/**
 * Crear una nueva inversión
 * POST /api/inversiones
 */
const crearInversion = asyncHandler(async (req, res) => {
  const { inversionista_id, monto_invertido, tasa_interes_pactada, notas } = req.body;

  // Verificar que el inversionista existe y es tipo 'inversionista'
  const { rows: perfiles } = await db.query(
    "SELECT id, rol FROM perfiles WHERE id = $1",
    [inversionista_id]
  );
  const inversionista = perfiles[0];

  if (!inversionista) {
    throw new AppError("Inversionista no encontrado", 404, "INVERSIONISTA_NOT_FOUND");
  }

  if (inversionista.rol !== "inversionista") {
    throw new AppError("El perfil seleccionado no es un inversionista", 400, "INVALID_ROLE");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Crear inversión
    const { rows: [inversionRes] } = await client.query(
      `INSERT INTO inversiones (inversionista_id, monto_invertido, tasa_interes_pactada, estado, notas) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [inversionista_id, monto_invertido, tasa_interes_pactada, "activo", notas || null]
    );

    // Registrar movimiento de recibo de inversión
    await client.query(
      `INSERT INTO movimientos (perfil_id, inversion_id, monto_total, monto_capital, monto_interes, tipo, fecha_operacion) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [inversionista_id, inversionRes.id, monto_invertido, monto_invertido, 0, "recibo_inversion", new Date().toISOString()]
    );

    await client.query("COMMIT");

    // Obtener inversión con perfil
    const { rows: [inversion] } = await db.query(
      `SELECT i.*, 
        json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email, 'telefono', p.telefono) as inversionista
      FROM inversiones i
      JOIN perfiles p ON i.inversionista_id = p.id
      WHERE i.id = $1`,
      [inversionRes.id]
    );

    res.status(201).json({
      success: true,
      data: inversion,
      message: "Inversión registrada exitosamente",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error creando inversión: " + error.message, 400, "DB_ERROR");
  } finally {
    client.release();
  }
});

/**
 * Obtener todas las inversiones con filtros
 * GET /api/inversiones
 */
const obtenerInversiones = asyncHandler(async (req, res) => {
  const { estado, inversionista_id, page = 1, limit = 20 } = req.query;

  const offset = (page - 1) * limit;
  let queryText = `
    SELECT i.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email) as inversionista,
      COUNT(*) OVER() as total_count
    FROM inversiones i
    JOIN perfiles p ON i.inversionista_id = p.id
    WHERE 1=1
  `;
  const queryParams = [];
  let paramIndex = 1;

  if (estado) {
    queryText += ` AND i.estado = $${paramIndex++}`;
    queryParams.push(estado);
  }
  if (inversionista_id) {
    queryText += ` AND i.inversionista_id = $${paramIndex++}`;
    queryParams.push(inversionista_id);
  }

  queryText += ` ORDER BY i.fecha_inversion DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limit, offset);

  const { rows: inversiones } = await db.query(queryText, queryParams);
  const totalCount = inversiones.length > 0 ? parseInt(inversiones[0].total_count) : 0;

  // Calcular información adicional
  const inversionesConCalculos = inversiones.map((inv) => {
    const { total_count, ...invData } = inv;
    const mesesTranscurridos = calcularMesesTranscurridos(invData.fecha_inversion);
    const retorno = calcularRetornoInversion(
      parseFloat(invData.monto_invertido),
      invData.tasa_interes_pactada,
      mesesTranscurridos,
    );

    return {
      ...invData,
      calculos: {
        meses_transcurridos: mesesTranscurridos,
        interes_generado: retorno.interes,
        retorno_total: retorno.total,
      },
    };
  });

  res.json({
    success: true,
    data: inversionesConCalculos,
    meta: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  });
});

/**
 * Obtener una inversión por ID
 * GET /api/inversiones/:id
 */
const obtenerInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { rows: [inversion] } = await db.query(
    `SELECT i.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email, 'telefono', p.telefono) as inversionista
    FROM inversiones i
    JOIN perfiles p ON i.inversionista_id = p.id
    WHERE i.id = $1`,
    [id]
  );

  if (!inversion) {
    throw new AppError("Inversion no encontrada", 404, "NOT_FOUND");
  }

  // Obtener movimientos relacionados
  const { rows: movimientos } = await db.query(
    "SELECT * FROM movimientos WHERE inversion_id = $1",
    [id]
  );
  inversion.movimientos = movimientos;

  // Calcular información financiera actual
  const mesesTranscurridos = calcularMesesTranscurridos(inversion.fecha_inversion);
  const retorno = calcularRetornoInversion(
    parseFloat(inversion.monto_invertido),
    inversion.tasa_interes_pactada,
    mesesTranscurridos,
  );

  // Calcular devoluciones realizadas
  const devolucionesRealizadas = movimientos
    ?.filter((m) => m.tipo === "devolucion_inversion")
    ?.reduce((sum, m) => sum + parseFloat(m.monto_total), 0) || 0;

  const inversionCompleta = {
    ...inversion,
    calculos: {
      meses_transcurridos: mesesTranscurridos,
      interes_generado: retorno.interes,
      retorno_total: retorno.total,
      total_devuelto: devolucionesRealizadas,
      saldo_pendiente: Math.max(0, retorno.total - devolucionesRealizadas),
    },
  };

  res.json({
    success: true,
    data: inversionCompleta,
  });
});

/**
 * Actualizar una inversión
 * PUT /api/inversiones/:id
 */
const actualizarInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Verificar que la inversión existe
  const { rows: existentes } = await db.query(
    "SELECT id, estado FROM inversiones WHERE id = $1",
    [id]
  );

  if (existentes.length === 0) {
    throw new AppError("Inversión no encontrada", 404, "NOT_FOUND");
  }

  const existente = existentes[0];

  // No permitir actualizar inversiones finalizadas (solo notas)
  if (existente.estado === "finalizada") {
    const allowedFields = ["notas"];
    const attemptedFields = Object.keys(updates);
    const hasInvalidFields = attemptedFields.some((f) => !allowedFields.includes(f));

    if (hasInvalidFields) {
      throw new AppError(
        "No se pueden modificar inversiones finalizadas, solo las notas",
        400,
        "INVERSION_FINALIZADA",
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError("No hay campos para actualizar", 400, "MISSING_FIELDS");
  }

  const keys = Object.keys(updates);
  const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(", ");
  
  const { rows: [inversion] } = await db.query(
    `UPDATE inversiones SET ${setClause} WHERE id = $${keys.length + 1} 
    RETURNING *, (SELECT json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email) FROM perfiles p WHERE p.id = inversionista_id) as inversionista`,
    [...Object.values(updates), id]
  );

  res.json({
    success: true,
    data: inversion,
    message: "Inversión actualizada exitosamente",
  });
});

/**
 * Registrar devolución de inversión
 * POST /api/inversiones/:id/devolver
 */
const devolverInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    monto_total, monto_capital, monto_interes, metodo_pago,
    referencia_pago, url_captura, notas,
  } = req.body;

  // Verificar inversión
  const { rows: inversiones } = await db.query(
    `SELECT i.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo) as inversionista
    FROM inversiones i
    JOIN perfiles p ON i.inversionista_id = p.id
    WHERE i.id = $1`,
    [id]
  );
  const inversion = inversiones[0];

  if (!inversion) {
    throw new AppError("Inversión no encontrada", 404, "NOT_FOUND");
  }

  if (inversion.estado === "finalizada") {
    throw new AppError("La inversión ya ha sido finalizada", 400, "ALREADY_CLOSED");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Registrar la devolución como movimiento
    const { rows: [movimiento] } = await client.query(
      `INSERT INTO movimientos (
        perfil_id, inversion_id, monto_total, monto_capital, monto_interes, 
        metodo_pago, referencia_pago, url_captura, tipo, fecha_operacion, notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        inversion.inversionista_id, id, monto_total, monto_capital || 0, monto_interes || 0,
        metodo_pago, referencia_pago, url_captura, "devolucion_inversion", new Date().toISOString(), notas
      ]
    );

    // 2. Verificar si ya se devolvió todo para marcar como finalizada
    const { rows: devoluciones } = await client.query(
      "SELECT monto_total FROM movimientos WHERE inversion_id = $1 AND tipo = $2",
      [id, "devolucion_inversion"]
    );

    const totalDevuelto = devoluciones.reduce((sum, m) => sum + parseFloat(m.monto_total), 0);

    // Calcular el total esperado
    const mesesTranscurridos = calcularMesesTranscurridos(inversion.fecha_inversion);
    const retorno = calcularRetornoInversion(
      parseFloat(inversion.monto_invertido),
      inversion.tasa_interes_pactada,
      mesesTranscurridos,
    );

    let inversionActualizada = inversion;

    // Si se ha devuelto el total o más, marcar como finalizada
    if (totalDevuelto >= retorno.total) {
      const { rows: [invFinalizada] } = await client.query(
        "UPDATE inversiones SET estado = $1 WHERE id = $2 RETURNING *",
        ["finalizada", id]
      );
      inversionActualizada = invFinalizada;
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      data: {
        inversion: inversionActualizada,
        movimiento,
        total_devuelto: totalDevuelto,
        retorno_esperado: retorno.total,
      },
      message: "Devolución registrada exitosamente",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error registrando la devolución: " + error.message, 400, "DB_ERROR");
  } finally {
    client.release();
  }
});

/**
 * Eliminar una inversión
 * DELETE /api/inversiones/:id
 */
const eliminarInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verificar que no tenga movimientos de devolución
  const { rows: movimientos } = await db.query(
    "SELECT id FROM movimientos WHERE inversion_id = $1 AND tipo = $2",
    [id, "devolucion_inversion"]
  );

  if (movimientos.length > 0) {
    throw new AppError(
      "No se puede eliminar: la inversión tiene devoluciones registradas",
      400,
      "HAS_RETURNS",
    );
  }

  await db.query("DELETE FROM inversiones WHERE id = $1", [id]);

  res.json({
    success: true,
    message: "Inversión eliminada exitosamente",
  });
});

module.exports = {
  crearInversion,
  obtenerInversiones,
  obtenerInversion,
  actualizarInversion,
  devolverInversion,
  eliminarInversion,
};
