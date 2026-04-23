-- Función para actualizar el estado de una cuota al registrar un pago
CREATE OR REPLACE FUNCTION actualizar_estado_cuota()
RETURNS TRIGGER AS $$
DECLARE
  cuota_record RECORD;
  monto_restante BIGINT;
BEGIN
  -- Solo procesar si es un pago de cliente
  IF NEW.tipo != 'pago_cliente' OR NEW.prestamo_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  monto_restante := NEW.monto_capital + NEW.monto_interes;
  
  -- Buscar la primera cuota pendiente o parcial del préstamo
  FOR cuota_record IN 
    SELECT * FROM cuotas 
    WHERE prestamo_id = NEW.prestamo_id 
    AND estado IN ('pendiente', 'parcial')
    ORDER BY numero_cuota ASC
  LOOP
    -- Si el pago cubre toda la cuota
    IF monto_restante >= (cuota_record.total_cuota - cuota_record.monto_pagado) THEN
      UPDATE cuotas 
      SET 
        estado = 'pagado',
        monto_pagado = cuota_record.total_cuota,
        fecha_pago = NEW.fecha_operacion,
        movimiento_id = NEW.id,
        updated_at = NOW()
      WHERE id = cuota_record.id;
      
      monto_restante := monto_restante - (cuota_record.total_cuota - cuota_record.monto_pagado);
    -- Si el pago cubre parcialmente la cuota
    ELSIF monto_restante > 0 THEN
      UPDATE cuotas 
      SET 
        estado = 'parcial',
        monto_pagado = cuota_record.monto_pagado + monto_restante,
        movimiento_id = NEW.id,
        updated_at = NOW()
      WHERE id = cuota_record.id;
      
      monto_restante := 0;
    END IF;
    
    -- Salir si no queda monto por asignar
    EXIT WHEN monto_restante <= 0;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para ejecutar después de insertar un movimiento
DROP TRIGGER IF EXISTS trigger_actualizar_cuota ON movimientos;
CREATE TRIGGER trigger_actualizar_cuota
  AFTER INSERT ON movimientos
  FOR EACH ROW
  EXECUTE FUNCTION actualizar_estado_cuota();

-- Comentario
COMMENT ON FUNCTION actualizar_estado_cuota() IS 'Actualiza automáticamente el estado de las cuotas al registrar un pago';
