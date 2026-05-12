const db = require("./src/config/db");
const fs = require("fs");
const path = require("path");

async function applyTrigger() {
  const sqlPath = path.join(__dirname, "migrations", "20260512_trigger_saldo.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  try {
    console.log("Aplicando trigger a la base de datos...");
    await db.query(sql);
    console.log("¡Trigger aplicado exitosamente!");
    process.exit(0);
  } catch (error) {
    console.error("Error aplicando el trigger:", error);
    process.exit(1);
  }
}

applyTrigger();
