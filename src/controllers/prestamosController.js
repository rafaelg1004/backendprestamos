const db = require("../config/db");
const fs = require("fs");
const path = require("path");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
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
} = require("../utils/calculos");

/**
 * Crear un nuevo préstamo
 * POST /api/prestamos
 */
const crearPrestamo = asyncHandler(async (req, res) => {
  const {
    cliente_id,
    monto_principal,
    tasa_interes_mensual,
    tasa_mora_diaria,
    fecha_inicio,
    fecha_vencimiento,
    fondos, // [{ inversion_id, monto }]
    salidas, // [{ cuenta_id, monto }]
    notas,
    plazo_meses,
    frecuencia_pago,
    tipo_amortizacion,
  } = req.body;

  if (!fondos || !Array.isArray(fondos) || fondos.length === 0) {
    throw new AppError("Debes especificar el reparto de inversionistas", 400);
  }

  if (!salidas || !Array.isArray(salidas) || salidas.length === 0) {
    throw new AppError("Debes especificar la salida de fondos (cuentas)", 400);
  }

  // Validar que el reparto de inversionistas sume el principal
  const totalFondos = fondos.reduce((sum, f) => sum + parseFloat(f.monto), 0);
  if (Math.abs(totalFondos - monto_principal) > 1) {
    throw new AppError(`El reparto de inversionistas (${totalFondos}) no coincide con el principal (${monto_principal})`, 400);
  }

  // Validar que la salida de cuentas sume el principal
  const totalSalidas = salidas.reduce((sum, s) => sum + parseFloat(s.monto), 0);
  if (Math.abs(totalSalidas - monto_principal) > 1) {
    throw new AppError(`La salida de cuentas (${totalSalidas}) no coincide con el principal (${monto_principal})`, 400);
  }

  // Verificar que el cliente existe y es tipo 'cliente'
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

    // Crear préstamo
    const mainCuentaId = salidas[0].cuenta_id;
    const {
      rows: [prestamo],
    } = await client.query(
      `INSERT INTO prestamos (
        cliente_id, monto_principal, tasa_interes_mensual, 
        tasa_mora_diaria, fecha_inicio, fecha_vencimiento, 
        estado, cuenta_id, notas, plazo_meses, frecuencia_pago, tipo_amortizacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
      RETURNING *`,
      [
        cliente_id,
        monto_principal,
        tasa_interes_mensual,
        tasa_mora_diaria,
        fecha_inicio,
        fecha_vencimiento,
        "activo",
        mainCuentaId,
        notas || null,
        plazo_meses || 1,
        frecuencia_pago || 'mensual',
        tipo_amortizacion || 'final'
      ],
    );

    // Generar cuotas si el tipo no es 'final' o si tiene más de 1 plazo
    if (tipo_amortizacion !== 'final' && plazo_meses > 0) {
      const tabla = generarTablaAmortizacion(
        monto_principal,
        tasa_interes_mensual,
        plazo_meses,
        tipo_amortizacion,
        frecuencia_pago
      );

      for (const item of tabla) {
        // Calcular fecha de vencimiento de la cuota
        const fechaCuota = new Date(fecha_inicio);
        if (frecuencia_pago === 'semanal') {
          fechaCuota.setDate(fechaCuota.getDate() + (item.mes * 7));
        } else if (frecuencia_pago === 'quincenal') {
          fechaCuota.setDate(fechaCuota.getDate() + (item.mes * 15));
        } else {
          fechaCuota.setMonth(fechaCuota.getMonth() + item.mes);
        }

        await client.query(
          `INSERT INTO cuotas (
            prestamo_id, numero_cuota, fecha_vencimiento, 
            capital, interes, total_cuota, estado
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            prestamo.id,
            item.mes,
            fechaCuota.toISOString().split('T')[0],
            item.capital,
            item.interes,
            item.cuota,
            'pendiente'
          ]
        );
      }
    }

    // 1. Registrar fondos (Trazabilidad: quién pone el dinero)
    for (const fondo of fondos) {
      await client.query(
        "INSERT INTO prestamo_fondos (prestamo_id, inversion_id, monto_aportado) VALUES ($1, $2, $3)",
        [prestamo.id, fondo.inversion_id, fondo.monto]
      );
    }

    // 2. Procesar salidas de dinero (Contabilidad: de qué cuentas sale)
    for (const salida of salidas) {
      // Registrar movimiento individual por cuenta
      await client.query(
        `INSERT INTO movimientos (
          perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, monto_mora, tipo, fecha_operacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
        ],
      );
    }

    await client.query("COMMIT");

    // Obtener el préstamo con la info del cliente para la respuesta
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
    throw new AppError(
      "Error creando préstamo: " + error.message,
      400,
      "DB_ERROR",
    );
  } finally {
    client.release();
  }
});

