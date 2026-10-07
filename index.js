// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const auth = require('./middleware/auth');
const path = require('path');
const rolesRoutes = require('./routes/rol.routes');
const userRoutes = require('./routes/user.routes');
const servicesRoutes = require('./routes/services.routes');
const permissionRoutes = require('./routes/permission.routes');
const loginRoutes = require('./routes/login.routes');
const clientRoutes = require('./routes/client.routes');
const asesorRoutes = require('./routes/asesor.routes'); 
const activoRoutes = require('./routes/activo.routes');
const consumoRoutes = require('./routes/consumo.routes');
const proveedorRoutes = require('./routes/proveedor.routes');
const catalogoRoutes = require('./routes/catalogo.routes');
const diagnosticoRoutes = require('./routes/diagnostico.routes');
const planTrabajoRoutes = require('./routes/plan.trabajo.routes');
const calendarioRoutes = require('./routes/calendario.routes');
const prospectoRoutes = require('./routes/prospecto.routes');

const app = express();
app.use(cors());
app.use(express.json());

// ruta de prueba
app.get('/api/ping', (req, res) => {
  res.json({ msg: 'API FINANZAS VERDES ok 👌' });
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
app.use('/api/proveedor', auth, proveedorRoutes);
app.use('/api/catalogo', auth, catalogoRoutes);
app.use('/api/diagnostico', auth, diagnosticoRoutes);
app.use('/api/plantrabajo', auth, planTrabajoRoutes);
app.use('/api/calendario', auth, calendarioRoutes);
app.use('/api/prospecto', auth, prospectoRoutes);

app.use(
  '/uploads',
  express.static(path.join(__dirname, 'uploads'))
);


const PORT = 4000;

const {
  iniciarScheduler
} = require('./services/scheduler');
 
iniciarScheduler();

app.listen(PORT, () => {
  console.log(`Servidor finanzas verdes escuchando en http://localhost:${PORT}`);
});