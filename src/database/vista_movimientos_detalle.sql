-- Eliminar vista si existe
DROP VIEW IF EXISTS vista_movimientos_detalle;

-- Crear vista de movimientos con detalles del perfil
CREATE VIEW vista_movimientos_detalle AS
SELECT 
  m.id as movimiento_id,
  m.tipo as tipo_movimiento,
  m.monto_total,
  m.monto_capital,
  m.monto_interes,
  m.monto_mora,
  m.metodo_pago,
  m.referencia_pago,
  m.fecha_operacion,
  m.notas,
  -- Datos del perfil
  p.id as perfil_id,
  p.nombre_completo,
  p.email as perfil_email,
  p.rol as perfil_rol,
  -- Datos del préstamo si aplica
  pr.id as prestamo_id,
  pr.estado as prestamo_estado,
  pr.monto_principal as prestamo_monto,
  -- Datos de la inversión si aplica
  i.id as inversion_id,
  i.estado as inversion_estado,
  i.monto_invertido as inversion_monto
FROM movimientos m
LEFT JOIN perfiles p ON m.perfil_id = p.id
LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
LEFT JOIN inversiones i ON m.inversion_id = i.id;

-- Dar permisos
GRANT SELECT ON vista_movimientos_detalle TO authenticated;
GRANT SELECT ON vista_movimientos_detalle TO anon;
GRANT SELECT ON vista_movimientos_detalle TO service_role;
