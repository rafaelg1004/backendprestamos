require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function run() {
  try {
    const res = await pool.query('SELECT id, nombre, saldo_actual FROM cuentas');
    console.log("Cuentas actuales:", res.rows);
    
    // Calcular el saldo correcto desde movimientos
    const resMovs = await pool.query(`
      SELECT cuenta_id, tipo, SUM(monto_total) as total
      FROM movimientos
      GROUP BY cuenta_id, tipo
    `);
    console.log("Sumatoria de movimientos:", resMovs.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
