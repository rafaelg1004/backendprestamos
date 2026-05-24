const db = require('./src/config/db');

async function migrate() {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    
    const { rows: prestamos } = await client.query("SELECT id, fecha_inicio, fecha_ultimo_corte, notas FROM prestamos");
    
    let count = 0;
    for (const p of prestamos) {
      const oldDate = new Date(p.fecha_inicio);
      const day = oldDate.getUTCDate().toString().padStart(2, '0');
      
      // Nueva fecha: Mayo 2026, conservando el día original
      const newDateStr = `2026-05-${day}`;
      const originalDateStr = oldDate.toISOString().split('T')[0];
      
      // Anexar la fecha original a las notas
      let nuevaNota = `Fecha de inicio original: ${originalDateStr}`;
      if (p.notas) {
        nuevaNota += `\n\n${p.notas}`;
      }
      
      // Actualizar el préstamo
      // Se actualiza fecha_inicio y fecha_ultimo_corte al nuevo mes
      // Se resetea el interes_acumulado a 0 para "empezar de cero"
      await client.query(`
        UPDATE prestamos 
        SET 
          fecha_inicio = $1,
          fecha_ultimo_corte = $1,
          notas = $2,
          interes_acumulado = 0
        WHERE id = $3
      `, [newDateStr, nuevaNota, p.id]);
      
      count++;
    }
    
    await client.query("COMMIT");
    console.log(`¡Éxito! Se actualizaron ${count} préstamos. Todas las fechas de inicio se movieron a Mayo 2026 y el interés acumulado se reseteó a 0.`);
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al actualizar:", error);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
