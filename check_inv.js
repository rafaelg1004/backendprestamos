require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./src/config/db');

async function run() {
  try {
    console.log("Details of all movements on July 8, 2026:");
    const { rows } = await db.query(`
      SELECT m.id, m.tipo, m.monto_total, m.monto_capital, m.monto_interes, m.fecha_operacion, m.notas, m.metodo_pago,
             p.nombre_completo as perfil_nombre,
             pr.id as prestamo_id,
             (SELECT nombre_completo FROM perfiles WHERE id = pr.cliente_id) as cliente_nombre,
             m.inversion_id
      FROM movimientos m
      LEFT JOIN perfiles p ON m.perfil_id = p.id
      LEFT JOIN prestamos pr ON m.prestamo_id = pr.id
      WHERE m.fecha_operacion::date = '2026-07-08'
      ORDER BY m.fecha_operacion ASC
    `);

    for (const r of rows) {
      const valor = (parseFloat(r.monto_total) / 1000).toLocaleString('es-CO');
      const capital = (parseFloat(r.monto_capital) / 1000).toLocaleString('es-CO');
      const interes = (parseFloat(r.monto_interes) / 1000).toLocaleString('es-CO');
      const hora = new Date(r.fecha_operacion).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      console.log(`[${hora}] Tipo: ${r.tipo.padEnd(18)} | Total: ${valor.padStart(10)} | Cap: ${capital.padStart(10)} | Int: ${interes.padStart(10)} | Perfil: ${r.perfil_nombre.substring(0, 25).padEnd(25)} | Inv: ${r.inversion_id ? r.inversion_id.substring(0, 8) : 'None'.padEnd(8)} | Prestamo: ${r.prestamo_id ? r.prestamo_id.substring(0, 8) : 'None'.padEnd(8)} (Clt: ${r.cliente_nombre ? r.cliente_nombre.substring(0, 15) : 'N/A'}) | Notas: ${r.notas}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
