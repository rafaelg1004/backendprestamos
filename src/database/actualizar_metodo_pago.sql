-- Actualizar constraint de metodo_pago para aceptar 'liquidacion'

-- 1. Eliminar constraint existente
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_metodo_pago_check;

-- 2. Crear nuevo constraint con 'liquidacion' incluido
ALTER TABLE movimientos ADD CONSTRAINT movimientos_metodo_pago_check 
  CHECK (metodo_pago IN ('efectivo', 'transferencia', 'otro', 'liquidacion'));

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Constraint actualizado. Ahora se acepta metodo_pago = ''liquidacion''';
END;
$$;
