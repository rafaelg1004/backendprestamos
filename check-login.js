const db = require('./src/config/db');

async function check() {
  try {
    const r = await db.query(`
      SELECT p.identificacion, p.nombre_completo, p.email, p.rol, p.user_id 
      FROM perfiles p 
      WHERE p.user_id IS NOT NULL
    `);
    
    console.log('\n=== PERFILES CON LOGIN HABILITADO ===\n');
    if (r.rows.length === 0) {
      console.log('No hay perfiles con usuario vinculado.\n');
      console.log('Para crear uno:');
      console.log('1. Crear perfil en /personas');
      console.log('2. Ir a /register y registrar con la misma identificación');
    } else {
      r.rows.forEach(row => {
        console.log('Identificación:', row.identificacion);
        console.log('Nombre:', row.nombre_completo);
        console.log('Email:', row.email);
        console.log('Rol:', row.rol);
        console.log('---');
      });
      console.log('\nUsa la Identificación para login en /login');
    }
    
    // Ver perfiles SIN user
    const r2 = await db.query(`
      SELECT p.identificacion, p.nombre_completo, p.email, p.rol
      FROM perfiles p 
      WHERE p.user_id IS NULL
    `);
    
    console.log('\n=== PERFILES PENDIENTES DE REGISTRO ===\n');
    if (r2.rows.length === 0) {
      console.log('No hay perfiles pendientes.\n');
    } else {
      r2.rows.forEach(row => {
        console.log('Identificación:', row.identificacion);
        console.log('Nombre:', row.nombre_completo);
        console.log('Email:', row.email);
        console.log('---');
      });
      console.log('\nVe a /register para vincular estos perfiles');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

check();
