const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");
const {
  calcularDiasMora,
  calcularMesesTranscurridos,
  calcularDesglosePago,
} = require("../utils/calculos");

/**
 * Obtener resumen general del dashboard
 * Usa la vista SQL vista_balance_general cuando está disponible
 * GET /api/dashboard/resumen
 */
const obtenerResumen = asyncHandler(async (req, res) => {
  // Intentar usar la vista de balance general primero
  try {
    const {
      rows: [balanceVista],
    } = await db.query("SELECT * FROM vista_balance_general LIMIT 1");

    if (balanceVista) {
      // Obtener estadísticas de perfiles
      const { rows: perfilesStats } = await db.query(
        "SELECT rol FROM perfiles",
      );
      const totalClientes = perfilesStats.filter(
        (p) => p.rol === "cliente",
      ).length;
      const totalInversionistas = perfilesStats.filter(
        (p) => p.rol === "inversionista",
      ).length;

      // Obtener estadísticas de préstamos e inversiones
      const { rows: prestamosStats } = await db.query(
        "SELECT estado FROM prestamos",
      );
      const { rows: inversionesStats } = await db.query(
        "SELECT estado FROM inversiones",
      );

      // Flujo de caja 30 días
      const hace30Dias = new Date();
      hace30Dias.setDate(hace30Dias.getDate() - 30);
      const { rows: movimientosRecientes } = await db.query(
        "SELECT tipo, monto_total FROM movimientos WHERE fecha_operacion >= $1",
        [hace30Dias.toISOString()],
      );

      let entradas30Dias = 0;
      let salidas30Dias = 0;
      movimientosRecientes.forEach((m) => {
        if (m.tipo === "recibo_inversion" || m.tipo === "pago_cliente") {
          entradas30Dias += parseFloat(m.monto_total);
        } else {
          salidas30Dias += parseFloat(m.monto_total);
        }
      });

      const resumen = {
        perfiles: {
          total_clientes: totalClientes,
          total_inversionistas: totalInversionistas,
          total: totalClientes + totalInversionistas,
        },
        prestamos: {
          total: prestamosStats.length,
          activos: prestamosStats.filter((p) => p.estado === "activo").length,
          pagados: prestamosStats.filter((p) => p.estado === "pagado").length,
          en_mora: parseInt(balanceVista.prestamos_en_mora) || 0,
          monto_total_prestado: Math.round(
            parseFloat(balanceVista.total_capital_en_la_calle) * 1000,
          ),
          monto_activos: Math.round(
            parseFloat(balanceVista.total_capital_en_la_calle) * 1000,
          ),
          mora_potencial: Math.round(
            parseFloat(balanceVista.monto_total_en_mora) * 1000,
          ),
          saldo_recaudar: Math.round(
            (parseFloat(balanceVista.total_capital_en_la_calle) +
              parseFloat(balanceVista.monto_total_en_mora)) *
              1000,
          ),
        },
        inversiones: {
          total: inversionesStats.length,
          activas: inversionesStats.filter((i) => i.estado === "activo").length,
          finalizadas: inversionesStats.filter((i) => i.estado === "finalizada")
            .length,
          monto_total_invertido: Math.round(
            (parseFloat(balanceVista.total_deuda_con_inversionistas) || 0) *
              1000,
          ),
          monto_activas: Math.round(
            (parseFloat(balanceVista.total_deuda_con_inversionistas) || 0) *
              1000,
          ),
          intereses_a_pagar: Math.round(
            (parseFloat(balanceVista.intereses_pagados_inversionistas) || 0) *
              1000,
          ),
          obligacion_total: Math.round(
            (parseFloat(balanceVista.total_deuda_con_inversionistas) +
              parseFloat(balanceVista.intereses_pagados_inversionistas) || 0) *
              1000,
          ),
        },
        finanzas: {
          intereses_ganados_clientes: Math.round(
            (parseFloat(balanceVista.intereses_ganados_clientes) || 0) * 1000,
          ),
          intereses_pagados_inversionistas: Math.round(
            (parseFloat(balanceVista.intereses_pagados_inversionistas) || 0) *
              1000,
          ),
          utilidad_neta_intereses: Math.round(
            (parseFloat(balanceVista.utilidad_neta_intereses) || 0) * 1000,
          ),
          transacciones_con_soporte:
            parseInt(balanceVista.transacciones_con_soporte) || 0,
          total_movimientos: parseInt(balanceVista.total_movimientos) || 0,
        },
        flujo_caja_30dias: {
          entradas: entradas30Dias,
          salidas: salidas30Dias,
          neto: entradas30Dias - salidas30Dias,
        },
        balance_general: {
          activos: Math.round(
            (parseFloat(balanceVista.total_capital_en_la_calle) +
              parseFloat(balanceVista.intereses_ganados_clientes)) *
              1000,
          ),
          pasivos: Math.round(
            (parseFloat(balanceVista.total_deuda_con_inversionistas) +
              parseFloat(balanceVista.intereses_pagados_inversionistas)) *
              1000,
          ),
          patrimonio_neto: Math.round(
            (parseFloat(balanceVista.total_capital_en_la_calle) +
              parseFloat(balanceVista.utilidad_neta_intereses) -
              parseFloat(balanceVista.total_deuda_con_inversionistas)) *
              1000,
          ),
        },
        _meta: {
          fuente: "vista_balance_general",
          fecha_actualizacion: balanceVista.fecha_actualizacion,
        },
      };

      return res.json({ success: true, data: resumen });
    }
  } catch (err) {
    // Continuar al fallback si hay error o la vista no existe
    console.log("Error consultando vista, usando cálculo manual:", err.message);
  }

  // Fallback: Calcular manualmente
  const { rows: perfilesStats } = await db.query("SELECT rol FROM perfiles");
  const totalClientes = perfilesStats.filter((p) => p.rol === "cliente").length;
  const totalInversionistas = perfilesStats.filter(
    (p) => p.rol === "inversionista",
  ).length;

  const { rows: prestamos } = await db.query(
    "SELECT estado, monto_principal, tasa_interes_mensual, tasa_mora_diaria, fecha_vencimiento, fecha_inicio FROM prestamos",
  );
  const prestamosActivos = prestamos.filter((p) => p.estado === "activo");
  const prestamosPagados = prestamos.filter((p) => p.estado === "pagado");
  const prestamosEnMora = prestamosActivos.filter(
    (p) => calcularDiasMora(p.fecha_vencimiento) > 0,
  );

  const montoTotalPrestado = prestamos.reduce(
    (sum, p) => sum + parseFloat(p.monto_principal),
    0,
  );
  const montoPrestamosActivos = prestamosActivos.reduce(
    (sum, p) => sum + parseFloat(p.monto_principal),
    0,
  );

  let interesesPotenciales = 0;
  let moraPotencial = 0;
  prestamosActivos.forEach((p) => {
    const meses = calcularMesesTranscurridos(p.fecha_inicio);
    const diasMora = calcularDiasMora(p.fecha_vencimiento);
    const desglose = calcularDesglosePago({
      montoPrincipal: parseFloat(p.monto_principal),
      tasaInteresMensual: p.tasa_interes_mensual,
      mesesTranscurridos: meses,
      tasaMoraDiaria: p.tasa_mora_diaria,
      diasMora,
    });
    interesesPotenciales += desglose.interes;
    moraPotencial += desglose.mora;
  });

  const { rows: inversiones } = await db.query(
    "SELECT estado, monto_invertido, tasa_interes_pactada, fecha_inversion FROM inversiones",
  );
  const inversionesActivas = inversiones.filter((i) => i.estado === "activo");
  const inversionesFinalizadas = inversiones.filter(
    (i) => i.estado === "finalizada",
  );

  const montoTotalInvertido = inversiones.reduce(
    (sum, i) => sum + parseFloat(i.monto_invertido),
    0,
  );
  const montoInversionesActivas = inversionesActivas.reduce(
    (sum, i) => sum + parseFloat(i.monto_invertido),
    0,
  );

  let interesesInversionistas = 0;
  inversionesActivas.forEach((inv) => {
    const meses = calcularMesesTranscurridos(inv.fecha_inversion);
    interesesInversionistas +=
      parseFloat(inv.monto_invertido) *
      (inv.tasa_interes_pactada / 100) *
      meses;
  });

  const hace30Dias = new Date();
  hace30Dias.setDate(hace30Dias.getDate() - 30);
  const { rows: movimientosRecientes } = await db.query(
    "SELECT tipo, monto_total FROM movimientos WHERE fecha_operacion >= $1",
    [hace30Dias.toISOString()],
  );

  let entradas30Dias = 0;
  let salidas30Dias = 0;
  movimientosRecientes.forEach((m) => {
    if (m.tipo === "recibo_inversion" || m.tipo === "pago_cliente") {
      entradas30Dias += parseFloat(m.monto_total);
    } else {
      salidas30Dias += parseFloat(m.monto_total);
    }
  });

  const resumen = {
    perfiles: {
      total_clientes: totalClientes,
      total_inversionistas: totalInversionistas,
      total: totalClientes + totalInversionistas,
    },
    prestamos: {
      total: prestamos.length,
      activos: prestamosActivos.length,
      pagados: prestamosPagados.length,
      en_mora: prestamosEnMora.length,
      monto_total_prestado: montoTotalPrestado,
      monto_activos: montoPrestamosActivos,
      intereses_potenciales: Math.round(interesesPotenciales),
      mora_potencial: Math.round(moraPotencial),
      saldo_recaudar: Math.round(
        montoPrestamosActivos + interesesPotenciales + moraPotencial,
      ),
    },
    inversiones: {
      total: inversiones.length,
      activas: inversionesActivas.length,
      finalizadas: inversionesFinalizadas.length,
      monto_total_invertido: montoTotalInvertido,
      monto_activos: montoInversionesActivas,
      intereses_a_pagar: Math.round(interesesInversionistas),
      obligacion_total: Math.round(
        montoInversionesActivas + interesesInversionistas,
      ),
    },
    flujo_caja_30dias: {
      entradas: entradas30Dias,
      salidas: salidas30Dias,
      neto: entradas30Dias - salidas30Dias,
    },
    balance_general: {
      activos: montoPrestamosActivos + interesesPotenciales,
      pasivos: montoInversionesActivas + interesesInversionistas,
      patrimonio_neto:
        montoPrestamosActivos +
        interesesPotenciales -
        (montoInversionesActivas + interesesInversionistas),
    },
    _meta: { fuente: "calculo_manual" },
  };

  res.json({
    success: true,
    data: resumen,
  });
});

