const db = require("../../config/db");
const { asyncHandler, AppError } = require("../../middleware/errorHandler");

const obtenerPrestamosMora = asyncHandler(async (req, res) => {
  const hoy = new Date().toISOString().split("T")[0];

  const { rows: prestamosMora } = await db.query(
    `SELECT p.*, 
      json_build_object(
        'id', pref.id, 
        'nombre_completo', pref.nombre_completo, 
        'email', pref.email
      ) as cliente
    FROM prestamos p
    JOIN perfiles pref ON p.cliente_id = pref.id
    WHERE (COALESCE(p.fecha_ultimo_corte, p.fecha_inicio) + INTERVAL '1 month')::date < $1 AND p.estado = 'activo'
    ORDER BY p.fecha_ultimo_corte ASC`,
    [hoy]
  );

  res.json({
    success: true,
    data: prestamosMora || [],
    total: prestamosMora?.length || 0,
  });
});

const obtenerPrestamosPorCedula = asyncHandler(async (req, res) => {
  const { cedula } = req.params;

  // Buscar perfil por cédula usando SQL
  const { rows: [perfil] } = await db.query(
    "SELECT id, nombre_completo, telefono, identificacion FROM perfiles WHERE identificacion = $1",
    [cedula]
  );

  if (!perfil) {
    throw new AppError(
      "No se encontró ningún perfil con esa cédula",
      404,
      "NOT_FOUND",
    );
  }

  // Obtener préstamos con detalles usando SQL
  const { rows: prestamos } = await db.query(
    `SELECT id, monto_principal, tasa_interes_mensual, estado, fecha_inicio, saldo_capital, interes_acumulado
     FROM prestamos WHERE cliente_id = $1 ORDER BY fecha_inicio DESC`,
    [perfil.id]
  );

  // Obtener movimientos de pagos de este cliente
  const { rows: movimientos } = await db.query(
    "SELECT prestamo_id, monto_capital, monto_interes FROM movimientos WHERE perfil_id = $1 AND tipo = 'pago_cliente'",
    [perfil.id]
  );

  // Calcular resumen financiero
  let cap_inicial = 0, cap_pag = 0, int_pag = 0, cap_pend = 0, int_pend = 0;
  let suma_tasa_ponderada = 0;
  let capital_activo_total = 0;

  const prestamosConCalculos = prestamos.map(pres => {
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

    // Calcular intereses pendientes
    let intPendientePres = 0;
    if (pres.estado !== 'pagado' && pendiente > 0) {
      const tasa = parseFloat(pres.tasa_interes_mensual || 0);
      suma_tasa_ponderada += (tasa * pendiente);
      capital_activo_total += pendiente;

      const fechaPres = new Date(pres.fecha_inicio);
      const hoy = new Date();
      const mesesTranscurridos = (hoy - fechaPres) / (1000 * 60 * 60 * 24 * 30.44);
      const interesEsperado = montoInicial * (tasa / 100) * mesesTranscurridos;
      intPendientePres = Math.max(0, interesEsperado - iPag);
      int_pend += intPendientePres;
    }

    return {
      ...pres,
      capital_pagado: cPag,
      intereses_pagados: iPag,
      capital_pendiente: pendiente,
      intereses_pendientes: intPendientePres
    };
  });

  const tasa_promedio = capital_activo_total > 0 ? (suma_tasa_ponderada / capital_activo_total) : 0;

  const resumen = {
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

  res.json({
    success: true,
    data: {
      perfil: {
        nombre: perfil.nombre_completo,
        telefono: perfil.telefono,
        identificacion: perfil.identificacion,
      },
      prestamos: prestamosConCalculos,
      resumen,
      total: prestamos.length,
    },
  });
});

module.exports = {
  obtenerPrestamosMora,
  obtenerPrestamosPorCedula
};
