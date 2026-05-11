const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  try {
    console.log('--- Iniciando Migraciones ---');
    
    // 1. Crear tabla de documentos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prestamo_documentos (
          id SERIAL PRIMARY KEY,
          prestamo_id INTEGER REFERENCES prestamos(id) ON DELETE CASCADE,
          nombre_archivo TEXT NOT NULL,
          ruta_archivo TEXT NOT NULL,
          tipo_documento TEXT, 
          fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla prestamo_documentos lista.');

    // 2. Hacer email opcional
    await pool.query(`
      ALTER TABLE perfiles ALTER COLUMN email DROP NOT NULL;
    `);
    console.log('✅ Campo email ahora es opcional.');

    console.log('--- Migraciones Completadas ---');
  } catch (err) {
    console.error('❌ Error en migraciones:', err.message);
  } finally {
    await pool.end();
  }
}

runMigrations();