/**
 * Obtener préstamos próximos a vencer (próximos 7 días)
 * Usa la vista SQL vista_alertas_vencimientos cuando está disponible
 * GET /api/dashboard/alertas/vencimientos
 */
const obtenerAlertasVencimientos = asyncHandler(async (req, res) => {
  // Intentar usar la vista primero
  try {
    const { rows: alertasVista } = await db.query(
      "SELECT * FROM vista_alertas_vencimientos ORDER BY dias_restantes ASC",
    );

    if (alertasVista && alertasVista.length > 0) {
      const alertas = alertasVista.map((a) => ({
        ...a,
        capital_prestado: Math.round(parseFloat(a.capital_prestado) * 1000),
        capital_pagado: Math.round(parseFloat(a.capital_pagado) * 1000),
        saldo_pendiente: Math.round(parseFloat(a.saldo_pendiente) * 1000),
        _vista: true,
      }));

      return res.json({
        success: true,
        data: alertas,
        total: alertas.length,
        _meta: { fuente: "vista_alertas_vencimientos" },
      });
    }
  } catch (err) {
    console.log(
      "Error consultando vista alertas, usando cálculo manual:",
      err.message,
    );
  }

  // Fallback: Calcular manualmente
  const hoy = new Date();
  const en7Dias = new Date();
  en7Dias.setDate(hoy.getDate() + 7);

  const hoyStr = hoy.toISOString().split("T")[0];
  const en7DiasStr = en7Dias.toISOString().split("T")[0];

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
    WHERE p.estado = 'activo' AND (p.fecha_vencimiento <= $1 OR p.fecha_vencimiento <= $2)
    ORDER BY p.fecha_vencimiento ASC`,
    [en7DiasStr, hoyStr],
  );

  const alertas = prestamos?.map((p) => ({
    ...p,
    dias_restantes: Math.ceil(
      (new Date(p.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24),
    ),
    nivel_alerta:
      Math.ceil(
        (new Date(p.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24),
      ) <= 0
        ? "vencido"
        : Math.ceil(
              (new Date(p.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24),
            ) <= 3
          ? "critico"
          : "proximo",
  }));

  res.json({
    success: true,
    data: alertas || [],
    total: alertas?.length || 0,
    _meta: { fuente: "calculo_manual" },
  });
});

/**
 * Obtener movimientos recientes
 * Usa la vista SQL vista_movimientos_detalle cuando está disponible
 * GET /api/dashboard/movimientos/recientes
 */
const obtenerMovimientosRecientes = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;

  // Intentar usar la vista primero
  try {
    const { rows: movimientosVista } = await db.query(
      "SELECT * FROM vista_movimientos_detalle LIMIT $1",
      [parseInt(limit)],
    );

    if (movimientosVista && movimientosVista.length > 0) {
      const movimientos = movimientosVista.map((m) => ({
        ...m,
        monto_total: Math.round(parseFloat(m.monto_total) * 1000),
        monto_capital: Math.round(parseFloat(m.monto_capital) * 1000),
        monto_interes: Math.round(parseFloat(m.monto_interes) * 1000),
        monto_mora: Math.round(parseFloat(m.monto_mora) * 1000),
      }));

      return res.json({
        success: true,
        data: movimientos,
        _meta: { fuente: "vista_movimientos_detalle" },
      });
    }
  } catch (err) {
    console.log(
      "Error consultando vista movimientos, usando cálculo manual:",
      err.message,
    );
  }

  // Fallback: Consulta manual
  const { rows: movimientos } = await db.query(
    `SELECT m.*, 
      json_build_object('id', p.id, 'nombre_completo', p.nombre_completo, 'email', p.email) as perfil,
      json_build_object('id', pr.id, 'estado', pr.estado) as prestamo,
      json_build_object('id', i.id, 'estado', i.estado) as inversion
    FROM movimientos m
    JOIN perfiles p ON m.perfil_id = p.id
    LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
    LEFT JOIN inversiones i ON m.inversion_id = i.id
    ORDER BY m.fecha_operacion DESC LIMIT $1`,
    [parseInt(limit)],
  );

  res.json({
    success: true,
    data: movimientos || [],
    _meta: { fuente: "calculo_manual" },
  });
});

/**
 * Obtener detalle de clientes con balances
 * Usa la vista SQL vista_detalle_clientes
 * GET /api/dashboard/clientes/detalle
 */
const obtenerDetalleClientes = asyncHandler(async (req, res) => {
  const { estado, solo_mora, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let queryText = "SELECT * FROM vista_detalle_clientes WHERE 1=1";
  const queryParams = [];
  let paramIndex = 1;

  // Filtros
  if (estado) {
    queryText += ` AND estado = $${paramIndex}`;
    queryParams.push(estado);
    paramIndex++;
  }

  if (solo_mora === "true") {
    queryText += ` AND dias_mora > 0`;
  }

  // Contar total
  const countQuery = queryText.replace("SELECT *", "SELECT COUNT(*) as total");
  const { rows: countResult } = await db.query(countQuery, queryParams);
  const count = parseInt(countResult[0].total);

  // Paginación y ordenamiento
  queryText += ` ORDER BY dias_mora DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  queryParams.push(limit, offset);

  const { rows: clientes } = await db.query(queryText, queryParams);

  // Convertir montos de unidades a milunidades
  const clientesFormateados = clientes?.map((c) => ({
    ...c,
    capital_prestado: Math.round(c.capital_prestado * 1000),
    capital_pagado: Math.round(c.capital_pagado * 1000),
    saldo_capital_pendiente: Math.round(c.saldo_capital_pendiente * 1000),
    intereses_pagados: Math.round(c.intereses_pagados * 1000),
    mora_pagada: Math.round((c.mora_pagada || 0) * 1000),
    interes_mora_generado: Math.round((c.interes_mora_generado || 0) * 1000),
    total_adeudado: Math.round(c.total_adeudado * 1000),
  }));

  // Calcular totales
  const totales = {
    capital_prestado_total:
      clientesFormateados?.reduce((sum, c) => sum + c.capital_prestado, 0) || 0,
    saldo_pendiente_total:
      clientesFormateados?.reduce(
        (sum, c) => sum + c.saldo_capital_pendiente,
        0,
      ) || 0,
    mora_generada_total:
      clientesFormateados?.reduce(
        (sum, c) => sum + c.interes_mora_generado,
        0,
      ) || 0,
    clientes_en_mora:
      clientesFormateados?.filter((c) => c.dias_mora > 0).length || 0,
  };

  res.json({
    success: true,
    data: clientesFormateados || [],
    totales,
    meta: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      totalPages: Math.ceil(count / limit),
    },
    _meta: { fuente: "vista_detalle_clientes" },
  });
});

