require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./src/config/db');

async function run() {
  try {
    const { rows } = await db.query("SELECT pg_get_viewdef('vista_alertas_vencimientos', true)");
    console.log(rows[0].pg_get_viewdef);
  } catch (err) {
    console.error("View failed:", err.message);
  }
  process.exit(0);
}
run();
