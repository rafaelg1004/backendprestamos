/**
 * Utilidades para cálculos financieros
 * Todas las cantidades se manejan en milunidades (ej: 1000 = $1.00)
 */

/**
 * Calcula los días de retraso entre la fecha de vencimiento y hoy
 * @param {Date|string} fechaVencimiento
 * @returns {number} Días de retraso (0 si no hay retraso)
 */
function calcularDiasMora(fechaVencimiento) {
  const hoy = new Date();
  const vencimiento = new Date(fechaVencimiento);

  // Resetear horas para comparar solo fechas
  hoy.setHours(0, 0, 0, 0);
  vencimiento.setHours(0, 0, 0, 0);

  const diffTime = hoy - vencimiento;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : 0;
}

/**
 * Calcula el interés simple mensual
 * @param {number} montoPrincipal - En milunidades
 * @param {number} tasaInteresMensual - Porcentaje (ej: 5 para 5%)
 * @param {number} meses - Cantidad de meses
 * @returns {number} Interés calculado en milunidades
 */
function calcularInteresSimple(montoPrincipal, tasaInteresMensual, meses) {
  return Math.round(montoPrincipal * (tasaInteresMensual / 100) * meses);
}

/**
 * Calcula la mora acumulada
 * @param {number} montoPrincipal - En milunidades
 * @param {number} tasaMoraDiaria - Porcentaje diario (ej: 0.5 para 0.5%)
 * @param {number} diasMora - Días de retraso
 * @returns {number} Mora calculada en milunidades
 */
function calcularMora(montoPrincipal, tasaMoraDiaria, diasMora) {
  if (diasMora <= 0) return 0;
  return Math.round(montoPrincipal * (tasaMoraDiaria / 100) * diasMora);
}

/**
 * Calcula la cuota mensual fija (sistema francés)
 * @param {number} montoPrincipal - Capital en milunidades
 * @param {number} tasaInteresMensual - Tasa mensual en porcentaje (ej: 5 para 5%)
 * @param {number} meses - Plazo en meses
 * @returns {number} Cuota mensual en milunidades
 */
function calcularCuotaMensual(montoPrincipal, tasaInteresMensual, meses) {
  if (meses <= 0 || tasaInteresMensual <= 0) return montoPrincipal;

  const i = tasaInteresMensual / 100; // Convertir a decimal
  const n = meses;

  // Fórmula: Cuota = P * (i * (1+i)^n) / ((1+i)^n - 1)
  const cuota =
    (montoPrincipal * (i * Math.pow(1 + i, n))) / (Math.pow(1 + i, n) - 1);

  return Math.round(cuota);
}

/**
 * Genera tabla de amortización completa
 * @param {number} montoPrincipal - Capital en milunidades
 * @param {number} tasaInteresMensual - Tasa mensual en porcentaje
 * @param {number} meses - Plazo en meses
 * @returns {Array} Array con desglose de cada cuota
 */
function generarTablaAmortizacion(montoPrincipal, tasaInteresMensual, meses) {
  const cuota = calcularCuotaMensual(montoPrincipal, tasaInteresMensual, meses);
  const i = tasaInteresMensual / 100;
  let saldo = montoPrincipal;
  const tabla = [];

  for (let mes = 1; mes <= meses; mes++) {
    const interes = Math.round(saldo * i);
    const capital = cuota - interes;
    saldo = Math.max(0, saldo - capital);

    tabla.push({
      mes,
      cuota,
      capital,
      interes,
      saldo,
    });
  }

  return tabla;
}

/**
 * Calcula el desglose de un pago: capital, interés y mora
 * @param {Object} params
 * @param {number} params.montoPrincipal - Monto original del préstamo
 * @param {number} params.tasaInteresMensual - Tasa de interés mensual
 * @param {number} params.mesesTranscurridos - Meses desde el inicio
 * @param {number} params.tasaMoraDiaria - Tasa de mora diaria
 * @param {number} params.diasMora - Días de retraso
 * @returns {Object} Desglose del pago
 */
function calcularDesglosePago({
  montoPrincipal,
  tasaInteresMensual,
  mesesTranscurridos,
  tasaMoraDiaria,
  diasMora,
}) {
  const interes = calcularInteresSimple(
    montoPrincipal,
    tasaInteresMensual,
    mesesTranscurridos,
  );
  const mora = calcularMora(montoPrincipal, tasaMoraDiaria, diasMora);
  const total = montoPrincipal + interes + mora;

  return {
    capital: montoPrincipal,
    interes,
    mora,
    total,
  };
}

/**
 * Calcula el retorno de una inversión
 * @param {number} montoInvertido - En milunidades
 * @param {number} tasaInteresPactada - Tasa acordada con el inversionista
 * @param {number} meses - Periodo de la inversión
 * @returns {Object} Desglose del retorno
 */
function calcularRetornoInversion(montoInvertido, tasaInteresPactada, meses) {
  const interesGenerado = calcularInteresSimple(
    montoInvertido,
    tasaInteresPactada,
    meses,
  );
  const totalRetorno = montoInvertido + interesGenerado;

  return {
    capital: montoInvertido,
    interes: interesGenerado,
    total: totalRetorno,
  };
}

/**
 * Calcula meses transcurridos entre dos fechas
 * @param {Date|string} fechaInicio
 * @param {Date|string} fechaFin
 * @returns {number} Meses transcurridos (mínimo 1)
 */
function calcularMesesTranscurridos(fechaInicio, fechaFin = new Date()) {
  const inicio = new Date(fechaInicio);
  const fin = new Date(fechaFin);

  const meses =
    (fin.getFullYear() - inicio.getFullYear()) * 12 +
    (fin.getMonth() - inicio.getMonth());

  return Math.max(1, meses);
}

/**
 * Formatea una cantidad en milunidades a moneda
 * @param {number} montoMilunidades
 * @param {string} moneda - Código de moneda (default: USD)
 * @returns {string} Monto formateado
 */
function formatearMoneda(montoMilunidades, moneda = "USD") {
  const monto = montoMilunidades / 1000;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: 2,
  }).format(monto);
}

/**
 * Convierte de moneda a milunidades
 * @param {number} monto - Monto en unidades (ej: 100.50)
 * @returns {number} Monto en milunidades (ej: 100500)
 */
function aMilunidades(monto) {
  return Math.round(monto * 1000);
}

/**
 * Convierte de milunidades a unidades
 * @param {number} montoMilunidades
 * @returns {number} Monto en unidades
 */
function deMilunidades(montoMilunidades) {
  return montoMilunidades / 1000;
}

module.exports = {
  calcularDiasMora,
  calcularInteresSimple,
  calcularMora,
  calcularCuotaMensual,
  generarTablaAmortizacion,
  calcularDesglosePago,
  calcularRetornoInversion,
  calcularMesesTranscurridos,
  formatearMoneda,
  aMilunidades,
  deMilunidades,
};
