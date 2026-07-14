require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./src/config/db');

async function run() {
  try {
    console.log("Buscando clientes que no tienen ningún préstamo en el sistema...");

    const { rows } = await db.query(`
      SELECT p.id, p.nombre_completo, p.identificacion, p.telefono, p.fecha_registro
      FROM perfiles p
      WHERE p.rol = 'cliente'
        AND NOT EXISTS (
          SELECT 1 FROM prestamos pr WHERE pr.cliente_id = p.id
        )
      ORDER BY p.nombre_completo
    `);

    console.log(`Se encontraron ${rows.length} clientes sin préstamos:`);
    rows.forEach(c => {
      console.log(`- Nombre: ${c.nombre_completo} | Cédula: ${c.identificacion || 'N/A'} | Tel: ${c.telefono || 'N/A'} | Creado: ${new Date(c.fecha_registro).toLocaleString('es-CO')}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
