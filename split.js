const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'controllers', 'prestamosController.js');
const sourceCode = fs.readFileSync(filePath, 'utf-8');

const targetDir = path.join(__dirname, 'src', 'controllers', 'prestamos');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir);
}

// We will split into:
// 1. core.js (crearPrestamo, obtenerPrestamos, obtenerPrestamo, actualizarPrestamo, eliminarPrestamo, obtenerFiltros)
// 2. pagos.js (calcularLiquidacion, pagarPrestamo, pagarCuota)
// 3. consultas.js (obtenerPrestamosMora, obtenerPrestamosPorCedula)
// 4. documentos.js (prepararCarpetaPrestamo, subirDocumento, obtenerDocumentos, eliminarDocumento)

const header = `const db = require("../../config/db");
const fs = require("fs");
const path = require("path");
const { asyncHandler, AppError } = require("../../middleware/errorHandler");
const {
  calcularDiasMora,
  calcularInteresSimple,
  calcularMora,
  calcularCuotaMensual,
  generarTablaAmortizacion,
  calcularDesglosePago,
  calcularMesesTranscurridos,
  formatearMoneda,
  deMilunidades,
} = require("../../utils/calculos");
`;

function extractFunction(name) {
  // Finds `const name = asyncHandler(async (req, res) => { ... });`
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*asyncHandler\\(async\\s*\\(req,\\s*res(?:,\\s*next)?\\)\\s*=>\\s*\\{[\\s\\S]*?\\}\\);`, 'm');
  const match = sourceCode.match(regex);
  if (!match) {
      console.log(`Could not find function ${name}`);
      return '';
  }
  
  // also extract the JSDoc above it if any
  const beforeStr = sourceCode.substring(0, match.index);
  const commentMatch = beforeStr.match(/\/\*\*[\s\S]*?\*\/[ \t]*$/);
  
  let result = '';
  if (commentMatch) {
    result += commentMatch[0] + '\n';
  }
  result += match[0] + '\n\n';
  return result;
}

const coreFns = ['crearPrestamo', 'obtenerPrestamos', 'obtenerPrestamo', 'actualizarPrestamo', 'eliminarPrestamo', 'obtenerFiltros'];
const pagosFns = ['calcularLiquidacion', 'pagarPrestamo', 'pagarCuota'];
const consultasFns = ['obtenerPrestamosMora', 'obtenerPrestamosPorCedula'];
const docFns = ['prepararCarpetaPrestamo', 'subirDocumento', 'obtenerDocumentos', 'eliminarDocumento'];

fs.writeFileSync(path.join(targetDir, 'core.js'), header + '\n' + coreFns.map(extractFunction).join(''));
fs.writeFileSync(path.join(targetDir, 'pagos.js'), header + '\n' + pagosFns.map(extractFunction).join(''));
fs.writeFileSync(path.join(targetDir, 'consultas.js'), header + '\n' + consultasFns.map(extractFunction).join(''));
fs.writeFileSync(path.join(targetDir, 'documentos.js'), header + '\n' + docFns.map(extractFunction).join(''));

const exportsContent = `
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
`;

fs.writeFileSync(filePath, exportsContent);

console.log("Split complete!");
