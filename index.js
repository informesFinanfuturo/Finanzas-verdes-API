// index.js
const express = require('express');
const cors = require('cors');
const rolesRoutes = require('./routes/rol.routes');
const userRoutes = require('./routes/user.routes');
const processRoutes = require('./routes/process.routes');
const visitRoutes = require('./routes/visit.routes');
const mypimeRoutes = require('./routes/mypime.routes');
const sectionRoutes = require('./routes/section.routes');
const questionRoutes = require('./routes/question.routes');
const answerRoutes = require('./routes/answer.routes');
const diagnosisRoutes = require('./routes/diagnosis.routes');
const servicesRoutes = require('./routes/services.routes');
const workPlanRoutes = require('./routes/workPlan.routes');
const taskRoutes = require('./routes/task.routes');
const entrepreneurRoutes = require('./routes/entrepreneur.routes');

const app = express();
app.use(cors());
app.use(express.json());

// ruta de prueba
app.get('/api/ping', (req, res) => {
  res.json({ msg: 'API ok 👌' });
});

// montar rutas de roles bajo /api/roles
app.use('/api/rol', rolesRoutes);
app.use('/api/user', userRoutes);
app.use('/api/process', processRoutes);
app.use('/api/visit', visitRoutes);
app.use('/api/mypime', mypimeRoutes);
app.use('/api/section', sectionRoutes);
app.use('/api/question', questionRoutes);
app.use('/api/answer', answerRoutes);
app.use('/api/diagnosis', diagnosisRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/workPlan', workPlanRoutes);
app.use('/api/task', taskRoutes);
app.use('/api/entrepreneur', entrepreneurRoutes);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});