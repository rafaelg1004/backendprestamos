const db = require('./src/config/db');

async function fixDates() {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    
    // Obtener la fecha de hoy para comparar (ignorar hora)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { rows: prestamos } = await client.query("SELECT id, fecha_ultimo_corte FROM prestamos");
    
    let count = 0;
    for (const p of prestamos) {
      const corteDate = new Date(p.fecha_ultimo_corte);
      
      // Si la fecha de corte que le pusimos (Mayo) es en el futuro (después de hoy)
      if (corteDate > today) {
        // Necesitamos restarle 1 mes para que quede en Abril
        const newDate = new Date(corteDate);
        newDate.setMonth(newDate.getMonth() - 1);
        
        const newDateStr = newDate.toISOString().split('T')[0];
        
        await client.query(`
          UPDATE prestamos 
          SET 
            fecha_inicio = $1,
            fecha_ultimo_corte = $1
          WHERE id = $2
        `, [newDateStr, p.id]);
        
        count++;
      }
    }
    
    await client.query("COMMIT");
    console.log(`¡Éxito! Se corrigieron ${count} préstamos, pasándolos a Abril.`);
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al corregir:", error);
  } finally {
    client.release();
    process.exit(0);
  }
}

fixDates();