/**
 * Obtener todos los préstamos con filtros
 * GET /api/prestamos
 */
const obtenerPrestamos = asyncHandler(async (req, res) => {
  const {
    estado,
    cliente_id,
    inversionista_id,
    tasa_interes,
    fecha_desde,
    fecha_hasta,
    page = 1,
    limit = 50,
    solo_mora = false,
  } = req.query;

  const offset = (page - 1) * limit;
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

  // Filtros
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
    queryText += ` AND p.fecha_vencimiento < $${paramIndex++} AND p.estado = 'activo'`;
    queryParams.push(hoy);
  }

  // Orden y Paginación
  queryText += ` ORDER BY p.fecha_inicio DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limit, offset);

  try {
    const { rows: prestamos } = await db.query(queryText, queryParams);
    const totalCount =
      prestamos.length > 0 ? parseInt(prestamos[0].total_count) : 0;

    // Calcular información adicional para cada préstamo
    const prestamosConCalculos = prestamos?.map((p) => {
      // Eliminar total_count del objeto del préstamo
      const { total_count, ...prestamoData } = p;

      const diasMora = calcularDiasMora(p.fecha_vencimiento);
      const mesesTranscurridos = calcularMesesTranscurridos(p.fecha_inicio);
      const desglose = calcularDesglosePago({
        montoPrincipal: p.monto_principal,
        tasaInteresMensual: p.tasa_interes_mensual,
        mesesTranscurridos,
        tasaMoraDiaria: p.tasa_mora_diaria,
        diasMora,
      });

      return {
        ...prestamoData,
        calculos: {
          dias_mora: diasMora,
          meses_transcurridos: mesesTranscurridos,
          interes_acumulado: desglose.interes,
          mora_acumulada: desglose.mora,
          total_adeudado: desglose.total,
          en_mora: diasMora > 0 && p.estado === "activo",
        },
      };
    });

    res.json({
      success: true,
      data: prestamosConCalculos || [],
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    throw new AppError(
      "Error obteniendo préstamos: " + error.message,
      400,
      "DB_ERROR",
    );
  }
});

/**
 * Obtener un préstamo por ID
 * GET /api/prestamos/:id
 */
const obtenerPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Obtener préstamo con cliente
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

  // Obtener movimientos
  const { rows: movimientos } = await db.query(
    "SELECT * FROM movimientos WHERE prestamo_id = $1",
    [id],
  );

  // Obtener cuotas
  const { rows: cuotas } = await db.query(
    "SELECT * FROM cuotas WHERE prestamo_id = $1",
    [id],
  );

  const prestamoConDetalles = {
    ...prestamo,
    movimientos,
    cuotas,
  };

  // Calcular información financiera actual
  const diasMora = calcularDiasMora(prestamoConDetalles.fecha_vencimiento);
  const mesesTranscurridos = calcularMesesTranscurridos(
    prestamoConDetalles.fecha_inicio,
  );
  const desglose = calcularDesglosePago({
    montoPrincipal: prestamoConDetalles.monto_principal,
    tasaInteresMensual: prestamoConDetalles.tasa_interes_mensual,
    mesesTranscurridos,
    tasaMoraDiaria: prestamoConDetalles.tasa_mora_diaria,
    diasMora,
  });

  // Calcular pagos realizados
  const pagosCapital =
    movimientos
      ?.filter((m) => m.tipo === "pago_cliente")
      ?.reduce((sum, m) => sum + (parseFloat(m.monto_capital) || 0), 0) || 0;

  const pagosInteres =
    movimientos
      ?.filter((m) => m.tipo === "pago_cliente")
      ?.reduce((sum, m) => sum + (parseFloat(m.monto_interes) || 0), 0) || 0;

  const pagosRealizados = pagosCapital + pagosInteres;

  // Saldo pendiente = capital prestado - capital pagado
  const saldoCapitalPendiente = Math.max(
    0,
    prestamoConDetalles.monto_principal - pagosCapital,
  );

  // Calcular plazo en meses
  const plazoMeses =
    prestamoConDetalles.plazo_meses ||
    Math.ceil(
      (new Date(prestamoConDetalles.fecha_vencimiento) -
        new Date(prestamoConDetalles.fecha_inicio)) /
        (1000 * 60 * 60 * 24 * 30),
    ) ||
    1;

  // Calcular cuota mensual fija
  const cuotaMensual = calcularCuotaMensual(
    prestamoConDetalles.monto_principal,
    prestamoConDetalles.tasa_interes_mensual,
    plazoMeses,
  );

  // Generar tabla de amortización
  const tablaAmortizacion = generarTablaAmortizacion(
    prestamoConDetalles.monto_principal,
    prestamoConDetalles.tasa_interes_mensual,
    plazoMeses,
  );

  const prestamoCompleto = {
    ...prestamoConDetalles,
    calculos: {
      dias_mora: diasMora,
      meses_transcurridos: mesesTranscurridos,
      interes_acumulado: desglose.interes,
      mora_acumulada: desglose.mora,
      total_adeudado: desglose.total,
      total_pagado: pagosRealizados,
      capital_pagado: pagosCapital,
      interes_pagado: pagosInteres,
      saldo_pendiente: saldoCapitalPendiente,
      en_mora: diasMora > 0 && prestamoConDetalles.estado === "activo",
      cuota_mensual: cuotaMensual,
      tabla_amortizacion: tablaAmortizacion,
      plazo_meses: plazoMeses,
    },
  };

  res.json({
    success: true,
    data: prestamoCompleto,
  });
});

/**
 * Actualizar un préstamo
 * PUT /api/prestamos/:id
 */
const actualizarPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Verificar que el préstamo existe
  const { rows: existentes } = await db.query(
    "SELECT id, estado FROM prestamos WHERE id = $1",
    [id],
  );
  const existente = existentes[0];

  if (!existente) {
    throw new AppError("Préstamo no encontrado", 404, "NOT_FOUND");
  }

  // No permitir actualizar préstamos pagados (solo notas)
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

  // Construir query dinámica para UPDATE
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

  // Obtener préstamo con cliente para la respuesta
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

/**
 * Calcular liquidación de préstamo (cuánto debe pagar hoy para liquidar)
 * GET /api/prestamos/:id/liquidacion
 */
const calcularLiquidacion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    rows: [prestamo],
  } = await db.query("SELECT * FROM prestamos WHERE id = $1", [id]);

  if (!prestamo) {
    throw new AppError("Préstamo no encontrado", 404, "NOT_FOUND");
  }

  if (prestamo.estado !== "activo") {
    throw new AppError(
      "El préstamo ya está liquidado",
      400,
      "PRESTAMO_NO_ACTIVO",
    );
  }

  // Obtener movimientos para cálculos
  const { rows: movimientos } = await db.query(
    "SELECT * FROM movimientos WHERE prestamo_id = $1",
    [id],
  );

  // Calcular capital pagado
  const pagosCapital =
    movimientos
      ?.filter((m) => m.tipo === "pago_cliente")
      ?.reduce((sum, m) => sum + (parseFloat(m.monto_capital) || 0), 0) || 0;

  // Saldo capital pendiente
  const saldoCapitalPendiente = Math.max(
    0,
    prestamo.monto_principal - pagosCapital,
  );

  // Calcular meses transcurridos desde el inicio hasta hoy
  const mesesTranscurridos = calcularMesesTranscurridos(prestamo.fecha_inicio);

  // Calcular interés simple sobre el capital original (solo por los meses que realmente pasaron)
  const interesesReales = Math.round(
    prestamo.monto_principal *
      (prestamo.tasa_interes_mensual / 100) *
      mesesTranscurridos,
  );

  // Intereses ya pagados
  const interesesPagados =
    movimientos
      ?.filter((m) => m.tipo === "pago_cliente")
      ?.reduce((sum, m) => sum + (parseFloat(m.monto_interes) || 0), 0) || 0;

  // Interés pendiente (lo que realmente debe)
  const interesPendiente = Math.max(0, interesesReales - interesesPagados);

  // Mora (si hay)
  const mora =
    prestamo.tasa_mora_diaria > 0 &&
    prestamo.fecha_vencimiento < new Date().toISOString().split("T")[0]
      ? calcularMora(
          saldoCapitalPendiente,
          prestamo.tasa_mora_diaria,
          calcularDiasMora(prestamo.fecha_vencimiento),
        )
      : 0;

  const liquidacionTotal = saldoCapitalPendiente + interesPendiente + mora;

  res.json({
    success: true,
    data: {
      prestamo_id: id,
      saldo_capital_pendiente: saldoCapitalPendiente,
      interes_acumulado_real: interesesReales,
      interes_pagado: interesesPagados,
      interes_pendiente: interesPendiente,
      mora: mora,
      total_a_pagar: liquidacionTotal,
      meses_transcurridos: mesesTranscurridos,
      ahorro_intereses: 0, // Simplificado para la respuesta
      mensaje:
        mora > 0
          ? `Liquidación con mora incluida: ${formatearMoneda(liquidacionTotal)}`
          : `Liquidación por pago anticipado: ${formatearMoneda(liquidacionTotal)}`,
    },
  });
});

/**
 * Marcar préstamo como pagado con soporte para liquidación anticipada
 * POST /api/prestamos/:id/pagar
 */
const pagarPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    monto_total,
    monto_capital,
    monto_interes,
    monto_mora,
    metodo_pago,
    referencia_pago,
    url_captura,
    cuenta_id,
    notas,
  } = req.body;

  if (!cuenta_id) {
    throw new AppError("Debes seleccionar una cuenta para recibir el pago", 400);
  }

  // Verificar préstamo
  const {
    rows: [prestamo],
  } = await db.query("SELECT * FROM prestamos WHERE id = $1", [id]);

  if (!prestamo) {
    throw new AppError("Préstamo no encontrado", 404, "NOT_FOUND");
  }

  if (prestamo.estado === "pagado") {
    throw new AppError("El préstamo ya está pagado", 400, "ALREADY_PAID");
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Registrar el pago como movimiento
    const {
      rows: [movimiento],
    } = await client.query(
      `INSERT INTO movimientos (
        perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
        monto_interes, monto_mora, metodo_pago, referencia_pago, 
        url_captura, tipo, fecha_operacion, notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING *`,
      [
        prestamo.cliente_id,
        id,
        cuenta_id,
        monto_total,
        monto_capital || 0,
        monto_interes || 0,
        monto_mora || 0,
        metodo_pago,
        referencia_pago,
        url_captura,
        "pago_cliente",
        new Date().toISOString(),
        notas,
      ],
    );

    // 2. Actualizar estado del préstamo
    const {
      rows: [prestamoActualizado],
    } = await client.query(
      "UPDATE prestamos SET estado = 'pagado' WHERE id = $1 RETURNING *",
      [id],
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: {
        prestamo: prestamoActualizado,
        movimiento,
      },
      message: "Préstamo pagado exitosamente",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError(
      "Error registrando el pago: " + error.message,
      400,
      "DB_ERROR",
    );
  } finally {
    client.release();
  }
});

/**
 * Eliminar un préstamo
 * DELETE /api/prestamos/:id
 */
const eliminarPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verificar que no tenga movimientos (excepto el inicial)
  const { rows: movimientos } = await db.query(
    "SELECT id FROM movimientos WHERE prestamo_id = $1",
    [id],
  );

  if (movimientos && movimientos.length > 1) {
    throw new AppError(
      "No se puede eliminar: el préstamo tiene pagos registrados",
      400,
      "HAS_PAYMENTS",
    );
  }

  try {
    await db.query("DELETE FROM prestamos WHERE id = $1", [id]);
    res.json({
      success: true,
      message: "Préstamo eliminado exitosamente",
    });
  } catch (error) {
    throw new AppError(
      "Error eliminando préstamo: " + error.message,
      400,
      "DB_ERROR",
    );
  }
});

/**
 * Obtener préstamos en mora (vencidos)
 * GET /api/prestamos/mora/listado
 */
const obtenerPrestamosMora = asyncHandler(async (req, res) => {
  const hoy = new Date().toISOString().split("T")[0];

  const { rows: prestamos } = await db.query(
    `SELECT p.*, 
      json_build_object(
        'id', pref.id, 
        'nombre_completo', pref.nombre_completo, 
        'email', pref.email, 
        'telefono', pref.telefono
      ) as cliente
    FROM prestamos p
    JOIN perfiles pref ON p.cliente_id = pref.id
    WHERE p.fecha_vencimiento < $1 AND p.estado = 'activo'
    ORDER BY p.fecha_vencimiento ASC`,
    [hoy],
  );

  // Calcular mora para cada uno
  const prestamosMora = prestamos?.map((p) => {
    const diasMora = calcularDiasMora(p.fecha_vencimiento);
    const mesesTranscurridos = calcularMesesTranscurridos(p.fecha_inicio);
    const desglose = calcularDesglosePago({
      montoPrincipal: p.monto_principal,
      tasaInteresMensual: p.tasa_interes_mensual,
      mesesTranscurridos,
      tasaMoraDiaria: p.tasa_mora_diaria,
      diasMora,
    });

    return {
      ...p,
      calculos_mora: {
        dias_mora: diasMora,
        interes_acumulado: desglose.interes,
        mora_acumulada: desglose.mora,
        total_adeudado: desglose.total,
      },
    };
  });

  res.json({
    success: true,
    data: prestamosMora || [],
    total: prestamosMora?.length || 0,
  });
});

/**
 * Consultar préstamos por cédula (público, sin autenticación)
 * GET /api/prestamos/publico/cedula/:cedula
 */
const obtenerPrestamosPorCedula = asyncHandler(async (req, res) => {
  const { cedula } = req.params;

  // Buscar perfil por cédula
  const { data: perfil, error: perfilError } = await db
    .from("perfiles")
    .select("id, nombre_completo, telefono")
    .eq("identificacion", cedula)
    .single();

  if (perfilError || !perfil) {
    throw new AppError(
      "No se encontró ningún perfil con esa cédula",
      404,
      "NOT_FOUND",
    );
  }

  // Buscar préstamos del cliente
  const { data: prestamos, error: prestamosError } = await db
    .from("prestamos")
    .select("*")
    .eq("cliente_id", perfil.id)
    .order("fecha_inicio", { ascending: false });

  if (prestamosError) {
    throw new AppError("Error al buscar préstamos", 500, "DB_ERROR");
  }

  res.json({
    success: true,
    data: {
      perfil: {
        nombre: perfil.nombre_completo,
        telefono: perfil.telefono,
      },
      prestamos: prestamos || [],
      total: prestamos?.length || 0,
    },
  });
});

/**
 * Middleware para organizar archivos en carpetas por cliente y fecha
 */
const prepararCarpetaPrestamo = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const { rows: [p] } = await db.query(
    `SELECT pref.nombre_completo, p.fecha_inicio 
     FROM prestamos p 
     JOIN perfiles pref ON p.cliente_id = pref.id 
     WHERE p.id = $1`,
    [id]
  );

  if (!p) {
    throw new AppError("Préstamo no encontrado", 404);
  }

  // Generar nombre de carpeta: NombrePersona_YYYY-MM-DD
  const nombreLimpio = p.nombre_completo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar acentos
    .replace(/[^a-zA-Z0-9]/g, "_")  // Solo letras, números y guiones bajos
    .substring(0, 30); // Limitar longitud
  
  const fechaObj = p.fecha_inicio instanceof Date 
    ? p.fecha_inicio 
    : new Date(p.fecha_inicio);

  const año = fechaObj.getFullYear();
  const mes = fechaObj.getMonth(); // 0-11
  const semestre = mes < 6 ? 'Semestre_1' : 'Semestre_2';
  const fechaStr = fechaObj.toISOString().split('T')[0];

  req.uploadSubFolder = path.join(
    String(año),
    semestre,
    `${nombreLimpio}_${fechaStr}`
  );
  next();
});

/**
 * Subir un documento para un préstamo
 * POST /api/prestamos/:id/documentos
 */
const subirDocumento = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tipo_documento } = req.body;
  const file = req.file;

  if (!file) {
    throw new AppError("No se recibió ningún archivo", 400);
  }

  // Guardamos la ruta relativa incluyendo la subcarpeta si existe
  const rutaFinal = req.uploadSubFolder 
    ? path.join(req.uploadSubFolder, file.filename)
    : file.filename;

  const { rows: [doc] } = await db.query(
    `INSERT INTO prestamo_documentos (prestamo_id, nombre_archivo, ruta_archivo, tipo_documento)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, file.originalname, rutaFinal, tipo_documento || 'otro']
  );

  res.status(201).json({
    success: true,
    data: doc,
    message: "Documento subido y organizado correctamente"
  });
});

