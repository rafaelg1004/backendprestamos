const db = require('./src/config/db');

async function migrar() {
  const client = await db.pool.connect();
  try {
    console.log("Iniciando creación de billeteras ficticias...");
    await client.query("BEGIN");

    // 1. Agregar perfil_id a cuentas
    console.log("1. Modificando tabla cuentas...");
    await client.query(`
      ALTER TABLE cuentas 
      ADD COLUMN IF NOT EXISTS perfil_id UUID REFERENCES perfiles(id) ON DELETE CASCADE
    `);

    // 2. Obtener todos los inversionistas y el admin
    const { rows: perfiles } = await client.query(`
      SELECT id, nombre_completo, rol FROM perfiles 
      WHERE rol IN ('inversionista', 'admin')
    `);

    // 3. Crear billeteras si no existen
    console.log("2. Creando billeteras...");
    for (const perfil of perfiles) {
      // Chequear si ya tiene billetera
      const { rows: billeteras } = await client.query(`
        SELECT id FROM cuentas WHERE perfil_id = $1 AND tipo = 'billetera'
      `, [perfil.id]);

      if (billeteras.length === 0) {
        const nombreBilletera = perfil.rol === 'admin' 
          ? `Billetera de Ganancias Admin` 
          : `Billetera Intereses - ${perfil.nombre_completo}`;
          
        await client.query(`
          INSERT INTO cuentas (nombre, tipo, saldo_actual, perfil_id)
          VALUES ($1, 'billetera', 0, $2)
        `, [nombreBilletera, perfil.id]);
      }
    }

    await client.query("COMMIT");
    console.log("¡Migración de billeteras completada exitosamente!");
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error durante la migración:", error);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrar();
