-- =====================================================
-- VISTAS SQL PARA SUPABASE
-- Sistema de Préstamos e Inversiones
-- =====================================================
-- Estas vistas consolidan información para supervisión
-- financiera profesional. Todos los cálculos usan milunidades.
-- =====================================================

-- 1. VISTA DE DETALLE DE PRÉSTAMOS (Clientes)
-- Muestra: capital prestado, pagos recibidos, saldo pendiente,
-- días de mora e interés de mora generado
-- =====================================================
CREATE OR REPLACE VIEW vista_detalle_clientes AS
SELECT 
  p.id AS cliente_id,
  p.nombre_completo AS cliente,
  p.email AS cliente_email,
  pr.id AS prestamo_id,
  pr.monto_principal / 1000.0 AS capital_prestado,
  pr.tasa_interes_mensual,
  pr.tasa_mora_diaria,
  pr.fecha_inicio,
  pr.fecha_vencimiento,
  COALESCE(SUM(m.monto_capital), 0) / 1000.0 AS capital_pagado,
  (pr.monto_principal - COALESCE(SUM(m.monto_capital), 0)) / 1000.0 AS saldo_capital_pendiente,
  COALESCE(SUM(m.monto_interes), 0) / 1000.0 AS intereses_pagados,
  COALESCE(SUM(m.monto_mora), 0) / 1000.0 AS mora_pagada,
  -- Cálculo de días de mora
  CASE 
    WHEN pr.estado != 'pagado' AND CURRENT_DATE > pr.fecha_vencimiento 
    THEN (CURRENT_DATE - pr.fecha_vencimiento)
    ELSE 0 
  END AS dias_mora,
  -- Cálculo de interés de mora sobre saldo pendiente
  CASE 
    WHEN pr.estado != 'pagado' AND CURRENT_DATE > pr.fecha_vencimiento 
    THEN ((pr.monto_principal - COALESCE(SUM(m.monto_capital), 0)) * pr.tasa_mora_diaria / 100 * (CURRENT_DATE - pr.fecha_vencimiento)) / 1000.0
    ELSE 0 
  END AS interes_mora_generado,
  -- Total adeudado actualizado
  CASE 
    WHEN pr.estado != 'pagado' AND CURRENT_DATE > pr.fecha_vencimiento 
    THEN ((pr.monto_principal - COALESCE(SUM(m.monto_capital), 0)) * (1 + (pr.tasa_mora_diaria / 100 * (CURRENT_DATE - pr.fecha_vencimiento)))) / 1000.0
    ELSE (pr.monto_principal - COALESCE(SUM(m.monto_capital), 0)) / 1000.0
  END AS total_adeudado,
  pr.estado,
  pr.notas
FROM prestamos pr
JOIN perfiles p ON pr.cliente_id = p.id
LEFT JOIN movimientos m ON pr.id = m.prestamo_id AND m.tipo = 'pago_cliente'
GROUP BY p.id, p.nombre_completo, p.email, pr.id, pr.monto_principal, pr.tasa_interes_mensual, 
         pr.tasa_mora_diaria, pr.fecha_inicio, pr.fecha_vencimiento, pr.estado, pr.notas;

-- =====================================================
-- 2. VISTA DE SEGUIMIENTO DE INVERSIONISTAS
-- Muestra: inversión inicial, devoluciones realizadas
-- (desglosadas en capital e intereses), saldo pendiente
-- =====================================================
CREATE OR REPLACE VIEW vista_detalle_inversionistas AS
SELECT 
  p.id AS inversionista_id,
  p.nombre_completo AS inversionista,
  p.email AS inversionista_email,
  inv.id AS inversion_id,
  inv.monto_invertido / 1000.0 AS inversion_inicial,
  inv.tasa_interes_pactada AS tasa_acordada,
  inv.fecha_inversion,
  -- Capital devuelto (solo de movimientos tipo devolucion_inversion)
  COALESCE(SUM(CASE WHEN m.tipo = 'devolucion_inversion' THEN m.monto_capital ELSE 0 END), 0) / 1000.0 AS capital_devuelto,
  -- Intereses pagados al inversionista
  COALESCE(SUM(CASE WHEN m.tipo = 'devolucion_inversion' THEN m.monto_interes ELSE 0 END), 0) / 1000.0 AS intereses_pagados,
  -- Total devuelto
  COALESCE(SUM(CASE WHEN m.tipo = 'devolucion_inversion' THEN m.monto_total ELSE 0 END), 0) / 1000.0 AS total_devuelto,
  -- Capital aún adeudado
  (inv.monto_invertido - COALESCE(SUM(CASE WHEN m.tipo = 'devolucion_inversion' THEN m.monto_capital ELSE 0 END), 0)) / 1000.0 AS capital_todavia_adeudado,
  -- Intereses que deberían pagarse (proporcional al tiempo)
  CASE 
    WHEN inv.estado = 'finalizada' THEN COALESCE(SUM(CASE WHEN m.tipo = 'devolucion_inversion' THEN m.monto_interes ELSE 0 END), 0) / 1000.0
    ELSE (inv.monto_invertido * inv.tasa_interes_pactada / 100 * 
          EXTRACT(MONTH FROM AGE(CURRENT_DATE, inv.fecha_inversion))) / 1000.0
  END AS intereses_acumulados_estimados,
  inv.estado,
  inv.notas
