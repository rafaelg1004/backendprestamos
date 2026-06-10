const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const path = require("path");
const {
  calcularMesesTranscurridos,
} = require("../utils/calculos");

/**
 * Middleware para estructurar carpetas de capturas de inversión
 */
const prepararCarpetaInversion = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const { rows: [inv] } = await db.query(
    `SELECT pref.nombre_completo, i.fecha_inversion 
     FROM inversiones i 
     JOIN perfiles pref ON i.inversionista_id = pref.id 
     WHERE i.id = $1`,
    [id]
  );

  if (!inv) {
    throw new AppError("Inversión no encontrada", 404);
  }

  const nombreLimpio = inv.nombre_completo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .substring(0, 30);
  
  const fechaObj = inv.fecha_inversion instanceof Date 
    ? inv.fecha_inversion 
    : new Date(inv.fecha_inversion);

  const año = fechaObj.getFullYear();
  const mes = fechaObj.getMonth();
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
 * Crear una nueva inversión
 */
const crearInversion = asyncHandler(async (req, res) => {
  const { 
    inversionista_id, monto_invertido, tasa_interes_pactada, 
    cuenta_id, notas 
  } = req.body;

  if (!inversionista_id || !monto_invertido || !tasa_interes_pactada || !cuenta_id) {
    throw new AppError("Faltan campos requeridos", 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: [inversionRes] } = await client.query(
      `INSERT INTO inversiones (inversionista_id, monto_invertido, tasa_interes_pactada, estado, cuenta_id, notas) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [inversionista_id, monto_invertido, tasa_interes_pactada, "activo", cuenta_id, notas || null]
    );

    await client.query(
      `INSERT INTO movimientos (perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, monto_interes, tipo, fecha_operacion, usuario_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [inversionista_id, inversionRes.id, cuenta_id, monto_invertido, monto_invertido, 0, "recibo_inversion", new Date().toISOString(), req.user ? req.user.id : null]
    );

    await client.query("COMMIT");

    const { rows: [inversion] } = await db.query(
      `SELECT i.*, 
        json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email, 'telefono', p.telefono) as inversionista
      FROM inversiones i
      JOIN perfiles p ON i.inversionista_id = p.id
      WHERE i.id = $1`,
      [inversionRes.id]
    );

    res.status(201).json({ success: true, data: inversion });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error creando inversión: " + error.message, 400);
  } finally {
    client.release();
  }
});

/**
 * Listar inversiones
 */
const obtenerInversiones = asyncHandler(async (req, res) => {
  const { inversionista_id } = req.query;
  
  let whereClause = "";
  let queryParams = [];
  
  if (inversionista_id) {
    whereClause = "WHERE i.inversionista_id = $1";
    queryParams.push(inversionista_id);
  }

  const { rows } = await db.query(`
    SELECT i.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email) as inversionista,
      (
        SELECT COALESCE(SUM(pf.monto_aportado - COALESCE(pf.capital_devuelto, 0)), 0)
        FROM prestamo_fondos pf
        JOIN prestamos pr ON pf.prestamo_id = pr.id
        WHERE pf.inversion_id = i.id AND pr.estado = 'activo'
      ) as monto_en_calle,
      (
        SELECT COALESCE(SUM(m.monto_capital), 0)
        FROM movimientos m
        WHERE m.inversion_id = i.id AND m.tipo = 'devolucion_inversion'
      ) as capital_devuelto,
      (
        SELECT COALESCE(SUM(m.monto_total), 0)
        FROM movimientos m
        WHERE m.inversion_id = i.id AND m.tipo = 'ganancia_interes'
      ) as interes_generado,
      (
        SELECT COALESCE(SUM(m.monto_interes), 0)
        FROM movimientos m
        WHERE m.inversion_id = i.id AND m.tipo = 'devolucion_inversion'
      ) as interes_pagado
    FROM inversiones i
    JOIN perfiles p ON i.inversionista_id = p.id
    ${whereClause}
    ORDER BY i.fecha_inversion DESC
  `, queryParams);

  const data = rows.map(inv => {
    const capitalPendiente = parseFloat(inv.monto_invertido) - parseFloat(inv.capital_devuelto);
    const saldoDisponible = capitalPendiente - parseFloat(inv.monto_en_calle);
    const interesDisponible = Math.max(0, parseFloat(inv.interes_generado) - parseFloat(inv.interes_pagado));
    return {
      ...inv,
      saldo_disponible: Math.max(0, saldoDisponible),
      interes_disponible: interesDisponible
    };
  });

  res.json({ success: true, data });
});

/**
 * Obtener detalle con Interés Sugerido y Alertas
 */
const obtenerInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { rows: [inversion] } = await db.query(`
    SELECT i.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email, 'telefono', p.telefono) as inversionista
    FROM inversiones i
    JOIN perfiles p ON i.inversionista_id = p.id
    WHERE i.id = $1`, [id]
  );

  if (!inversion) throw new AppError("Inversión no encontrada", 404);

  const { rows: movimientos } = await db.query(
    "SELECT * FROM movimientos WHERE inversion_id = $1 ORDER BY fecha_operacion DESC",
    [id]
  );

  // Cálculos de Capital y Interés Pagado
  const capitalPagado = movimientos.filter(m => m.tipo === 'devolucion_inversion').reduce((s, m) => s + parseFloat(m.monto_capital), 0);
  const interesPagado = movimientos.filter(m => m.tipo === 'devolucion_inversion').reduce((s, m) => s + parseFloat(m.monto_interes), 0);
  const capitalPendiente = parseFloat(inversion.monto_invertido) - capitalPagado;

  // --- Lógica de Interés (Específico a la Inversión) ---
  const interesesGenerados = movimientos.filter(m => m.tipo === 'ganancia_interes').reduce((s, m) => s + parseFloat(m.monto_interes || m.monto_total), 0);
  const interesDisponibleEspecifico = Math.max(0, interesesGenerados - interesPagado);

  const ultimoPagoInteres = movimientos.find(m => m.tipo === 'devolucion_inversion' && parseFloat(m.monto_interes) > 0);
  
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  
  // Obtener saldo de la billetera del inversionista para no sugerir más de lo que realmente tiene en total
  const { rows: [billetera] } = await db.query(
    "SELECT saldo_actual FROM cuentas WHERE tipo = 'billetera' AND perfil_id = $1",
    [inversion.inversionista_id]
  );
  const saldoBilletera = billetera ? parseFloat(billetera.saldo_actual) : 0;
  
  // Sugerimos el interés específico de esta inversión, pero limitado al saldo total disponible en su billetera
  const interesSugerido = Math.min(interesDisponibleEspecifico, saldoBilletera);

  // --- Alerta de Pago (Siempre el día 5 de cada mes) ---
  const diaPagoFijo = 5;
  const fechaInversion = new Date(inversion.fecha_inversion);
  fechaInversion.setUTCHours(0, 0, 0, 0);

  let mesPago, anioPago;

  if (ultimoPagoInteres) {
    // Ya ha pagado antes - el próximo es el mes siguiente al último pago
    const ultimoPagoMes = new Date(ultimoPagoInteres.fecha_operacion).getUTCMonth();
    const ultimoPagoAnio = new Date(ultimoPagoInteres.fecha_operacion).getUTCFullYear();
    mesPago = ultimoPagoMes + 1;
    anioPago = ultimoPagoAnio;
    if (mesPago > 11) {
      mesPago = 0;
      anioPago += 1;
    }
  } else {
    // Nunca ha pagado - primera fecha de pago: el 5 del mes SIGUIENTE a la inversión
    // Ej: Inversión mayo/junio -> Primer pago 5 de julio
    mesPago = fechaInversion.getUTCMonth() + 1;
    anioPago = fechaInversion.getUTCFullYear();
    if (mesPago > 11) {
      mesPago = 0;
      anioPago += 1;
    }
  }

  const proximoPago = new Date(Date.UTC(anioPago, mesPago, diaPagoFijo));
  const diasParaPago = Math.ceil((proximoPago - hoy) / (1000 * 60 * 60 * 24));

  // --- Obtener Préstamos Financiados ---
  const { rows: prestamos_financiados_raw } = await db.query(`
    SELECT 
      pf.monto_aportado,
      pf.capital_devuelto,
      p.id,
      p.monto_principal,
      p.fecha_vencimiento,
      p.estado,
      json_build_object('nombre_completo', cli.nombre_completo) as cliente
    FROM prestamo_fondos pf
    JOIN prestamos p ON pf.prestamo_id = p.id
    JOIN perfiles cli ON p.cliente_id = cli.id
    WHERE pf.inversion_id = $1
  `, [id]);

  // Enriquecer préstamos financiados con calculos básicos
  let montoEnCalle = 0;
  const prestamos_financiados = await Promise.all(prestamos_financiados_raw.map(async (pf) => {
    // Buscar movimientos (recaudos) de este préstamo para mostrar en el historial
    const { rows: movs } = await db.query(
      "SELECT monto_total, monto_capital, monto_interes, fecha_operacion, metodo_pago FROM movimientos WHERE prestamo_id = $1 AND tipo = 'pago_cliente' ORDER BY fecha_operacion DESC LIMIT 5",
      [pf.id]
    );

    const capitalDevuelto = parseFloat(pf.capital_devuelto || 0);
    const saldoCalleReal = pf.estado === 'activo' ? Math.max(0, parseFloat(pf.monto_aportado) - capitalDevuelto) : 0;

    montoEnCalle += saldoCalleReal;

    return {
      ...pf,
      movimientos: movs,
      calculos: {
        saldo_calle_proporcional: saldoCalleReal
      }
    };
  }));

  const disponibleEnCuenta = capitalPendiente - montoEnCalle;
  const retornoTotal = interesPagado; // O sumar los intereses proyectados

  res.json({
    success: true,
    data: {
      ...inversion,
      movimientos,
      prestamos_financiados,
      calculos: {
        capital_pendiente: capitalPendiente,
        interes_pagado: interesPagado,
        interes_sugerido: Math.max(0, Math.round(interesSugerido)),
        proxima_fecha_pago: proximoPago.toISOString(),
        dias_para_pago: diasParaPago,
        en_mora: diasParaPago < 0,
        monto_en_calle: montoEnCalle,
        disponible_en_cuenta: disponibleEnCuenta,
        retorno_total: retornoTotal
      }
    }
  });
});