/**
 * Obtener detalle de inversionistas con balances
 * Usa la vista SQL vista_detalle_inversionistas
 * GET /api/dashboard/inversionistas/detalle
 */
const obtenerDetalleInversionistas = asyncHandler(async (req, res) => {
  const { estado, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let queryText = "SELECT * FROM vista_detalle_inversionistas WHERE 1=1";
  const queryParams = [];
  let paramIndex = 1;

  // Filtros
  if (estado) {
    queryText += ` AND estado = $${paramIndex}`;
    queryParams.push(estado);
    paramIndex++;
  }

  // Contar total
  const countQuery = queryText.replace("SELECT *", "SELECT COUNT(*) as total");
  const { rows: countResult } = await db.query(countQuery, queryParams);
  const count = parseInt(countResult[0].total);

  // Paginación y ordenamiento
  queryText += ` ORDER BY capital_todavia_adeudado DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  queryParams.push(limit, offset);

  const { rows: inversionistas } = await db.query(queryText, queryParams);

  // Convertir montos de unidades a milunidades
  const inversionistasFormateados = inversionistas?.map((i) => ({
    ...i,
    inversion_inicial: Math.round(i.inversion_inicial * 1000),
    capital_devuelto: Math.round(i.capital_devuelto * 1000),
    intereses_pagados: Math.round(i.intereses_pagados * 1000),
    total_devuelto: Math.round(i.total_devuelto * 1000),
    capital_todavia_adeudado: Math.round(i.capital_todavia_adeudado * 1000),
    intereses_acumulados_estimados: Math.round(
      (i.intereses_acumulados_estimados || 0) * 1000,
    ),
  }));

  // Calcular totales
  const totales = {
    inversion_total:
      inversionistasFormateados?.reduce(
        (sum, i) => sum + i.inversion_inicial,
        0,
      ) || 0,
    capital_devuelto_total:
      inversionistasFormateados?.reduce(
        (sum, i) => sum + i.capital_devuelto,
        0,
      ) || 0,
    capital_adeudado_total:
      inversionistasFormateados?.reduce(
        (sum, i) => sum + i.capital_todavia_adeudado,
        0,
      ) || 0,
    intereses_pagados_total:
      inversionistasFormateados?.reduce(
        (sum, i) => sum + i.intereses_pagados,
        0,
      ) || 0,
    obligacion_total:
      inversionistasFormateados?.reduce(
        (sum, i) =>
          sum + i.capital_todavia_adeudado + i.intereses_acumulados_estimados,
        0,
      ) || 0,
  };

  res.json({
    success: true,
    data: inversionistasFormateados || [],
    totales,
    meta: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      totalPages: Math.ceil(count / limit),
    },
    _meta: { fuente: "vista_detalle_inversionistas" },
  });
});

module.exports = {
  obtenerResumen,
  obtenerAlertasVencimientos,
  obtenerMovimientosRecientes,
  obtenerDetalleClientes,
  obtenerDetalleInversionistas,
};
