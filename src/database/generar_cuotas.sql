-- Función para generar cuotas automáticamente al crear un préstamo
CREATE OR REPLACE FUNCTION generar_cuotas_prestamo()
RETURNS TRIGGER AS $$
DECLARE
  meses INTEGER;
  tasa DECIMAL;
  capital DECIMAL;
  cuota DECIMAL;
  i INTEGER;
  fecha_venc DATE;
  interes_mes DECIMAL;
  capital_mes DECIMAL;
  saldo DECIMAL;
BEGIN
  -- Calcular plazo en meses
  meses := COALESCE(NEW.plazo_meses, 
    CEIL((NEW.fecha_vencimiento - NEW.fecha_inicio) / 30.0)::INTEGER, 
    1);
  
  tasa := NEW.tasa_interes_mensual / 100.0;
  capital := NEW.monto_principal;
  saldo := capital;
  
  -- Calcular cuota mensual fija (sistema francés)
  IF tasa > 0 AND meses > 0 THEN
    cuota := capital * (tasa * POWER(1 + tasa, meses)) / (POWER(1 + tasa, meses) - 1);
  ELSE
    cuota := capital / meses;
  END IF;
  
  -- Generar cuotas
  FOR i IN 1..meses LOOP
    -- Calcular interés del mes
    interes_mes := ROUND(saldo * tasa);
    -- Capital de esta cuota
    capital_mes := ROUND(cuota - interes_mes);
    
    -- Ajustar última cuota
    IF i = meses THEN
      capital_mes := saldo; -- El saldo restante
      cuota := capital_mes + interes_mes;
    END IF;
    
    -- Calcular fecha de vencimiento
    fecha_venc := NEW.fecha_inicio + (i || ' months')::INTERVAL;
    
    -- Insertar cuota
    INSERT INTO cuotas (
      prestamo_id,
      numero_cuota,
      capital,
      interes,
      total_cuota,
      estado,
      fecha_vencimiento
    ) VALUES (
      NEW.id,
      i,
      capital_mes,
      interes_mes,
      capital_mes + interes_mes,
      'pendiente',
      fecha_venc
    );
    
    -- Actualizar saldo
    saldo := saldo - capital_mes;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para ejecutar al insertar un préstamo
DROP TRIGGER IF EXISTS trigger_generar_cuotas ON prestamos;
CREATE TRIGGER trigger_generar_cuotas
  AFTER INSERT ON prestamos
  FOR EACH ROW
  EXECUTE FUNCTION generar_cuotas_prestamo();

-- Comentario
COMMENT ON FUNCTION generar_cuotas_prestamo() IS 'Genera automáticamente las cuotas mensuales al crear un préstamo';
