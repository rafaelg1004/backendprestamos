const db = require('./src/config/db');

async function run() {
  try {
    await db.query("ALTER TABLE prestamo_fondos ADD COLUMN IF NOT EXISTS capital_devuelto NUMERIC DEFAULT 0");
    console.log("Column added successfully");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
