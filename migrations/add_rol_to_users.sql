-- Agregar campo 'rol' a la tabla users existente
ALTER TABLE users ADD COLUMN IF NOT EXISTS rol VARCHAR(50) DEFAULT 'cliente';

-- Actualizar usuarios existentes a rol 'cliente'
UPDATE users SET rol = 'cliente' WHERE rol IS NULL OR rol = '';

-- Crear usuario admin por defecto si no existe
-- Primero verificar si existe el email
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@prestamos.com') THEN
    INSERT INTO users (email, password, rol, creado_en)
    VALUES (
      'admin@prestamos.com',
      '$2b$10$rZQ5Y8Z8Z8Z8Z8Z8Z8Z8ZeQ5Y8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z', -- admin123
      'admin',
      NOW()
    );
  END IF;
END $$;

-- Índice para el campo rol
CREATE INDEX IF NOT EXISTS idx_users_rol ON users(rol);
