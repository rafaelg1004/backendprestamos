const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const {
  calcularMesesTranscurridos,
} = require("../utils/calculos");

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
      `INSERT INTO movimientos (perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, monto_interes, tipo, fecha_operacion) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [inversionista_id, inversionRes.id, cuenta_id, monto_invertido, monto_invertido, 0, "recibo_inversion", new Date().toISOString()]
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
  const { rows } = await db.query(`
    SELECT i.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email) as inversionista
    FROM inversiones i
    JOIN perfiles p ON i.inversionista_id = p.id
    ORDER BY i.fecha_inversion DESC
  `);
  res.json({ success: true, data: rows });
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

  // --- Lógica de Interés Sugerido (Nueva Función 2) ---
  const ultimoPagoInteres = movimientos.find(m => m.tipo === 'devolucion_inversion' && parseFloat(m.monto_interes) > 0);
  const fechaReferencia = ultimoPagoInteres ? new Date(ultimoPagoInteres.fecha_operacion) : new Date(inversion.fecha_inversion);
  
  const hoy = new Date();
  const diffTiempo = Math.abs(hoy - fechaReferencia);
  const diasTranscurridos = Math.floor(diffTiempo / (1000 * 60 * 60 * 24));
  
  // Interés diario sugerido sobre el capital pendiente
  const tasaMensual = inversion.tasa_interes_pactada / 100;
  const tasaDiaria = tasaMensual / 30;
  const interesSugerido = capitalPendiente * tasaDiaria * diasTranscurridos;

  // --- Alerta de Pago (Nueva Función 3) ---
  const proximoPago = new Date(fechaReferencia);
  proximoPago.setMonth(proximoPago.getMonth() + 1);
  const diasParaPago = Math.ceil((proximoPago - hoy) / (1000 * 60 * 60 * 24));

  res.json({
    success: true,
    data: {
      ...inversion,
      movimientos,
      calculos: {
        capital_pendiente: capitalPendiente,
        interes_pagado: interesPagado,
        interes_sugerido: Math.max(0, Math.round(interesSugerido)),
        proxima_fecha_pago: proximoPago.toISOString(),
        dias_para_pago: diasParaPago,
        en_mora: diasParaPago < 0
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

    // 3. Registrar Movimiento
    const { rows: [movimiento] } = await client.query(
      `INSERT INTO movimientos (
        perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, 
        monto_interes, tipo, metodo_pago, fecha_operacion, notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        inversion.inversionista_id, id, cuenta_id, monto_total, 
        monto_capital || 0, monto_interes || 0, 
        "devolucion_inversion", metodo_pago || "transferencia", 
        new Date().toISOString(), notas
      ]
    );

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

module.exports = {
  crearInversion,
  obtenerInversiones,
  obtenerInversion,
  actualizarInversion,
  registrarPagoInversionista,
  eliminarInversion,
};