FROM inversiones inv
JOIN perfiles p ON inv.inversionista_id = p.id
LEFT JOIN movimientos m ON inv.id = m.inversion_id
GROUP BY p.id, p.nombre_completo, p.email, inv.id, inv.monto_invertido, 
         inv.tasa_interes_pactada, inv.fecha_inversion, inv.estado, inv.notas;

-- =====================================================
-- 3. VISTA GENERAL DE BALANCE (Tablero de Control)
-- Muestra: salud financiera global de la operación
-- =====================================================
CREATE OR REPLACE VIEW vista_balance_general AS
SELECT 
  -- Total de préstamos activos (capital en la calle)
  COALESCE((SELECT SUM(pr.monto_principal - COALESCE(pagos.capital_pagado, 0)) / 1000.0 
   FROM prestamos pr
   LEFT JOIN (
     SELECT prestamo_id, SUM(monto_capital) AS capital_pagado 
     FROM movimientos 
     WHERE tipo = 'pago_cliente'
     GROUP BY prestamo_id
   ) pagos ON pr.id = pagos.prestamo_id
   WHERE pr.estado != 'pagado'), 0) AS total_capital_en_la_calle,
  
  -- Total deudas con inversionistas (capital pendiente de devolver)
  COALESCE((SELECT SUM(inv.monto_invertido - COALESCE(devoluciones.capital_devuelto, 0)) / 1000.0 
   FROM inversiones inv
   LEFT JOIN (
     SELECT inversion_id, SUM(monto_capital) AS capital_devuelto 
     FROM movimientos 
     WHERE tipo = 'devolucion_inversion'
     GROUP BY inversion_id
   ) devoluciones ON inv.id = devoluciones.inversion_id
   WHERE inv.estado != 'finalizada'), 0) AS total_deuda_con_inversionistas,
  
  -- Intereses ganados de clientes (por pagos de intereses y mora)
  COALESCE((SELECT SUM(monto_interes + monto_mora) / 1000.0 
   FROM movimientos 
   WHERE tipo = 'pago_cliente'), 0) AS intereses_ganados_clientes,
   
  -- Intereses pagados a inversionistas
  COALESCE((SELECT SUM(monto_interes) / 1000.0 
   FROM movimientos 
   WHERE tipo = 'devolucion_inversion'), 0) AS intereses_pagados_inversionistas,
   
  -- Utilidad Bruta en Intereses
  COALESCE((SELECT SUM(monto_interes + monto_mora) / 1000.0 
   FROM movimientos 
   WHERE tipo = 'pago_cliente'), 0) - 
  COALESCE((SELECT SUM(monto_interes) / 1000.0 
   FROM movimientos 
   WHERE tipo = 'devolucion_inversion'), 0) AS utilidad_neta_intereses,
   
  -- Total de transacciones con evidencia (capturas)
  (SELECT COUNT(*) FROM movimientos WHERE url_captura IS NOT NULL) AS transacciones_con_soporte,
  
  -- Total de movimientos registrados
  (SELECT COUNT(*) FROM movimientos) AS total_movimientos,
  
  -- Préstamos en mora actualmente
  (SELECT COUNT(*) FROM prestamos WHERE estado = 'activo' AND CURRENT_DATE > fecha_vencimiento) AS prestamos_en_mora,
  
  -- Total adeudado en mora
  COALESCE((SELECT SUM(
    (pr.monto_principal - COALESCE(pagos.capital_pagado, 0)) * 
    pr.tasa_mora_diaria / 100 * 
    (CURRENT_DATE - pr.fecha_vencimiento)
  ) / 1000.0
   FROM prestamos pr
   LEFT JOIN (
     SELECT prestamo_id, SUM(monto_capital) AS capital_pagado 
     FROM movimientos 
     WHERE tipo = 'pago_cliente'
     GROUP BY prestamo_id
   ) pagos ON pr.id = pagos.prestamo_id
   WHERE pr.estado = 'activo' AND CURRENT_DATE > pr.fecha_vencimiento), 0) AS monto_total_en_mora,
   
  -- Fecha de actualización
  CURRENT_TIMESTAMP AS fecha_actualizacion;

