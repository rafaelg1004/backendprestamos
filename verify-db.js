const db = require('./src/config/db');

async function verifyDatabase() {
  try {
    console.log('=== VERIFICACIÓN DE BASE DE DATOS ===\n');

    // 1. Contar perfiles
    const perfilesCount = await db.query('SELECT COUNT(*) as total FROM perfiles');
    console.log('Total perfiles:', perfilesCount.rows[0].total);

    // 2. Contar users
    const usersCount = await db.query('SELECT COUNT(*) as total FROM users');
    console.log('Total users:', usersCount.rows[0].total);

    // 3. Ver perfiles con user_id (vinculados)
    const perfilesConUser = await db.query(`
      SELECT p.id, p.nombre_completo, p.identificacion, p.user_id, p.email, p.rol
      FROM perfiles p
      WHERE p.user_id IS NOT NULL
      LIMIT 5
    `);
    console.log('\n=== PERFILES CON USUARIO VINCULADO (pueden hacer login) ===');
    console.table(perfilesConUser.rows);

    // 4. Ver perfiles SIN user_id (no pueden hacer login aún)
    const perfilesSinUser = await db.query(`
      SELECT p.id, p.nombre_completo, p.identificacion, p.email, p.rol
      FROM perfiles p
      WHERE p.user_id IS NULL
      LIMIT 5
    `);
    console.log('\n=== PERFILES SIN USUARIO (necesitan registro) ===');
    console.table(perfilesSinUser.rows);

    // 5. Ver usuarios
    const users = await db.query(`
      SELECT u.id, u.email, u.created_at
      FROM users u
      LIMIT 5
    `);
    console.log('\n=== USUARIOS EN TABLA users ===');
    console.table(users.rows);

    console.log('\n=== RESUMEN ===');
    console.log(`Perfiles con acceso: ${perfilesConUser.rows.length}`);
    console.log(`Perfiles pendientes de registro: ${perfilesSinUser.rows.length}`);
    
    if (perfilesConUser.rows.length === 0) {
      console.log('\n⚠️ No hay perfiles vinculados a usuarios. Necesitas:');
      console.log('1. Crear un perfil en /personas');
      console.log('2. Ir a /register y crear usuario con esa identificación');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit(0);
  }
}

verifyDatabase();
