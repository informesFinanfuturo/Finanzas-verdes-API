const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1️⃣ Verificar header
  if (!authHeader) {
    return res.status(401).json({
      error: 'Token requerido',
    });
  }

  // 2️⃣ Extraer token
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({
      error: 'Token mal formado',
    });
  }

  // 3️⃣ Verificar token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Usuario disponible en TODOS los endpoints protegidos
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Token inválido o expirado',
    });
  }
}

module.exports = auth;
