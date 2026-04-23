-- =====================================================
-- SETUP COMPLETO DE BASE DE DATOS POSTGRESQL
-- Sistema de Préstamos e Inversiones
-- =====================================================
-- Ejecutar este script en una base de datos PostgreSQL nueva
-- =====================================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLA: users (para autenticación)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL, -- Contraseña encriptada con bcrypt
  email_confirmed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_sign_in_at TIMESTAMP WITH TIME ZONE
);

-- Índices para users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =====================================================
-- TABLA: perfiles
-- =====================================================
CREATE TABLE IF NOT EXISTS perfiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  nombre_completo VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  rol VARCHAR(50) NOT NULL CHECK (rol IN ('admin', 'cliente', 'inversionista')),
  telefono VARCHAR(50),
  fecha_registro TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  direccion TEXT,
  identificacion VARCHAR(50) UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para perfiles
CREATE INDEX IF NOT EXISTS idx_perfiles_email ON perfiles(email);
CREATE INDEX IF NOT EXISTS idx_perfiles_rol ON perfiles(rol);
CREATE INDEX IF NOT EXISTS idx_perfiles_identificacion ON perfiles(identificacion);

-- =====================================================
-- TABLA: prestamos
-- =====================================================
CREATE TABLE IF NOT EXISTS prestamos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  monto_principal BIGINT NOT NULL, -- En milunidades
  tasa_interes_mensual NUMERIC(5, 2) NOT NULL,
  tasa_mora_diaria NUMERIC(5, 2) NOT NULL DEFAULT 0.02,
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pagado', 'mora')),
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para prestamos
CREATE INDEX IF NOT EXISTS idx_prestamos_cliente_id ON prestamos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_prestamos_estado ON prestamos(estado);
CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_vencimiento ON prestamos(fecha_vencimiento);

-- =====================================================
-- TABLA: inversiones
-- =====================================================
CREATE TABLE IF NOT EXISTS inversiones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inversionista_id UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  monto_invertido BIGINT NOT NULL, -- En milunidades
  tasa_interes_pactada NUMERIC(5, 2) NOT NULL,
  fecha_inversion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  estado VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'finalizada')),
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para inversiones
CREATE INDEX IF NOT EXISTS idx_inversiones_inversionista_id ON inversiones(inversionista_id);
CREATE INDEX IF NOT EXISTS idx_inversiones_estado ON inversiones(estado);

-- =====================================================
-- TABLA: movimientos
-- =====================================================
CREATE TABLE IF NOT EXISTS movimientos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  perfil_id UUID NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  prestamo_id UUID REFERENCES prestamos(id) ON DELETE CASCADE,
  inversion_id UUID REFERENCES inversiones(id) ON DELETE CASCADE,
  monto_total BIGINT NOT NULL, -- En milunidades
  monto_capital BIGINT DEFAULT 0, -- En milunidades
  monto_interes BIGINT DEFAULT 0, -- En milunidades
  monto_mora BIGINT DEFAULT 0, -- En milunidades
  metodo_pago VARCHAR(50) CHECK (metodo_pago IN ('efectivo', 'transferencia', 'otro', 'liquidacion')),
  referencia_pago TEXT,
  url_captura TEXT,
  tipo VARCHAR(50) NOT NULL CHECK (tipo IN ('entrega_prestamo', 'pago_cliente', 'recibo_inversion', 'devolucion_inversion')),
  fecha_operacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: debe estar asociado a préstamo o inversión (no ambos, ni ninguno)
  CONSTRAINT movimientos_relacion CHECK (
    (prestamo_id IS NOT NULL AND inversion_id IS NULL) OR
    (prestamo_id IS NULL AND inversion_id IS NOT NULL)
  )
);

