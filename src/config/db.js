const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

// Manejo de errores en la conexión
pool.on("error", (err) => {
  console.error("Error inesperado en el pool de PostgreSQL:", err);
  process.exit(-1);
});

// Inicializar tabla de blacklist si no existe
pool.query(`
  CREATE TABLE IF NOT EXISTS token_blacklist (
    token TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS single_use_tokens (
    token TEXT PRIMARY KEY,
    ruta_archivo TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL
  );
`).catch(err => console.error("Error creando tablas iniciales:", err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  pool,
};
