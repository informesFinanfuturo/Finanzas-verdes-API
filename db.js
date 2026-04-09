// db.js
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'proyecto_ideas',   // pon el nombre de tu base
  password: '1234', // la que definiste al instalar
  port: 5432,
});

module.exports = pool;