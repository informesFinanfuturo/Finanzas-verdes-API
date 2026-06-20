// index.js
const express = require('express');
const cors = require('cors');
const auth = require('./middleware/auth');
const path = require('path');
require('dotenv').config();
const rolesRoutes = require('./routes/rol.routes');
const userRoutes = require('./routes/user.routes');
const servicesRoutes = require('./routes/services.routes');
const permissionRoutes = require('./routes/permission.routes');
const loginRoutes = require('./routes/login.routes');
const clientRoutes = require('./routes/client.routes');
const asesorRoutes = require('./routes/asesor.routes');
const activoRoutes = require('./routes/activo.routes');
const consumoRoutes = require('./routes/consumo.routes');

const app = express();
app.use(cors());
app.use(express.json());

// ruta de prueba
app.get('/api/ping', (req, res) => {
  res.json({ msg: 'API ok 👌' });
});

// montar rutas de roles bajo /api/roles
app.use('/api/login', loginRoutes);
app.use('/api/rol', auth, rolesRoutes);
app.use('/api/user', auth, userRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/permission', auth, permissionRoutes);
app.use('/api/client', auth, clientRoutes);
app.use('/api/asesor', auth, asesorRoutes);
app.use('/api/activo', auth, activoRoutes);
app.use('/api/consumo', auth, consumoRoutes);

app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'))
);


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});