-- =====================================================
-- 4. VISTA DE MOVIMIENTOS DETALLADOS
-- Muestra todos los movimientos con información completa
-- =====================================================
CREATE OR REPLACE VIEW vista_movimientos_detalle AS
SELECT 
  m.id AS movimiento_id,
  m.fecha_operacion,
  m.tipo AS tipo_movimiento,
  p.id AS perfil_id,
  p.nombre_completo AS nombre_perfil,
  p.rol AS tipo_perfil,
  p.email AS email_perfil,
  pr.id AS prestamo_id,
  inv.id AS inversion_id,
  m.monto_total / 1000.0 AS monto_total,
  m.monto_capital / 1000.0 AS monto_capital,
  m.monto_interes / 1000.0 AS monto_interes,
  m.monto_mora / 1000.0 AS monto_mora,
  m.metodo_pago,
  m.referencia_pago,
  m.url_captura,
  m.notas,
  CASE 
    WHEN m.tipo IN ('recibo_inversion', 'pago_cliente') THEN 'entrada'
    WHEN m.tipo IN ('entrega_prestamo', 'devolucion_inversion') THEN 'salida'
    ELSE 'otro'
  END AS flujo
FROM movimientos m
JOIN perfiles p ON m.perfil_id = p.id
LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
LEFT JOIN inversiones inv ON m.inversion_id = inv.id
ORDER BY m.fecha_operacion DESC;

-- =====================================================
-- 5. VISTA DE PRÉSTAMOS PRÓXIMOS A VENCER
-- Alerta de vencimientos en los próximos 7 días
-- =====================================================
CREATE OR REPLACE VIEW vista_alertas_vencimientos AS
SELECT 
  pr.id AS prestamo_id,
  p.id AS cliente_id,
  p.nombre_completo AS cliente,
  p.email AS cliente_email,
  p.telefono AS cliente_telefono,
  pr.monto_principal / 1000.0 AS capital_prestado,
  pr.fecha_vencimiento,
  (pr.fecha_vencimiento - CURRENT_DATE) AS dias_restantes,
  COALESCE(SUM(m.monto_capital), 0) / 1000.0 AS capital_pagado,
  (pr.monto_principal - COALESCE(SUM(m.monto_capital), 0)) / 1000.0 AS saldo_pendiente,
  CASE 
    WHEN (pr.fecha_vencimiento - CURRENT_DATE) <= 0 THEN 'vencido'
    WHEN (pr.fecha_vencimiento - CURRENT_DATE) <= 3 THEN 'critico'
    ELSE 'proximo'
  END AS nivel_alerta
FROM prestamos pr
JOIN perfiles p ON pr.cliente_id = p.id
LEFT JOIN movimientos m ON pr.id = m.prestamo_id AND m.tipo = 'pago_cliente'
WHERE pr.estado = 'activo'
  AND pr.fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days'
GROUP BY pr.id, p.id, p.nombre_completo, p.email, p.telefono, 
         pr.monto_principal, pr.fecha_vencimiento
ORDER BY pr.fecha_vencimiento ASC;

-- =====================================================
-- NOTAS DE USO:
-- =====================================================
-- 1. Todas las cantidades monetarias se convierten de 
--    milunidades a unidades (/ 1000.0) para legibilidad
-- 
-- 2. Las vistas se actualizan automáticamente con cada
--    consulta, mostrando siempre datos en tiempo real
--
-- 3. Puedes consultar estas vistas directamente desde
--    el cliente de Supabase o desde tu backend:
--    
--    const { data, error } = await supabase
--      .from('vista_detalle_clientes')
--      .select('*')
--
-- 4. Las vistas respetan las políticas de RLS (Row Level
--    Security) definidas en las tablas base
-- =====================================================
