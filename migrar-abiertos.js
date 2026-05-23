const db = require('./src/config/db');

async function migrar() {
  const client = await db.pool.connect();
  try {
    console.log("Iniciando migración a préstamos de capital abierto...");
    await client.query("BEGIN");

    // 1. Agregar columnas a prestamos si no existen
    console.log("1. Modificando tabla prestamos...");
    await client.query(`
      ALTER TABLE prestamos 
      ADD COLUMN IF NOT EXISTS saldo_capital NUMERIC(20, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS interes_acumulado NUMERIC(20, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS fecha_ultimo_corte DATE
    `);

    // Actualizar los préstamos existentes para que saldo_capital = monto_principal y fecha_ultimo_corte = fecha_inicio
    await client.query(`
      UPDATE prestamos 
      SET saldo_capital = monto_principal, 
          fecha_ultimo_corte = fecha_inicio 
      WHERE saldo_capital = 0 OR fecha_ultimo_corte IS NULL
    `);

    // 2. Modificar prestamo_fondos para intereses
    console.log("2. Modificando prestamo_fondos...");
    await client.query(`
      ALTER TABLE prestamo_fondos 
      ADD COLUMN IF NOT EXISTS interes_devuelto NUMERIC(20, 2) DEFAULT 0
    `);

    // 3. Eliminar la tabla cuotas (ya que nadie ha pagado y la lógica se reemplaza)
    console.log("3. Eliminando tabla cuotas...");
    await client.query("DROP TABLE IF EXISTS cuotas CASCADE");

    await client.query("COMMIT");
    console.log("¡Migración completada exitosamente!");
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error durante la migración:", error);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrar();
