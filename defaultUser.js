// defaultUser.js
const bcrypt = require('bcrypt');
const pool = require('./db'); // usa tu pool de db.js

// Datos del usuario por defecto
const DEFAULT_USER = {
  name: 'Juan Daniel',
  email: 'juan@gmail.com',
  password: '1234', // se va a hashear
  idRol: 1,             // ajusta según tu modelo
};

async function createDefaultUser() {
  try {
    console.log('🔐 Creando usuario por defecto...');

    const email = DEFAULT_USER.email.trim().toLowerCase();

    // 1. Verificar si ya existe ese email
    // 👇 tabla "user" entre comillas porque "user" es palabra reservada en SQL
    const existing = await pool.query(
      'SELECT id FROM "user" WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      console.log('⚠️ Ya existe un usuario con ese email. No se creó otro.');
      return;
    }

    // 2. Hashear la contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(DEFAULT_USER.password, saltRounds);

    // 3. Insertar usuario
    const result = await pool.query(
      `INSERT INTO "user" (name, email, password, "idRol")
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, "idRol"`,
      [DEFAULT_USER.name, email, hashedPassword, DEFAULT_USER.idRol]
    );

    console.log('✅ Usuario creado correctamente:');
    console.log(result.rows[0]);
    console.log('➡️ Usa este email y contraseña en tu login:');
    console.log(`   email: ${DEFAULT_USER.email}`);
    console.log(`   password: ${DEFAULT_USER.password}`);
  } catch (err) {
    console.error('❌ Error al crear usuario por defecto:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

createDefaultUser();