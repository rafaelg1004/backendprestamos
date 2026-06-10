require("dotenv").config();
const db = require("../src/config/db");

async function diagnostico() {
  try {
    console.log("=== DIAGNÓSTICO DE BASE DE DATOS ===\n");

    // 1. Préstamos activos con fecha de vencimiento
    console.log("1. PRÉSTAMOS ACTIVOS CON FECHA VENCIMIENTO:");
    const prestamos = await db.query(`
      SELECT p.id, p.fecha_vencimiento, p.estado, p.saldo_capital,
             pref.nombre_completo as cliente,
             CURRENT_DATE as hoy,
             p.fecha_vencimiento::date - CURRENT_DATE as dias_restantes
      FROM prestamos p
      JOIN perfiles pref ON p.cliente_id = pref.id
      WHERE p.estado = 'activo'
      ORDER BY p.fecha_vencimiento
    `);
    console.table(prestamos.rows);
    console.log(`Total préstamos activos: ${prestamos.rows.length}\n`);

    // 2. Préstamos vencidos (fecha_vencimiento < hoy)
    console.log("2. PRÉSTAMOS VENCIDOS (fecha_vencimiento < hoy):");
    const vencidos = prestamos.rows.filter(p => new Date(p.fecha_vencimiento) < new Date());
    console.table(vencidos);
    console.log(`Total préstamos vencidos: ${vencidos.length}\n`);

    // 3. Inversiones activas
    console.log("3. INVERSIONES ACTIVAS:");
    const inversiones = await db.query(`
      SELECT i.id, i.fecha_inversion, i.monto_invertido, i.tasa_interes_pactada,
             p.nombre_completo as inversionista,
             EXTRACT(DAY FROM i.fecha_inversion) as dia_inversion
      FROM inversiones i
      JOIN perfiles p ON i.inversionista_id = p.id
      WHERE i.estado = 'activo'
      ORDER BY i.fecha_inversion
    `);
    console.table(inversiones.rows);
    console.log(`Total inversiones activas: ${inversiones.rows.length}\n`);

    // 4. Últimos pagos de intereses
    console.log("4. ÚLTIMOS PAGOS DE INTERESES:");
    const pagos = await db.query(`
      SELECT m.inversion_id, m.fecha_operacion, m.monto_interes,
             p.nombre_completo as inversionista,
             EXTRACT(MONTH FROM m.fecha_operacion) as mes_pago,
             EXTRACT(YEAR FROM m.fecha_operacion) as anio_pago
      FROM movimientos m
      JOIN perfiles p ON m.perfil_id = p.id
      WHERE m.tipo = 'devolucion_inversion' AND m.monto_interes > 0
      ORDER BY m.fecha_operacion DESC
      LIMIT 20
    `);
    console.table(pagos.rows);
    console.log(`Total pagos encontrados: ${pagos.rows.length}\n`);

    // 5. Verificar pagos de junio 2026
    console.log("5. PAGOS DE JUNIO 2026:");
    const pagosJunio = await db.query(`
      SELECT m.inversion_id, m.fecha_operacion, m.monto_interes,
             p.nombre_completo as inversionista
      FROM movimientos m
      JOIN perfiles p ON m.perfil_id = p.id
      WHERE m.tipo = 'devolucion_inversion' 
        AND m.monto_interes > 0
        AND EXTRACT(MONTH FROM m.fecha_operacion) = 6
        AND EXTRACT(YEAR FROM m.fecha_operacion) = 2026
      ORDER BY m.fecha_operacion DESC
    `);
    console.table(pagosJunio.rows);
    console.log(`Total pagos en junio 2026: ${pagosJunio.rows.length}\n`);

    console.log("=== FIN DEL DIAGNÓSTICO ===");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

diagnostico();
