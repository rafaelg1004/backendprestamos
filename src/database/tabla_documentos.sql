-- Crear tabla para almacenar documentos de préstamos
CREATE TABLE IF NOT EXISTS prestamo_documentos (
    id SERIAL PRIMARY KEY,
    prestamo_id INTEGER REFERENCES prestamos(id) ON DELETE CASCADE,
    nombre_archivo TEXT NOT NULL,
    ruta_archivo TEXT NOT NULL,
    tipo_documento TEXT, -- 'cedula', 'letra', 'pagare', 'otro'
    fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
