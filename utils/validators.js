// utils/validators.js

const isDocumentoONit = (value) => {
  return /^\d{6,10}$/.test(String(value).trim());
};

const isEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isPhone = (telefono) => {
  return /^3\d{9}$/.test(telefono);
};

const isNumber = (value) => {
  return !isNaN(value) && value !== null && value !== '';
};

const isNitJuridico = (value) => {
  return /^\d{9}$/.test(String(value).trim());
};

module.exports = {
  isDocumentoONit,
  isEmail,
  isPhone,
  isNumber,
  isNitJuridico,
};