/**
 * Registro de Pago con Validaciones (Errores 1 y 2)
 */
const registrarPagoInversionista = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { monto_total, monto_capital, monto_interes, cuenta_id, metodo_pago, notas } = req.body;

  if (!cuenta_id || !monto_total) throw new AppError("Datos incompletos", 400);

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Bloquear fila para evitar "Race Conditions" (Error 2 parcial)
    const { rows: [inversion] } = await client.query(
      "SELECT * FROM inversiones WHERE id = $1 FOR UPDATE", [id]
    );
    
    if (inversion.estado === 'finalizada') throw new AppError("Inversión ya cerrada", 400);

    // 2. Validar Sobre-pago de Capital (Error 1)
    const { rows: stats } = await client.query(
      "SELECT SUM(monto_capital) as total_cap FROM movimientos WHERE inversion_id = $1 AND tipo = 'devolucion_inversion'",
      [id]
    );
    const capitalYaDevuelto = parseFloat(stats[0].total_cap || 0);
    const capitalPendiente = parseFloat(inversion.monto_invertido) - capitalYaDevuelto;

    if (parseFloat(monto_capital || 0) > capitalPendiente) {
      throw new AppError(`No puedes pagar más capital del pendiente ($ ${capitalPendiente.toLocaleString()})`, 400);
    }

    // 3. Registrar Movimiento físico
    let rutaFinal = null;
    if (req.file) {
      rutaFinal = req.uploadSubFolder 
        ? path.join(req.uploadSubFolder, req.file.filename)
        : req.file.filename;
    }

    let movimiento = null;

    // 3.1 Movimiento de Capital (Descuenta de la Cuenta Real)
    if (parseFloat(monto_capital || 0) > 0) {
      const { rows: [movCap] } = await client.query(
        `INSERT INTO movimientos (
          perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, tipo, metodo_pago, fecha_operacion, notas, usuario_id, url_captura
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          inversion.inversionista_id, id, cuenta_id, monto_capital, 
          monto_capital, 0, 
          "devolucion_inversion", metodo_pago || "transferencia", 
          new Date().toISOString(), notas, req.user ? req.user.id : null, rutaFinal
        ]
      );
      movimiento = movCap; // Retornamos este como referencia principal

      // Actualizar saldo de la cuenta real (Bancolombia, etc)
      await client.query(
        "UPDATE cuentas SET saldo_actual = saldo_actual - $1 WHERE id = $2",
        [parseFloat(monto_capital), cuenta_id]
      );
    }

    // 3.2 Movimiento de Interés (Descuenta de la Billetera Virtual)
    if (parseFloat(monto_interes || 0) > 0) {
      const { rows: [billetera] } = await client.query(
        "SELECT id FROM cuentas WHERE tipo = 'billetera' AND perfil_id = $1",
        [inversion.inversionista_id]
      );

      if (billetera) {
        const { rows: [movInt] } = await client.query(
          `INSERT INTO movimientos (
            perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, 
            monto_interes, tipo, metodo_pago, fecha_operacion, notas, usuario_id, url_captura
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
          [
            inversion.inversionista_id, id, billetera.id, monto_interes, 
            0, monto_interes, 
            "devolucion_inversion", metodo_pago || "transferencia", 
            new Date().toISOString(), notas, req.user ? req.user.id : null, rutaFinal
          ]
        );
        if (!movimiento) movimiento = movInt;

        // Restar intereses de la Billetera Virtual
        await client.query(
          "UPDATE cuentas SET saldo_actual = saldo_actual - $1 WHERE id = $2",
          [parseFloat(monto_interes), billetera.id]
        );
      }
    }

    // 4. Finalizar si el capital llega a cero
    if ((capitalYaDevuelto + parseFloat(monto_capital || 0)) >= parseFloat(inversion.monto_invertido)) {
      await client.query("UPDATE inversiones SET estado = 'finalizada' WHERE id = $1", [id]);
    }

    await client.query("COMMIT");
    res.json({ success: true, data: movimiento });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError(error.message, error.statusCode || 500);
  } finally {
    client.release();
  }
});

