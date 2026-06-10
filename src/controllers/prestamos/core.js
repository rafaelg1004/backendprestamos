const db = require("../../config/db");
const fs = require("fs");
const path = require("path");
const { asyncHandler, AppError } = require("../../middleware/errorHandler");
const {
  calcularDiasMora,
  calcularInteresSimple,
  calcularMora,
  calcularCuotaMensual,
  generarTablaAmortizacion,
  calcularDesglosePago,
  calcularMesesTranscurridos,
  formatearMoneda,
  deMilunidades,
} = require("../../utils/calculos");

const crearPrestamo = asyncHandler(async (req, res) => {
  const {
    cliente_id,
    monto_principal,
    tasa_interes_mensual,
    tasa_mora_diaria,
    fecha_inicio,
    fecha_vencimiento,
    fondos, 
    salidas, 
    notas
  } = req.body;

  if (!fondos || !Array.isArray(fondos) || fondos.length === 0) {
    throw new AppError("Debes especificar el reparto de inversionistas", 400);
  }

  if (!salidas || !Array.isArray(salidas) || salidas.length === 0) {
    throw new AppError("Debes especificar la salida de fondos (cuentas)", 400);
  }

  const totalFondos = fondos.reduce((sum, f) => sum + parseFloat(f.monto), 0);
  if (Math.abs(totalFondos - monto_principal) > 1) {
    throw new AppError(`El reparto de inversionistas (${totalFondos}) no coincide con el principal (${monto_principal})`, 400);
  }

  const totalSalidas = salidas.reduce((sum, s) => sum + parseFloat(s.monto), 0);
  if (Math.abs(totalSalidas - monto_principal) > 1) {
    throw new AppError(`La salida de cuentas (${totalSalidas}) no coincide con el principal (${monto_principal})`, 400);
  }

  const { rows: clientes } = await db.query(
    "SELECT id, rol FROM perfiles WHERE id = $1",
    [cliente_id],
  );
  const cliente = clientes[0];

  if (!cliente) {
    throw new AppError("Cliente no encontrado", 404, "CLIENTE_NOT_FOUND");
  }

  if (cliente.rol !== "cliente") {
    throw new AppError(
      "El perfil seleccionado no es un cliente",
      400,
      "INVALID_ROLE",
    );
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const mainCuentaId = salidas[0].cuenta_id;
    const {
      rows: [prestamo],
    } = await client.query(
      `INSERT INTO prestamos (
        cliente_id, monto_principal, tasa_interes_mensual, 
        tasa_mora_diaria, fecha_inicio, fecha_vencimiento, 
        estado, cuenta_id, notas, saldo_capital, fecha_ultimo_corte
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
      RETURNING *`,
      [
        cliente_id,
        monto_principal,
        tasa_interes_mensual,
        tasa_mora_diaria,
        fecha_inicio,
        fecha_vencimiento || '2099-12-31',
        "activo",
        mainCuentaId,
        notas || null,
        monto_principal,
        fecha_inicio
      ],
    );



    for (const fondo of fondos) {
      await client.query(
        "INSERT INTO prestamo_fondos (prestamo_id, inversion_id, monto_aportado) VALUES ($1, $2, $3)",
        [prestamo.id, fondo.inversion_id, fondo.monto]
      );
    }

    for (const salida of salidas) {
      await client.query(
        `INSERT INTO movimientos (
          perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, monto_mora, tipo, fecha_operacion, usuario_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          cliente_id,
          prestamo.id,
          salida.cuenta_id,
          salida.monto,
          salida.monto,
          0,
          0,
          "entrega_prestamo",
          new Date().toISOString(),
          req.user ? req.user.id : null
        ],
      );

      await client.query(
        `UPDATE cuentas SET saldo_actual = saldo_actual - $1 WHERE id = $2`,
        [salida.monto, salida.cuenta_id]
      );
    }

    await client.query("COMMIT");

    const {
      rows: [prestamoCompleto],
    } = await db.query(
      `SELECT p.*, 
        json_build_object(
          'id', pref.id, 
          'nombre_completo', pref.nombre_completo, 
          'email', pref.email, 
          'telefono', pref.telefono
        ) as cliente
      FROM prestamos p
      JOIN perfiles pref ON p.cliente_id = pref.id
      WHERE p.id = $1`,
      [prestamo.id],
    );

    res.status(201).json({
      success: true,
      data: prestamoCompleto,
      message: "Préstamo creado exitosamente",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error al crear préstamo: " + error.message, 500);
  } finally {
    client.release();
  }
});

const obtenerPrestamos = asyncHandler(async (req, res) => {
  const {
    estado,
    cliente_id,
    inversionista_id,
    tasa_interes,
    fecha_desde,
    fecha_hasta,
    solo_mora = false,
  } = req.query;

  const limitVal = parseInt(req.query.limit || 50, 10);
  const pageVal = parseInt(req.query.page || 1, 10);
  const offsetVal = (pageVal - 1) * limitVal;

  let queryText = `
    SELECT p.*, 
      json_build_object(
        'id', pref.id, 
        'nombre_completo', pref.nombre_completo, 
        'email', pref.email
      ) as cliente,
      COUNT(*) OVER() as total_count
    FROM prestamos p
    JOIN perfiles pref ON p.cliente_id = pref.id
    WHERE 1=1
  `;
  const queryParams = [];
  let paramIndex = 1;

  if (estado) {
    queryText += ` AND p.estado = $${paramIndex++}`;
    queryParams.push(estado);
  }

  if (cliente_id) {
    queryText += ` AND p.cliente_id = $${paramIndex++}`;
    queryParams.push(cliente_id);
  }

  if (inversionista_id) {
    queryText += ` AND EXISTS (
      SELECT 1 FROM prestamo_fondos pf 
      JOIN inversiones inv ON pf.inversion_id = inv.id 
      WHERE pf.prestamo_id = p.id AND inv.inversionista_id = $${paramIndex++}
    )`;
    queryParams.push(inversionista_id);
  }

  if (tasa_interes) {
    queryText += ` AND p.tasa_interes_mensual = $${paramIndex++}`;
    queryParams.push(tasa_interes);
  }

  if (fecha_desde) {
    queryText += ` AND p.fecha_inicio >= $${paramIndex++}`;
    queryParams.push(fecha_desde);
  }

  if (fecha_hasta) {
    queryText += ` AND p.fecha_inicio <= $${paramIndex++}`;
    queryParams.push(fecha_hasta);
  }

  if (solo_mora === "true") {
    const hoy = new Date().toISOString().split("T")[0];
    queryText += ` AND (COALESCE(p.fecha_ultimo_corte, p.fecha_inicio) + INTERVAL '1 month')::date < $${paramIndex++} AND p.estado = 'activo'`;
    queryParams.push(hoy);
  }

  queryText += ` ORDER BY p.fecha_inicio DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limitVal, offsetVal);

  try {
    const { rows: prestamos } = await db.query(queryText, queryParams);
    const totalCount =
      prestamos.length > 0 ? parseInt(prestamos[0].total_count) : 0;

    const prestamosConCalculos = prestamos?.map((p) => {
      const { total_count, ...prestamoData } = p;
      const { calcularDiasTranscurridos, calcularInteresRotativo } = require("../../utils/calculos");
      
      const diasTranscurridos = calcularDiasTranscurridos(p.fecha_ultimo_corte || p.fecha_inicio);
      const interesGenerado = calcularInteresRotativo(p.saldo_capital, p.tasa_interes_mensual, diasTranscurridos);
      const interesTotalDeuda = parseFloat(p.interes_acumulado || 0) + interesGenerado;

      return {
        ...prestamoData,
        calculos: {
          dias_transcurridos: diasTranscurridos,
          interes_generado_periodo: interesGenerado,
          interes_total_deuda: interesTotalDeuda,
          capital_pendiente: parseFloat(p.saldo_capital)
        }
      };
    });

    res.json({
      success: true,
      data: prestamosConCalculos || [],
      pagination: {
        total: totalCount,
        page: pageVal,
        limit: limitVal,
        pages: Math.ceil(totalCount / limitVal)
      }
    });
  } catch (error) {
    throw new AppError("Error obteniendo préstamos: " + error.message, 500);
  }
});

const obtenerPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    rows: [prestamo],
  } = await db.query(
    `SELECT p.*, 
      json_build_object(
        'id', pref.id, 
        'nombre_completo', pref.nombre_completo, 
        'email', pref.email, 
        'telefono', pref.telefono
      ) as cliente
    FROM prestamos p
    JOIN perfiles pref ON p.cliente_id = pref.id
    WHERE p.id = $1`,
    [id],
  );

  if (!prestamo) {
    throw new AppError("Préstamo no encontrado", 404, "NOT_FOUND");
  }

  const { rows: movimientos } = await db.query(
    "SELECT * FROM movimientos WHERE prestamo_id = $1 ORDER BY fecha_operacion DESC",
    [id],
  );

  const { rows: fondos } = await db.query(`
    SELECT pf.*, 
      i.tasa_interes_pactada,
      json_build_object('nombre_completo', p.nombre_completo) as inversionista 
    FROM prestamo_fondos pf
    JOIN inversiones i ON pf.inversion_id = i.id
    JOIN perfiles p ON i.inversionista_id = p.id
    WHERE pf.prestamo_id = $1
  `, [id]);

  const { calcularDiasTranscurridos, calcularInteresRotativo } = require("../../utils/calculos");
  const diasTranscurridos = calcularDiasTranscurridos(prestamo.fecha_ultimo_corte || prestamo.fecha_inicio);
  const interesGenerado = calcularInteresRotativo(prestamo.saldo_capital, prestamo.tasa_interes_mensual, diasTranscurridos);
  const interesTotalDeuda = parseFloat(prestamo.interes_acumulado || 0) + interesGenerado;

  res.json({
    success: true,
    data: {
      ...prestamo,
      movimientos,
      fondos,
      calculos: {
        dias_transcurridos: diasTranscurridos,
        interes_generado_periodo: interesGenerado,
        interes_total_deuda: interesTotalDeuda,
        capital_pendiente: parseFloat(prestamo.saldo_capital)
      }
    }
  });
});

const actualizarPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const { rows: existentes } = await db.query(
    "SELECT id, estado FROM prestamos WHERE id = $1",
    [id],
  );
  const existente = existentes[0];

  if (!existente) {
    throw new AppError("Préstamo no encontrado", 404, "NOT_FOUND");
  }

  if (existente.estado === "pagado") {
    const allowedFields = ["notas"];
    const attemptedFields = Object.keys(updates);
    const hasInvalidFields = attemptedFields.some(
      (f) => !allowedFields.includes(f),
    );

    if (hasInvalidFields) {
      throw new AppError(
        "No se pueden modificar préstamos pagados, solo las notas",
        400,
        "PRESTAMO_PAGADO",
      );
    }
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new AppError("No hay campos para actualizar", 400, "MISSING_FIELDS");
  }

  const setClause = keys
    .map((key, index) => `${key} = $${index + 1}`)
    .join(", ");
  const queryText = `
    UPDATE prestamos 
    SET ${setClause} 
    WHERE id = $${keys.length + 1} 
    RETURNING *`;

  const {
    rows: [prestamoUpdated],
  } = await db.query(queryText, [...Object.values(updates), id]);

  const {
    rows: [prestamo],
  } = await db.query(
    `SELECT p.*, 
      json_build_object(
        'id', pref.id, 
        'nombre_completo', pref.nombre_completo, 
        'email', pref.email
      ) as cliente
    FROM prestamos p
    JOIN perfiles pref ON p.cliente_id = pref.id
    WHERE p.id = $1`,
    [id],
  );

  res.json({
    success: true,
    data: prestamo,
    message: "Préstamo actualizado exitosamente",
  });
});

const eliminarPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    
    await client.query("DELETE FROM movimientos WHERE prestamo_id = $1", [id]);
    await client.query("DELETE FROM prestamo_fondos WHERE prestamo_id = $1", [id]);
    await client.query("DELETE FROM prestamo_documentos WHERE prestamo_id = $1", [id]);
    await client.query("DELETE FROM prestamos WHERE id = $1", [id]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Préstamo eliminado exitosamente, incluyendo todos sus registros asociados",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error al eliminar préstamo", 500);
  } finally {
    client.release();
  }
});

const obtenerFiltros = asyncHandler(async (req, res) => {
  const { rows: tasas } = await db.query(
    "SELECT DISTINCT tasa_interes_mensual FROM prestamos ORDER BY tasa_interes_mensual ASC"
  );

  res.json({
    success: true,
    data: {
      tasas: tasas.map(t => t.tasa_interes_mensual)
    }
  });
});

module.exports = {
  crearPrestamo,
  obtenerPrestamos,
  obtenerPrestamo,
  actualizarPrestamo,
  eliminarPrestamo,
  obtenerFiltros
};
