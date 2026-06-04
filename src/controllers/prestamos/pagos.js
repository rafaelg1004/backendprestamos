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
    console.error("Error en pagarPrestamo:", error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Error procesando liquidación", error.statusCode || 500, error.code);
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
    distribucion_intereses,
    condonar_intereses
  } = req.body;

  let parsedDistribucionCapital = typeof distribucion_capital === 'string' ? JSON.parse(distribucion_capital) : distribucion_capital;
  let parsedDistribucionIntereses = typeof distribucion_intereses === 'string' ? JSON.parse(distribucion_intereses) : distribucion_intereses;
  
  // Opcional: boolean string a boolean
  const isCondonar = String(condonar_intereses) === 'true';

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

  const capitalAPagar = Math.round(parseFloat(monto_capital) || 0);
  const interesAPagar = Math.round(parseFloat(monto_interes) || 0);
  const totalPago = capitalAPagar + interesAPagar;

  if (totalPago <= 0) {
    throw new AppError("El monto del pago debe ser mayor a 0", 400);
  }

  if (capitalAPagar > 0 && !cuenta_id) {
    throw new AppError("Debes seleccionar una cuenta para recibir el pago a capital", 400);
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // Calcular el interés actual generado hasta hoy para ver cuánto resta
    const { calcularDiasTranscurridos, calcularInteresRotativo } = require("../../utils/calculos");
    const diasTranscurridos = calcularDiasTranscurridos(prestamo.fecha_ultimo_corte || prestamo.fecha_inicio);
    const interesGeneradoPeriodo = calcularInteresRotativo(prestamo.saldo_capital, prestamo.tasa_interes_mensual, diasTranscurridos);
    const interesTotalDeuda = Math.round(parseFloat(prestamo.interes_acumulado || 0) + interesGeneradoPeriodo);

    let nuevoInteresAcumulado = interesTotalDeuda - interesAPagar;
    if (isCondonar) {
      nuevoInteresAcumulado = 0;
    } else if (nuevoInteresAcumulado < 0) {
      nuevoInteresAcumulado = 0;
    }
    nuevoInteresAcumulado = Math.round(nuevoInteresAcumulado);

    let nuevoSaldoCapital = Math.round(parseFloat(prestamo.saldo_capital) - capitalAPagar);
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
    
    let rutaFinal = null;
    const path = require('path');
    if (req.file) {
      rutaFinal = req.uploadSubFolder 
        ? path.join(req.uploadSubFolder, req.file.filename)
        : req.file.filename;
    }

    if (capitalAPagar > 0) {
      await client.query(
        `INSERT INTO movimientos (
          perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, tipo, metodo_pago, referencia_pago, notas, fecha_operacion, usuario_id, url_captura
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          prestamo.cliente_id, prestamo.id, cuentaCapital, capitalAPagar, capitalAPagar, 0,
          'pago_cliente', metodo_pago || 'efectivo', referencia_pago || null, (notas || 'Abono a capital'), new Date().toISOString(),
          req.user ? req.user.id : null, rutaFinal
        ]
      );
    }
    
    if (interesAPagar > 0) {
      await client.query(
        `INSERT INTO movimientos (
          perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
          monto_interes, tipo, metodo_pago, referencia_pago, notas, fecha_operacion, usuario_id, url_captura
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          prestamo.cliente_id, prestamo.id, null, interesAPagar, 0, interesAPagar,
          'pago_cliente', metodo_pago || 'efectivo', referencia_pago || null, (notas || 'Abono a intereses (Billeteras virtuales)'), new Date().toISOString(),
          req.user ? req.user.id : null, rutaFinal
        ]
      );
    }

      if (parsedDistribucionCapital && parsedDistribucionCapital.length > 0) {
        for (const dist of parsedDistribucionCapital) {
        const montoDistCap = Math.round(parseFloat(dist.monto));
        if (montoDistCap > 0) {
          await client.query(
            "UPDATE prestamo_fondos SET capital_devuelto = COALESCE(capital_devuelto, 0) + $1 WHERE prestamo_id = $2 AND inversion_id = $3",
            [montoDistCap, prestamo.id, dist.inversion_id || null]
          );
        }
      }
    }

    if (interesAPagar > 0 && parsedDistribucionIntereses && parsedDistribucionIntereses.length > 0) {
      let sumaInteresesDistribuidos = 0;
      for (const dist of parsedDistribucionIntereses) {
        const montoDist = Math.round(parseFloat(dist.monto));
        if (montoDist > 0) {
          sumaInteresesDistribuidos += montoDist;
          
          await client.query(
            "UPDATE prestamo_fondos SET interes_devuelto = COALESCE(interes_devuelto, 0) + $1 WHERE prestamo_id = $2 AND inversion_id = $3",
            [montoDist, prestamo.id, dist.inversion_id || null]
          );

          // Sumar al saldo de la billetera ficticia del inversionista
          const { rows: invRows } = await client.query(
            "SELECT inversionista_id FROM inversiones WHERE id = $1",
            [dist.inversion_id || null]
          );
          if (invRows.length > 0) {
            const { rows: cuentaInv } = await client.query(
              "UPDATE cuentas SET saldo_actual = saldo_actual + $1 WHERE perfil_id = $2 AND tipo = 'billetera' RETURNING id",
              [montoDist, invRows[0].inversionista_id]
            );
            
            if (cuentaInv.length > 0) {
              await client.query(
                `INSERT INTO movimientos (
                  perfil_id, prestamo_id, inversion_id, cuenta_id, monto_total, monto_capital, 
                  monto_interes, tipo, metodo_pago, notas, fecha_operacion, usuario_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                  invRows[0].inversionista_id, prestamo.id, dist.inversion_id || null, cuentaInv[0].id, montoDist, 0,
                  montoDist, 'ganancia_interes', null, 'Ganancia por intereses de inversión', new Date().toISOString(),
                  req.user ? req.user.id : null
                ]
              );
            }
          }
        }
      }

      // Ganancia residual (remnant) para la Billetera del Admin
      const gananciaAdmin = Math.round(interesAPagar - sumaInteresesDistribuidos);
      if (gananciaAdmin > 0) {
        // Enviar a la Billetera de Ganancias Admin
        const { rows: adminCuenta } = await client.query(
          "UPDATE cuentas SET saldo_actual = saldo_actual + $1 WHERE tipo = 'billetera' AND nombre ILIKE '%Admin%' RETURNING id, perfil_id",
          [gananciaAdmin]
        );
        
        if (adminCuenta.length > 0) {
          await client.query(
            `INSERT INTO movimientos (
              perfil_id, prestamo_id, cuenta_id, monto_total, monto_capital, 
              monto_interes, tipo, metodo_pago, notas, fecha_operacion, usuario_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              adminCuenta[0].perfil_id, prestamo.id, adminCuenta[0].id, gananciaAdmin, 0,
              gananciaAdmin, 'ganancia_interes', null, 'Spread administrativo', new Date().toISOString(),
              req.user ? req.user.id : null
            ]
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
    console.error("Error en registrarPagoLibre:", error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || "Error procesando pago", error.statusCode || 500, error.code);
  } finally {
    client.release();
  }
});

module.exports = {
  calcularLiquidacion,
  pagarPrestamo,
  registrarPagoLibre
};