const registrarInteresHistorico = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { monto, notas } = req.body;

  if (!monto || parseFloat(monto) <= 0) {
    throw new AppError("El monto debe ser mayor a 0", 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Validar inversión
    const { rows: [inversion] } = await client.query(
      "SELECT * FROM inversiones WHERE id = $1",
      [id]
    );

    if (!inversion) {
      throw new AppError("Inversión no encontrada", 404);
    }

    // 2. Obtener billetera del inversionista
    const { rows: [billetera] } = await client.query(
      "SELECT id FROM cuentas WHERE tipo = 'billetera' AND perfil_id = $1",
      [inversion.inversionista_id]
    );

    if (!billetera) {
      throw new AppError("El inversionista no tiene billetera virtual configurada", 400);
    }

    // 3. Crear movimiento de ganancia_interes
    const { rows: [movimiento] } = await client.query(
      `INSERT INTO movimientos (
        perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, 
        monto_interes, tipo, fecha_operacion, notas, usuario_id
      ) VALUES ($1, $2, $3, $4, 0, $5, 'ganancia_interes', $6, $7, $8) RETURNING *`,
      [
        inversion.inversionista_id, 
        id, 
        billetera.id, 
        parseFloat(monto), 
        parseFloat(monto), 
        new Date().toISOString(), 
        notas || 'Registro de interés histórico/manual', 
        req.user ? req.user.id : null
      ]
    );

    // 4. Sumar saldo a la billetera virtual
    await client.query(
      "UPDATE cuentas SET saldo_actual = saldo_actual + $1 WHERE id = $2",
      [parseFloat(monto), billetera.id]
    );

    await client.query("COMMIT");
    res.json({ success: true, data: movimiento });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError(error.message, error.statusCode || 500);
  } finally {
    client.release();
  }
});

const actualizarInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tasa_interes_pactada, notas, estado } = req.body;
  const { rows: [inv] } = await db.query(
    "UPDATE inversiones SET tasa_interes_pactada = COALESCE($1, tasa_interes_pactada), notas = COALESCE($2, notas), estado = COALESCE($3, estado) WHERE id = $4 RETURNING *",
    [tasa_interes_pactada, notas, estado, id]
  );
  res.json({ success: true, data: inv });
});

const eliminarInversion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await db.query("DELETE FROM inversiones WHERE id = $1", [id]);
  res.json({ success: true, message: "Eliminada" });
});

/**
 * Obtener detalle público del inversionista por cédula
 * GET /api/inversiones/publico/cedula/:cedula
 */
const obtenerInversionistaPorCedulaPublico = asyncHandler(async (req, res) => {
  const { cedula } = req.params;

  if (!cedula) {
    throw new AppError("La cédula es requerida", 400);
  }

  // 1. Verificar si el inversionista existe
  const { rows: perfiles } = await db.query(
    "SELECT id, nombre_completo, telefono FROM perfiles WHERE identificacion = $1 AND rol = 'inversionista'",
    [cedula]
  );

  if (perfiles.length === 0) {
    throw new AppError("No se encontró ningún inversionista con esta cédula", 404);
  }

  const inversionista = perfiles[0];

  // 2. Obtener lista de inversiones activas
  const { rows: inversiones } = await db.query(
    "SELECT id, monto_invertido, tasa_interes_pactada, estado, fecha_inversion FROM inversiones WHERE inversionista_id = $1 ORDER BY fecha_inversion DESC",
    [inversionista.id]
  );

  // 3. Obtener movimientos de este inversionista
  const { rows: movimientos } = await db.query(
    "SELECT inversion_id, monto_capital, monto_interes FROM movimientos WHERE perfil_id = $1 AND tipo = 'devolucion_inversion'",
    [inversionista.id]
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

  const resumen = {
    inversion_inicial: Math.round(inv_inicial),
    capital_devuelto: Math.round(cap_dev),
    intereses_pagados: Math.round(int_pag),
    capital_todavia_adeudado: Math.round(cap_adeud),
    intereses_acumulados_estimados: Math.round(int_est),
    tasa_promedio: parseFloat(tasa_promedio.toFixed(2))
  };

  // 4. Obtener últimos pagos para el historial
  const { rows: ultimos_pagos } = await db.query(
    `SELECT id, fecha_operacion, monto_total, metodo_pago 
     FROM movimientos 
     WHERE perfil_id = $1 AND tipo = 'devolucion_inversion' 
     ORDER BY fecha_operacion DESC 
     LIMIT 10`,
    [inversionista.id]
  );

  res.json({
    success: true,
    data: {
      perfil: inversionista,
      resumen,
      inversiones: inversiones.map(inv => ({
        ...inv,
        monto_invertido: Math.round(inv.monto_invertido)
      })),
      ultimos_pagos: ultimos_pagos.map(pago => ({
        ...pago,
        monto_total: Math.round(pago.monto_total)
      }))
    }
  });
});

module.exports = {
  crearInversion,
  obtenerInversiones,
  obtenerInversion,
  actualizarInversion,
  registrarPagoInversionista,
  eliminarInversion,
  obtenerInversionistaPorCedulaPublico,
  prepararCarpetaInversion,
  registrarInteresHistorico
};
