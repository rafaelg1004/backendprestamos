-- =====================================================
-- SETUP COMPLETO DE CUOTAS - EJECUTAR TODO DE UNA VEZ
-- =====================================================

-- 1. CREAR TABLA DE CUOTAS
-- =====================================================
CREATE TABLE IF NOT EXISTS cuotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id UUID NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
  numero_cuota INTEGER NOT NULL,
  capital BIGINT NOT NULL DEFAULT 0,
  interes BIGINT NOT NULL DEFAULT 0,
  total_cuota BIGINT NOT NULL DEFAULT 0,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'parcial')),
  fecha_vencimiento DATE NOT NULL,
  fecha_pago DATE,
  monto_pagado BIGINT DEFAULT 0,
  movimiento_id UUID REFERENCES movimientos(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(prestamo_id, numero_cuota)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_cuotas_prestamo_id ON cuotas(prestamo_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_estado ON cuotas(estado);
CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_vencimiento ON cuotas(fecha_vencimiento);

-- 2. FUNCIÓN PARA ACTUALIZAR updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_cuotas_updated_at ON cuotas;
CREATE TRIGGER update_cuotas_updated_at
  BEFORE UPDATE ON cuotas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 3. FUNCIÓN PRINCIPAL: GENERAR CUOTAS AL CREAR PRÉSTAMO
-- =====================================================
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
  -- Calcular plazo en meses desde las fechas (plazo_meses puede no existir)
  meses := GREATEST(1, CEIL((NEW.fecha_vencimiento - NEW.fecha_inicio) / 30.0)::INTEGER);
  
  -- Validar que tengamos datos necesarios
  IF NEW.monto_principal IS NULL OR NEW.monto_principal <= 0 THEN
    RAISE EXCEPTION 'El monto del préstamo debe ser mayor a 0';
  END IF;
  
  IF NEW.fecha_inicio IS NULL THEN
    RAISE EXCEPTION 'La fecha de inicio es requerida';
  END IF;
  
  IF NEW.fecha_vencimiento IS NULL THEN
    RAISE EXCEPTION 'La fecha de vencimiento es requerida';
  END IF;
  
  tasa := COALESCE(NEW.tasa_interes_mensual, 0) / 100.0;
  capital := NEW.monto_principal;
  saldo := capital;
  
  -- Calcular cuota mensual fija (sistema francés)
  IF tasa > 0 AND meses > 0 THEN
    cuota := capital * (tasa * POWER(1 + tasa, meses)) / (POWER(1 + tasa, meses) - 1);
  ELSE
    cuota := capital / GREATEST(meses, 1);
  END IF;
  
  -- Eliminar cuotas existentes si las hay (por si se recrea)
  DELETE FROM cuotas WHERE prestamo_id = NEW.id;
  
  -- Generar cuotas
  FOR i IN 1..meses LOOP
    -- Calcular interés del mes sobre el saldo actual
    interes_mes := ROUND(saldo * tasa);
    
    -- Capital de esta cuota
    IF i = meses THEN
      -- Última cuota: tomar todo el saldo restante
      capital_mes := saldo;
      cuota := capital_mes + interes_mes;
    ELSE
      capital_mes := GREATEST(0, ROUND(cuota - interes_mes));
    END IF;
    
    -- Asegurar que no pasemos del saldo
    IF capital_mes > saldo THEN
      capital_mes := saldo;
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
    saldo := GREATEST(0, saldo - capital_mes);
    
    -- Log para debug
    RAISE NOTICE 'Cuota %: Capital=%, Interes=%, Total=%, Saldo restante=%', 
      i, capital_mes, interes_mes, capital_mes + interes_mes, saldo;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. TRIGGER PARA EJECUTAR AL INSERTAR PRÉSTAMO
-- =====================================================
DROP TRIGGER IF EXISTS trigger_generar_cuotas ON prestamos;
CREATE TRIGGER trigger_generar_cuotas
  AFTER INSERT ON prestamos
  FOR EACH ROW
  EXECUTE FUNCTION generar_cuotas_prestamo();

-- 5. FUNCIÓN PARA ACTUALIZAR CUOTA AL PAGAR
-- =====================================================
CREATE OR REPLACE FUNCTION actualizar_estado_cuota()
RETURNS TRIGGER AS $$
DECLARE
  cuota_record RECORD;
  monto_restante BIGINT;
  monto_aplicar BIGINT;
BEGIN
  -- Solo procesar si es un pago de cliente
  IF NEW.tipo != 'pago_cliente' OR NEW.prestamo_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- El monto del pago a aplicar (capital + interes)
  monto_restante := COALESCE(NEW.monto_capital, 0) + COALESCE(NEW.monto_interes, 0);
  
  RAISE NOTICE 'Procesando pago de % para préstamo %', monto_restante, NEW.prestamo_id;
  
  -- Buscar las cuotas pendientes o parciales del préstamo
  FOR cuota_record IN 
    SELECT * FROM cuotas 
    WHERE prestamo_id = NEW.prestamo_id 
    AND estado IN ('pendiente', 'parcial')
    ORDER BY numero_cuota ASC
  LOOP
    -- Calcular cuánto falta por pagar de esta cuota
    monto_aplicar := cuota_record.total_cuota - cuota_record.monto_pagado;
    
    -- Si el pago cubre toda la cuota
    IF monto_restante >= monto_aplicar THEN
      UPDATE cuotas 
      SET 
        estado = 'pagado',
        monto_pagado = cuota_record.total_cuota,
        fecha_pago = COALESCE(NEW.fecha_operacion, CURRENT_DATE),
        movimiento_id = NEW.id,
        updated_at = NOW()
      WHERE id = cuota_record.id;
      
      monto_restante := monto_restante - monto_aplicar;
      RAISE NOTICE 'Cuota % marcada como PAGADO', cuota_record.numero_cuota;
      
    -- Si el pago cubre parcialmente la cuota
    ELSIF monto_restante > 0 THEN
      UPDATE cuotas 
      SET 
        estado = 'parcial',
        monto_pagado = cuota_record.monto_pagado + monto_restante,
        movimiento_id = NEW.id,
        updated_at = NOW()
      WHERE id = cuota_record.id;
      
      RAISE NOTICE 'Cuota % marcada como PARCIAL (pagado: %)', 
        cuota_record.numero_cuota, cuota_record.monto_pagado + monto_restante;
      
      monto_restante := 0;
    END IF;
    
    -- Salir si no queda monto por asignar
    EXIT WHEN monto_restante <= 0;
  END LOOP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. TRIGGER PARA ACTUALIZAR CUOTA AL INSERTAR PAGO
-- =====================================================
DROP TRIGGER IF EXISTS trigger_actualizar_cuota ON movimientos;
CREATE TRIGGER trigger_actualizar_cuota
  AFTER INSERT ON movimientos
  FOR EACH ROW
  EXECUTE FUNCTION actualizar_estado_cuota();

-- 7. COMENTARIOS
-- =====================================================
COMMENT ON TABLE cuotas IS 'Registro de cuotas mensuales de cada préstamo con sistema de amortización';
COMMENT ON COLUMN cuotas.capital IS 'Capital a pagar en esta cuota (milunidades)';
COMMENT ON COLUMN cuotas.interes IS 'Interés a pagar en esta cuota (milunidades)';
COMMENT ON COLUMN cuotas.total_cuota IS 'Total de la cuota = capital + interes';
COMMENT ON COLUMN cuotas.estado IS 'Estado: pendiente, pagado, parcial';
COMMENT ON COLUMN cuotas.monto_pagado IS 'Monto realmente pagado (para pagos parciales)';
COMMENT ON FUNCTION generar_cuotas_prestamo() IS 'Genera automáticamente las cuotas mensuales al crear un préstamo usando sistema francés';
COMMENT ON FUNCTION actualizar_estado_cuota() IS 'Actualiza automáticamente el estado de las cuotas al registrar un pago';

-- 8. PERMISOS
-- =====================================================
GRANT ALL ON cuotas TO authenticated;
GRANT ALL ON cuotas TO service_role;
GRANT ALL ON cuotas TO anon;

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Setup completo de cuotas ejecutado correctamente!';
  RAISE NOTICE 'Las cuotas se generarán automáticamente al crear préstamos.';
  RAISE NOTICE 'Los pagos actualizarán el estado de las cuotas automáticamente.';
END;
$$;
