// controllers/roles.controller.js
const pool = require('../db');
const bcrypt = require('bcrypt');

// GET /api/user
async function getUsers(req, res) {
  try {
    const result = await pool.query('SELECT * FROM "user" ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
}

// GET /api/user/mipyme
async function getUsersMipyme(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT u.*, m.*
      FROM "user" u JOIN
      mypime m ON m."iduser" = u.id
      `
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
}

async function getUsersEntrepreneur(req, res) {
  try {
    const result = await pool.query(
      `
      SELECT u.*, e.*
      FROM "user" u JOIN
      entrepreneur e ON e."idUser" = u.id
      `
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener los usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
}


async function loginUser(req, res) {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y contraseña son obligatorios',
      });
    }

    const result = await pool.query(
      `SELECT u.id,
              u.email,
              u.password,
              u.name,
              r.id   AS "roleId",
              r.name AS "roleName"
      FROM "user" u
      JOIN rol r ON u."idRol" = r.id
      WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Credenciales inválidas',
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      // Contraseña incorrecta
      return res.status(401).json({
        error: 'Credenciales inválidas',
      });
    }

    // 4. Si todo ok, puedes devolver los datos del usuario (sin password)
    
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        rol: {                  // <- en lugar de idRol
          id: user.roleId,
          name: user.roleName
        }
      },
      message: 'Login exitoso'
    });

  } catch (err) {
    console.error('Error en loginUser:', err);
    return res.status(500).json({
      error: 'Error interno al iniciar sesión',
    });
  }
}


// POST /api/user

async function createUser(req, res) {
  const { name, email, password, idRol } = req.body;

  try {
    // 1. Validaciones básicas
    if (!name || !email || !password || !idRol) {
      return res.status(400).json({
        error: 'name, email, password e idRol son obligatorios',
      });
    }

    // 2. Verificar si ya existe un usuario con ese email
    const existing = await pool.query(
      'SELECT id FROM "user" WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese email',
      });
    }

    // 3. Hashear la contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 4. Insertar usuario en la BD
    const result = await pool.query(
      `INSERT INTO "user" (name, email, password, "idRol")
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, "idRol"`,
      [name.trim(), email.trim(), hashedPassword, idRol]
    );

    const newUser = result.rows[0];

    // 5. Responder al cliente (nunca se envía el password)
    return res.status(201).json({
      message: 'Usuario creado correctamente',
      user: newUser,
    });
  } catch (err) {
    console.error('Error al registrar usuario:', err);
    return res.status(500).json({
      error: 'Error interno al registrar usuario',
    });
  }
}

// PUT /api/user/:id
async function updateUser(req, res) {
  const { id } = req.params; // id del usuario a editar
  const { name, email, idRol } = req.body; // NO recibimos password

  try {
    // 1. Validaciones básicas
    if (!id) {
      return res.status(400).json({
        error: 'El id del usuario es obligatorio en la URL',
      });
    }

    if (!name || !email || !idRol) {
      return res.status(400).json({
        error: 'name, email e idRol son obligatorios',
      });
    }

    // 2. Verificar que el usuario exista
    const existingUser = await pool.query(
      'SELECT id FROM "user" WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({
        error: 'Usuario no encontrado',
      });
    }

    // 3. Verificar que no exista otro usuario con el mismo email
    const emailInUse = await pool.query(
      'SELECT id FROM "user" WHERE email = $1 AND id <> $2',
      [email, id]
    );

    if (emailInUse.rows.length > 0) {
      return res.status(409).json({
        error: 'Ya existe otro usuario con ese email',
      });
    }

    // 4. Actualizar solo name, email e idRol (NO password)
    const result = await pool.query(
      `UPDATE "user"
       SET name = $1,
           email = $2,
           "idRol" = $3
       WHERE id = $4
       RETURNING id, name, email, "idRol"`,
      [name.trim(), email.trim(), idRol, id]
    );

    const updatedUser = result.rows[0];

    // 5. Responder al cliente
    return res.status(200).json({
      message: 'Usuario actualizado correctamente',
      user: updatedUser,
    });
  } catch (err) {
    console.error('Error al actualizar usuario:', err);
    return res.status(500).json({
      error: 'Error interno al actualizar usuario',
    });
  }
}



async function changeUserPassword(req, res) {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!id || !newPassword) {
    return res.status(400).json({ error: "id y newPassword son obligatorios" });
  }

  try {
    // 1) Hashear la nueva contraseña
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // 2) Reemplazar en BD
    const result = await pool.query(
      `UPDATE "user"
       SET "password" = $1
       WHERE id = $2
       RETURNING id, name, email`,
      [passwordHash, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(200).json({
      ok: true,
      message: "Contraseña actualizada correctamente",
      user: result.rows[0],
    });

  } catch (err) {
    console.error("Error cambiando contraseña:", err);
    return res.status(500).json({ error: "Error al cambiar la contraseña" });
  }
}



module.exports = {
  getUsers,
  loginUser,
  createUser,
  updateUser,
  getUsersMipyme,
  changeUserPassword,
  getUsersEntrepreneur
};