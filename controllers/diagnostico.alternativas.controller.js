'use strict';
const pool = require('../db');
const { accesoMipyme } = require('../services/accesoMipyme');
const { crearObtenerAlternativas } = require('../services/diagnosticoAlternativas');

const obtenerAlternativas = crearObtenerAlternativas({db: pool, accesoMipyme});
module.exports = {obtenerAlternativas};
