-- Eliminar vista si existe
DROP VIEW IF EXISTS vista_balance_general;

-- Crear nueva vista de balance general
CREATE VIEW vista_balance_general AS
WITH prestamos_stats AS (
  SELECT 
    COUNT(*) FILTER (WHERE estado = 'activo') as prestamos_activos,
    COUNT(*) FILTER (WHERE estado = 'pagado') as prestamos_pagados,
    COUNT(*) FILTER (WHERE estado = 'activo' AND fecha_vencimiento < CURRENT_DATE) as prestamos_en_mora,
    COALESCE(SUM(monto_principal) FILTER (WHERE estado = 'activo'), 0) / 1000.0 as total_capital_en_la_calle,
    COALESCE(SUM(
      CASE 
        WHEN estado = 'activo' THEN 
          (monto_principal * tasa_interes_mensual / 100 * 
           GREATEST(1, EXTRACT(MONTH FROM AGE(CURRENT_DATE, fecha_inicio))))
        ELSE 0 
      END
    ), 0) / 1000.0 as intereses_potenciales,
    COALESCE(SUM(
      CASE 
        WHEN estado = 'activo' AND fecha_vencimiento < CURRENT_DATE THEN
          monto_principal * 0.02 * GREATEST(0, EXTRACT(DAY FROM AGE(CURRENT_DATE, fecha_vencimiento)))
        ELSE 0 
      END
    ), 0) / 1000.0 as monto_total_en_mora
  FROM prestamos
),
inversiones_stats AS (
  SELECT 
    COUNT(*) FILTER (WHERE estado = 'activo') as inversiones_activas,
    COUNT(*) FILTER (WHERE estado = 'finalizada') as inversiones_finalizadas,
    COALESCE(SUM(monto_invertido) FILTER (WHERE estado = 'activo'), 0) / 1000.0 as total_deuda_con_inversionistas,
    COALESCE(SUM(
      CASE 
        WHEN estado = 'activo' THEN 
          (monto_invertido * tasa_interes_pactada / 100 * 
           GREATEST(1, EXTRACT(MONTH FROM AGE(CURRENT_DATE, fecha_inversion))))
        ELSE 0 
      END
    ), 0) / 1000.0 as intereses_a_pagar
  FROM inversiones
),
movimientos_stats AS (
  SELECT 
    COALESCE(SUM(monto_total) FILTER (WHERE tipo = 'recibo_inversion'), 0) / 1000.0 as total_entradas,
    COALESCE(SUM(monto_total) FILTER (WHERE tipo = 'pago_cliente'), 0) / 1000.0 as total_recaudado,
    COALESCE(SUM(monto_total) FILTER (WHERE tipo = 'entrega_prestamo'), 0) / 1000.0 as total_prestado,
    COALESCE(SUM(monto_total) FILTER (WHERE tipo = 'devolucion_inversion'), 0) / 1000.0 as total_devuelto,
    COALESCE(SUM(monto_interes) FILTER (WHERE tipo = 'pago_cliente'), 0) / 1000.0 as intereses_recaudados
  FROM movimientos
  WHERE fecha_operacion >= CURRENT_DATE - INTERVAL '30 days'
)
SELECT 
  p.prestamos_activos,
  p.prestamos_pagados,
  p.prestamos_en_mora,
  p.total_capital_en_la_calle,
  p.intereses_potenciales,
  p.monto_total_en_mora,
  i.inversiones_activas,
  i.inversiones_finalizadas,
  i.total_deuda_con_inversionistas,
  i.intereses_a_pagar,
  m.total_entradas,
  m.total_recaudado,
  m.total_prestado,
  m.total_devuelto,
  m.intereses_recaudados,
  -- Calculos adicionales
  (p.total_capital_en_la_calle - i.total_deuda_con_inversionistas) as margen_bruto,
  (p.intereses_potenciales - i.intereses_a_pagar) as ganancia_neta_estimada,
  (p.total_capital_en_la_calle + p.monto_total_en_mora) as saldo_por_recaudar
FROM prestamos_stats p
CROSS JOIN inversiones_stats i
CROSS JOIN movimientos_stats m;

-- Dar permisos
GRANT SELECT ON vista_balance_general TO authenticated;
GRANT SELECT ON vista_balance_general TO anon;
GRANT SELECT ON vista_balance_general TO service_role;