-- Índices para movimientos
CREATE INDEX IF NOT EXISTS idx_movimientos_perfil_id ON movimientos(perfil_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_prestamo_id ON movimientos(prestamo_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_inversion_id ON movimientos(inversion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo ON movimientos(tipo);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha_operacion ON movimientos(fecha_operacion);

-- =====================================================
-- TABLA: cuotas
-- =====================================================
CREATE TABLE IF NOT EXISTS cuotas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Índices para cuotas
CREATE INDEX IF NOT EXISTS idx_cuotas_prestamo_id ON cuotas(prestamo_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_estado ON cuotas(estado);
CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_vencimiento ON cuotas(fecha_vencimiento);

-- =====================================================
-- FUNCIONES Y TRIGGERS PARA updated_at
-- =====================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para perfiles
DROP TRIGGER IF EXISTS update_perfiles_updated_at ON perfiles;
CREATE TRIGGER update_perfiles_updated_at
  BEFORE UPDATE ON perfiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para prestamos
DROP TRIGGER IF EXISTS update_prestamos_updated_at ON prestamos;
CREATE TRIGGER update_prestamos_updated_at
  BEFORE UPDATE ON prestamos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para inversiones
DROP TRIGGER IF EXISTS update_inversiones_updated_at ON inversiones;
CREATE TRIGGER update_inversiones_updated_at
  BEFORE UPDATE ON inversiones
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger para cuotas
DROP TRIGGER IF EXISTS update_cuotas_updated_at ON cuotas;
CREATE TRIGGER update_cuotas_updated_at
  BEFORE UPDATE ON cuotas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VISTAS
-- =====================================================

-- Vista: vista_balance_general
DROP VIEW IF EXISTS vista_balance_general;
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
  (p.total_capital_en_la_calle - i.total_deuda_con_inversionistas) as margen_bruto,
  (p.intereses_potenciales - i.intereses_a_pagar) as ganancia_neta_estimada,
  (p.total_capital_en_la_calle + p.monto_total_en_mora) as saldo_por_recaudar
FROM prestamos_stats p
CROSS JOIN inversiones_stats i
CROSS JOIN movimientos_stats m;

-- Vista: vista_movimientos_detalle
DROP VIEW IF EXISTS vista_movimientos_detalle;
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
  p.id as perfil_id,
  p.nombre_completo,
  p.email as perfil_email,
  p.rol as perfil_rol,
  pr.id as prestamo_id,
  pr.estado as prestamo_estado,
  pr.monto_principal as prestamo_monto,
  i.id as inversion_id,
  i.estado as inversion_estado,
  i.monto_invertido as inversion_monto
FROM movimientos m
LEFT JOIN perfiles p ON m.perfil_id = p.id
LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
LEFT JOIN inversiones i ON m.inversion_id = i.id;

-- =====================================================
-- COMENTARIOS
-- =====================================================

COMMENT ON TABLE users IS 'Usuarios para autenticación (login/password)';
COMMENT ON COLUMN users.password IS 'Contraseña encriptada con bcrypt';
COMMENT ON COLUMN users.email_confirmed_at IS 'Fecha de confirmación de email';

COMMENT ON TABLE perfiles IS 'Perfiles de usuarios (clientes, inversionistas, admin)';
COMMENT ON COLUMN perfiles.user_id IS 'Referencia al usuario de autenticación';
COMMENT ON COLUMN perfiles.rol IS 'Rol: admin, cliente, inversionista';

COMMENT ON TABLE prestamos IS 'Préstamos otorgados a clientes';
COMMENT ON COLUMN prestamos.monto_principal IS 'Monto principal del préstamo (en milunidades)';
COMMENT ON COLUMN prestamos.tasa_interes_mensual IS 'Tasa de interés mensual en porcentaje';
COMMENT ON COLUMN prestamos.tasa_mora_diaria IS 'Tasa de mora diaria en porcentaje';

COMMENT ON TABLE inversiones IS 'Inversiones recibidas de inversionistas';
COMMENT ON COLUMN inversiones.monto_invertido IS 'Monto invertido (en milunidades)';
COMMENT ON COLUMN inversiones.tasa_interes_pactada IS 'Tasa de interés pactada en porcentaje';

COMMENT ON TABLE movimientos IS 'Registro de todos los movimientos financieros';
COMMENT ON COLUMN movimientos.tipo IS 'Tipo: entrega_prestamo, pago_cliente, recibo_inversion, devolucion_inversion';
COMMENT ON COLUMN movimientos.metodo_pago IS 'Método: efectivo, transferencia, otro, liquidacion';

COMMENT ON TABLE cuotas IS 'Registro de cuotas mensuales de cada préstamo';
COMMENT ON COLUMN cuotas.capital IS 'Capital a pagar en esta cuota (milunidades)';
COMMENT ON COLUMN cuotas.interes IS 'Interés a pagar en esta cuota (milunidades)';
COMMENT ON COLUMN cuotas.total_cuota IS 'Total de la cuota = capital + interes';
COMMENT ON COLUMN cuotas.estado IS 'Estado: pendiente, pagado, parcial';

-- =====================================================
-- DATOS INICIALES (OPCIONAL)
-- =====================================================

-- Insertar usuario admin por defecto (contraseña: admin123)
-- Nota: El hash de bcrypt para 'admin123' se genera en el backend
-- INSERT INTO perfiles (nombre_completo, email, rol) 
-- VALUES ('Administrador', 'admin@ejemplo.com', 'admin');

-- =====================================================
-- FINALIZACIÓN
-- =====================================================

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Base de datos creada exitosamente';
  RAISE NOTICE '✅ Tablas: perfiles, prestamos, inversiones, movimientos, cuotas';
  RAISE NOTICE '✅ Vistas: vista_balance_general, vista_movimientos_detalle';
  RAISE NOTICE '✅ Índices y triggers creados';
END;
$$;
