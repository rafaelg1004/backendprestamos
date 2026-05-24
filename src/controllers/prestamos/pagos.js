const db = require("../../config/db");
const { asyncHandler, AppError } = require("../../middleware/errorHandler");
const {
  calcularDiasMora,
  calcularMesesTranscurridos,
  calcularDesglosePago
} = require("../../utils/calculos");

const calcularLiquidacion = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    rows: [prestamo],
  } = await db.query("SELECT * FROM prestamos WHERE id = $1", [id]);

  if (!prestamo) {
    throw new AppError("Préstamo no encontrado", 404, "NOT_FOUND");
  }

  const { rows: cuotasPagadas } = await db.query(
    "SELECT COALESCE(SUM(capital), 0) as capital_pagado FROM cuotas WHERE prestamo_id = $1 AND estado = 'pagado'",
    [id]
  );
  
  const capitalPagado = parseFloat(cuotasPagadas[0]?.capital_pagado || 0);
  const capitalPendiente = parseFloat(prestamo.monto_principal) - capitalPagado;

  const diasMora = calcularDiasMora(prestamo.fecha_vencimiento);
  const mesesTranscurridos = calcularMesesTranscurridos(prestamo.fecha_inicio);
  
  const desglose = calcularDesglosePago({
    montoPrincipal: prestamo.monto_principal,
    tasaInteresMensual: prestamo.tasa_interes_mensual,
    mesesTranscurridos,
    tasaMoraDiaria: prestamo.tasa_mora_diaria,
    diasMora,
  });

  res.json({
    success: true,
    data: {
      capital_pendiente: capitalPendiente,
      ...desglose
    }
  });
});

const pagarPrestamo = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { cuenta_id, metodo_pago, referencia_pago, notas } = req.body;

  if (!cuenta_id) {
    throw new AppError("Debes seleccionar una cuenta para recibir el pago", 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE prestamos SET estado = 'pagado' WHERE id = $1",
      [id]
    );

    res.json({
      success: true,
      message: "Préstamo pagado (Liquidado) exitosamente",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error procesando liquidación: " + error.message, 500);
  } finally {
    client.release();
  }
});

