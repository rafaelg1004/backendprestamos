const { calcularMesesTranscurridos, calcularDiasMora, calcularDesglosePago } = require('./src/utils/calculos');

// Simular datos de prueba
const fechaInicio = '2024-06-01';
const meses = calcularMesesTranscurridos(fechaInicio);
console.log('Meses transcurridos desde 2024-06-01:', meses);

const desglose = calcularDesglosePago({
  montoPrincipal: 1000000,
  tasaInteresMensual: 10,
  mesesTranscurridos: meses,
  tasaMoraDiaria: 0.5,
  diasMora: 0
});
console.log('Desglose interés:', desglose);

// Probar con fecha de mayo 2026 (como los préstamos actuales)
const fechaMayo = '2026-05-11';
const mesesMayo = calcularMesesTranscurridos(fechaMayo);
console.log('Meses desde 2026-05-11:', mesesMayo);
