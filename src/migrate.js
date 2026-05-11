const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('./config/db');

async function runMigrations() {
  try {
    console.log('--- Iniciando Migraciones ---');
    
    // 1. Crear tabla de documentos
    console.log('Creando tabla prestamo_documentos...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS prestamo_documentos (
          id SERIAL PRIMARY KEY,
          prestamo_id UUID REFERENCES prestamos(id) ON DELETE CASCADE,
          nombre_archivo TEXT NOT NULL,
          ruta_archivo TEXT NOT NULL,
          tipo_documento TEXT, 
          fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Tabla prestamo_documentos lista.');

    // 2. Hacer email opcional
    console.log('Modificando campo email...');
    await db.query(`
      ALTER TABLE perfiles ALTER COLUMN email DROP NOT NULL;
    `);
    console.log('✅ Campo email ahora es opcional.');

    console.log('--- Migraciones Completadas ---');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migraciones:', err);
    process.exit(1);
  }
}

runMigrations();
