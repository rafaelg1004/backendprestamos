
const core = require('./prestamos/core');
const pagos = require('./prestamos/pagos');
const consultas = require('./prestamos/consultas');
const documentos = require('./prestamos/documentos');

module.exports = {
  ...core,
  ...pagos,
  ...consultas,
  ...documentos,
};
