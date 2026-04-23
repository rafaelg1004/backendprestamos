const db = require('./src/config/db');

async function check() {
  try {
    // Todos los usuarios con su perfil vinculado
    const r = await db.query(`
      SELECT u.email, u.id as user_id, p.identificacion, p.nombre_completo, p.rol
      FROM users u
      LEFT JOIN perfiles p ON u.id = p.user_id
      ORDER BY u.created_at
    `);
    
    console.log('=== VINCULACIÓN USUARIOS ↔ PERFILES ===\n');
    console.log('Total usuarios:', r.rows.length);
    console.log('');
    
    r.rows.forEach((row, i) => {
      console.log((i+1) + '. Email: ' + row.email);
      console.log('   User ID: ' + row.user_id);
      if (row.identificacion) {
        console.log('   ✓ VINCULADO a perfil:');
        console.log('     - Identificación: ' + row.identificacion);
        console.log('     - Nombre: ' + row.nombre_completo);
        console.log('     - Rol: ' + row.rol);
        console.log('     → Puede hacer login con: ' + row.identificacion);
      } else {
        console.log('   ✗ NO vinculado a ningún perfil');
        console.log('     → No puede hacer login (no tiene identificación)');
      }
      console.log('');
    });
    
    // Perfiles sin usuario
    const r2 = await db.query(`
      SELECT p.identificacion, p.nombre_completo, p.email, p.rol
      FROM perfiles p
      WHERE p.user_id IS NULL
    `);
    
    console.log('=== PERFILES SIN USUARIO (pendientes de registro) ===\n');
    if (r2.rows.length === 0) {
      console.log('No hay perfiles pendientes.\n');
    } else {
      console.log('Total:', r2.rows.length);
      r2.rows.forEach((row, i) => {
        console.log((i+1) + '. ' + row.nombre_completo);
        console.log('   Email: ' + row.email);
        console.log('   Identificación: ' + row.identificacion);
        console.log('   Rol: ' + row.rol);
        console.log('');
      });
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

check();