/**
 * Obtener todos los documentos de un préstamo
 * GET /api/prestamos/:id/documentos
 */
const obtenerDocumentos = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { rows: documentos } = await db.query(
    "SELECT * FROM prestamo_documentos WHERE prestamo_id = $1 ORDER BY fecha_subida DESC",
    [id]
  );

  res.json({
    success: true,
    data: documentos || []
  });
});

/**
 * Eliminar un documento específico
 * DELETE /api/prestamos/documentos/:docId
 */
const eliminarDocumento = asyncHandler(async (req, res) => {
  const { docId } = req.params;

  // Obtener info del archivo antes de borrar
  const { rows: [doc] } = await db.query(
    "SELECT * FROM prestamo_documentos WHERE id = $1",
    [docId]
  );

  if (!doc) {
    throw new AppError("Documento no encontrado", 404);
  }

  // Borrar de la base de datos
  await db.query("DELETE FROM prestamo_documentos WHERE id = $1", [docId]);

  // Borrar el archivo físico
  const uploadDir = process.env.UPLOAD_DIR || 'uploads/documentos';
  const filePath = path.join(process.cwd(), uploadDir, doc.ruta_archivo);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.json({
    success: true,
    message: "Documento eliminado exitosamente"
  });
});

/**
 * Obtener valores únicos para filtros (tasas, etc)
 * GET /api/prestamos/filtros
 */
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

