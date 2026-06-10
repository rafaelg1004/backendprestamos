const db = require('./src/config/db');

async function fixBalances() {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    
    // Find incorrect devolucion_inversion movements
    const { rows: incorrectMovs } = await client.query(`
      SELECT m.* 
      FROM movimientos m
      JOIN cuentas c ON m.cuenta_id = c.id
      WHERE m.tipo = 'devolucion_inversion' 
        AND m.monto_interes > 0 
        AND c.tipo != 'billetera'
    `);

    console.log(`Found ${incorrectMovs.length} incorrect movements to fix`);

    for (let mov of incorrectMovs) {
      // 1. Get the billetera for this investor
      const { rows: [billetera] } = await client.query(
        "SELECT id FROM cuentas WHERE tipo = 'billetera' AND perfil_id = $1",
        [mov.perfil_id]
      );

      if (billetera) {
        // 2. Reduce the total amount on the real account movement
        await client.query(
          "UPDATE movimientos SET monto_total = monto_capital, monto_interes = 0 WHERE id = $1",
          [mov.id]
        );

        // 3. Create a new movement for the interest pointing to the billetera
        await client.query(
          `INSERT INTO movimientos (
            perfil_id, inversion_id, cuenta_id, monto_total, monto_capital, 
            monto_interes, tipo, metodo_pago, fecha_operacion, notas, usuario_id, url_captura
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            mov.perfil_id, mov.inversion_id, billetera.id, mov.monto_interes, 
            0, mov.monto_interes, 
            "devolucion_inversion", mov.metodo_pago, 
            mov.fecha_operacion, mov.notas, mov.usuario_id, mov.url_captura
          ]
        );
        console.log(`Fixed movement ${mov.id}`);
      }
    }

    await client.query("COMMIT");
    console.log("Fix completed");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
  } finally {
    client.release();
    process.exit(0);
  }
}

fixBalances();
