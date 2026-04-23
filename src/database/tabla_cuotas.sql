-- Tabla para registrar las cuotas de cada préstamo
CREATE TABLE IF NOT EXISTS cuotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id UUID NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
  numero_cuota INTEGER NOT NULL,
  capital BIGINT NOT NULL DEFAULT 0, -- En milunidades
  interes BIGINT NOT NULL DEFAULT 0, -- En milunidades
  total_cuota BIGINT NOT NULL DEFAULT 0, -- capital + interes (milunidades)
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'parcial')),
  fecha_vencimiento DATE NOT NULL,
  fecha_pago DATE,
  monto_pagado BIGINT DEFAULT 0, -- En milunidades
  movimiento_id UUID REFERENCES movimientos(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Evitar duplicados de cuota por préstamo
  UNIQUE(prestamo_id, numero_cuota)
);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_cuotas_prestamo_id ON cuotas(prestamo_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_estado ON cuotas(estado);
CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_vencimiento ON cuotas(fecha_vencimiento);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS update_cuotas_updated_at ON cuotas;
CREATE TRIGGER update_cuotas_updated_at
  BEFORE UPDATE ON cuotas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comentarios
COMMENT ON TABLE cuotas IS 'Registro de cuotas mensuales de cada préstamo';
COMMENT ON COLUMN cuotas.capital IS 'Capital a pagar en esta cuota (milunidades)';
COMMENT ON COLUMN cuotas.interes IS 'Interés a pagar en esta cuota (milunidades)';
COMMENT ON COLUMN cuotas.total_cuota IS 'Total de la cuota = capital + interes';
COMMENT ON COLUMN cuotas.estado IS 'Estado: pendiente, pagado, parcial';
COMMENT ON COLUMN cuotas.monto_pagado IS 'Monto realmente pagado (para pagos parciales)';

-- Permisos
GRANT ALL ON cuotas TO authenticated;
GRANT ALL ON cuotas TO service_role;