/**
 * Pagar una cuota específica
 * POST /api/prestamos/cuotas/:id/pagar
 */
const pagarCuota = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { cuenta_id, metodo_pago, referencia_pago, notas } = req.body;

  if (!cuenta_id) {
    throw new AppError("Debes seleccionar una cuenta para recibir el pago", 400);
  }

  // 1. Obtener la cuota y el préstamo relacionado
  const { rows: [cuota] } = await db.query(
    `SELECT c.*, p.cliente_id, p.monto_principal 
     FROM cuotas c 
     JOIN prestamos p ON c.prestamo_id = p.id 
     WHERE c.id = $1`, 
    [id]
  );

  if (!cuota) {
    throw new AppError("Cuota no encontrada", 404);
  }

  if (cuota.estado === 'pagada') {
    throw new AppError("Esta cuota ya ha sido pagada", 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // 2. Marcar cuota como pagada
    await client.query(
      "UPDATE cuotas SET estado = 'pagada', fecha_pago = $1 WHERE id = $2",
      [new Date().toISOString(), id]
    );

    // 3. Registrar el movimiento (El trigger actualizará el saldo de la cuenta)
    await client.query(
      `INSERT INTO movimientos (
        perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
        monto_interes, tipo, metodo_pago, referencia_pago, notas, fecha_operacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        cuota.cliente_id,
        cuota.prestamo_id,
        cuenta_id,
        cuota.total_cuota,
        cuota.capital,
        cuota.interes,
        'pago_cliente',
        metodo_pago,
        referencia_pago,
        notas || `Pago de cuota #${cuota.numero_cuota}`,
        new Date().toISOString()
      ]
    );

    // 4. Verificar si todas las cuotas del préstamo están pagadas
    const { rows: cuotasPendientes } = await client.query(
      "SELECT id FROM cuotas WHERE prestamo_id = $1 AND estado = 'pendiente'",
      [cuota.prestamo_id]
    );

    if (cuotasPendientes.length === 0) {
      // Marcar préstamo como pagado
      await client.query(
        "UPDATE prestamos SET estado = 'pagado' WHERE id = $1",
        [cuota.prestamo_id]
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Cuota #${cuota.numero_cuota} pagada exitosamente`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error procesando pago de cuota: " + error.message, 500);
  } finally {
    client.release();
  }
});

module.exports = {
  crearPrestamo,
  obtenerPrestamos,
  obtenerPrestamo,
  actualizarPrestamo,
  pagarPrestamo,
  eliminarPrestamo,
  obtenerPrestamosMora,
  calcularLiquidacion,
  obtenerPrestamosPorCedula,
  subirDocumento,
  prepararCarpetaPrestamo,
  obtenerDocumentos,
  eliminarDocumento,
  pagarCuota,
  obtenerFiltros,
};

