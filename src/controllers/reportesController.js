const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");

/**
 * Obtener reporte de rentabilidad mensual
 * GET /api/reportes/rentabilidad
 */
const obtenerRentabilidad = asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    WITH meses AS (
      SELECT generate_series(
        date_trunc('month', CURRENT_DATE) - interval '11 months',
        date_trunc('month', CURRENT_DATE),
        '1 month'::interval
      ) AS mes
    ),
    ingresos AS (
      SELECT 
        date_trunc('month', fecha_operacion) as mes,
        SUM(monto_interes) as intereses_clientes,
        SUM(monto_mora) as mora_recaudada,
        SUM(monto_total) as flujo_entrada
      FROM movimientos
      WHERE tipo = 'pago_cliente'
      GROUP BY 1
    ),
    egresos AS (
      SELECT 
        date_trunc('month', fecha_operacion) as mes,
        SUM(monto_interes) as intereses_inversionistas,
        SUM(monto_total) as flujo_salida
      FROM movimientos
      WHERE tipo = 'devolucion_inversion'
      GROUP BY 1
    )
    SELECT 
      to_char(m.mes, 'Mon YYYY') as nombre_mes,
      m.mes as fecha_mes,
      COALESCE(i.intereses_clientes, 0) as intereses_clientes,
      COALESCE(i.mora_recaudada, 0) as mora_recaudada,
      COALESCE(e.intereses_inversionistas, 0) as intereses_inversionistas,
      (COALESCE(i.intereses_clientes, 0) + COALESCE(i.mora_recaudada, 0) - COALESCE(e.intereses_inversionistas, 0)) as utilidad_neta
    FROM meses m
    LEFT JOIN ingresos i ON i.mes = m.mes
    LEFT JOIN egresos e ON e.mes = m.mes
    ORDER BY m.mes DESC
  `);

  res.json({
    success: true,
    data: rows
  });
});

/**
 * Estadísticas de Cartera y Riesgo
 * GET /api/reportes/cartera
 */
const obtenerEstadoCartera = asyncHandler(async (req, res) => {
  const { rows: stats } = await db.query(`
    SELECT 
      COUNT(*) as total_prestamos,
      SUM(CASE WHEN estado = 'activo' THEN monto_principal ELSE 0 END) as capital_en_calle,
      SUM(CASE WHEN estado = 'pagado' THEN monto_principal ELSE 0 END) as capital_recuperado,
      COUNT(CASE WHEN estado = 'activo' AND fecha_vencimiento < CURRENT_DATE THEN 1 END) as prestamos_en_mora
    FROM prestamos
  `);

  const { rows: distribucion } = await db.query(`
    SELECT 
      frecuencia_pago,
      COUNT(*) as cantidad,
      SUM(monto_principal) as monto
    FROM prestamos
    WHERE estado = 'activo'
    GROUP BY frecuencia_pago
  `);

  res.json({
    success: true,
    data: {
      resumen: stats[0],
      distribucion
    }
  });
});

module.exports = {
  obtenerRentabilidad,
  obtenerEstadoCartera
};