const registrarPagoLibre = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { 
    cuenta_id, 
    cuenta_intereses_id, 
    metodo_pago, 
    referencia_pago, 
    notas, 
    monto_capital,
    monto_interes,
    distribucion_capital, 
    distribucion_intereses 
  } = req.body;

  if (!cuenta_id) {
    throw new AppError("Debes seleccionar una cuenta para recibir el pago", 400);
  }

  const { rows: [prestamo] } = await db.query(
    "SELECT * FROM prestamos WHERE id = $1", 
    [id]
  );

  if (!prestamo) {
    throw new AppError("Préstamo no encontrado", 404);
  }

  if (prestamo.estado === 'pagado') {
    throw new AppError("Este préstamo ya está pagado en su totalidad", 400);
  }

  const capitalAPagar = parseFloat(monto_capital) || 0;
  const interesAPagar = parseFloat(monto_interes) || 0;
  const totalPago = capitalAPagar + interesAPagar;

  if (totalPago <= 0) {
    throw new AppError("El monto del pago debe ser mayor a 0", 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // Calcular el interés actual generado hasta hoy para ver cuánto resta
    const { calcularDiasTranscurridos, calcularInteresRotativo } = require("../../utils/calculos");
    const diasTranscurridos = calcularDiasTranscurridos(prestamo.fecha_ultimo_corte || prestamo.fecha_inicio);
    const interesGeneradoPeriodo = calcularInteresRotativo(prestamo.saldo_capital, prestamo.tasa_interes_mensual, diasTranscurridos);
    const interesTotalDeuda = parseFloat(prestamo.interes_acumulado || 0) + interesGeneradoPeriodo;

    let nuevoInteresAcumulado = interesTotalDeuda - interesAPagar;
    if (nuevoInteresAcumulado < 0) nuevoInteresAcumulado = 0;

    let nuevoSaldoCapital = parseFloat(prestamo.saldo_capital) - capitalAPagar;
    if (nuevoSaldoCapital < 0) nuevoSaldoCapital = 0;

    // Actualizamos el préstamo
    await client.query(
      `UPDATE prestamos 
       SET saldo_capital = $1, 
           interes_acumulado = $2, 
           fecha_ultimo_corte = $3,
           estado = $4
       WHERE id = $5`,
      [
        nuevoSaldoCapital, 
        nuevoInteresAcumulado, 
        new Date().toISOString().split('T')[0], // Corta los intereses a hoy
        (nuevoSaldoCapital <= 0 && nuevoInteresAcumulado <= 0) ? 'pagado' : 'activo',
        id
      ]
    );

    // Registrar movimientos
    const cuentaCapital = cuenta_id;

    if (capitalAPagar > 0) {
      await client.query(
        `INSERT INTO movimientos (
          perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, tipo, metodo_pago, referencia_pago, notas, fecha_operacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          prestamo.cliente_id, prestamo.id, cuentaCapital, capitalAPagar, capitalAPagar, 0,
          'pago_cliente', metodo_pago, referencia_pago, (notas || 'Abono a capital'), new Date().toISOString()
        ]
      );
    }
    
    if (interesAPagar > 0) {
      await client.query(
        `INSERT INTO movimientos (
          perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, tipo, metodo_pago, referencia_pago, notas, fecha_operacion
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          prestamo.cliente_id, prestamo.id, null, interesAPagar, 0, interesAPagar,
          'pago_cliente', metodo_pago, referencia_pago, (notas || 'Abono a intereses (Billeteras virtuales)'), new Date().toISOString()
        ]
      );
    }

    if (distribucion_capital && Array.isArray(distribucion_capital)) {
      for (const dist of distribucion_capital) {
        if (parseFloat(dist.monto) > 0) {
          await client.query(
            "UPDATE prestamo_fondos SET capital_devuelto = COALESCE(capital_devuelto, 0) + $1 WHERE prestamo_id = $2 AND inversion_id = $3",
            [parseFloat(dist.monto), prestamo.id, dist.inversion_id]
          );
        }
      }
    }

    if (distribucion_intereses && Array.isArray(distribucion_intereses)) {
      let sumaInteresesDistribuidos = 0;
      for (const dist of distribucion_intereses) {
        const montoDist = parseFloat(dist.monto);
        if (montoDist > 0) {
          sumaInteresesDistribuidos += montoDist;
          
          await client.query(
            "UPDATE prestamo_fondos SET interes_devuelto = COALESCE(interes_devuelto, 0) + $1 WHERE prestamo_id = $2 AND inversion_id = $3",
            [montoDist, prestamo.id, dist.inversion_id]
          );

          // Sumar al saldo de la billetera ficticia del inversionista
          const { rows: invRows } = await client.query(
            "SELECT inversionista_id FROM inversiones WHERE id = $1",
            [dist.inversion_id]
          );
          if (invRows.length > 0) {
            await client.query(
              "UPDATE cuentas SET saldo_actual = saldo_actual + $1 WHERE perfil_id = $2 AND tipo = 'billetera'",
              [montoDist, invRows[0].inversionista_id]
            );
          }
        }
      }

      // Ganancia residual (remnant) para Yesika
      const gananciaAdmin = interesAPagar - sumaInteresesDistribuidos;
      if (gananciaAdmin > 0) {
        // Encontrar a YESIKA CALDERÓN CANO o YESIKA (principal investor)
        const { rows: yesikaRows } = await client.query(
          "SELECT id FROM perfiles WHERE nombre_completo ILIKE '%YESIKA%' AND rol IN ('inversionista', 'admin') LIMIT 1"
        );
        if (yesikaRows.length > 0) {
          await client.query(
            "UPDATE cuentas SET saldo_actual = saldo_actual + $1 WHERE perfil_id = $2 AND tipo = 'billetera'",
            [gananciaAdmin, yesikaRows[0].id]
          );
        } else {
          // Fallback a admin generico si no encuentra a Yesika (poco probable)
          await client.query(
            "UPDATE cuentas SET saldo_actual = saldo_actual + $1 WHERE tipo = 'billetera' AND nombre ILIKE '%Admin%'",
            [gananciaAdmin]
          );
        }
      }
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Pago registrado exitosamente. Nuevo saldo: $${(nuevoSaldoCapital / 1000).toFixed(0)}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError("Error procesando pago: " + error.message, 500);
  } finally {
    client.release();
  }
});

module.exports = {
  calcularLiquidacion,
  pagarPrestamo,
  registrarPagoLibre
};
