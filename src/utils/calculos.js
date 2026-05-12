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

  // Redondeo al millar más cercano (ej: 562.964 -> 563.000)
  return Math.round(cuota / 1000) * 1000;
}

/**
 * Genera tabla de amortización completa
 * @param {number} montoPrincipal - Capital en milunidades
 * @param {number} tasaInteresMensual - Tasa mensual en porcentaje
 * @param {number} meses - Plazo en meses
 * @param {string} tipo - 'frances' o 'flat'
 * @returns {Array} Array con desglose de cada cuota
 */
function generarTablaAmortizacion(
  montoPrincipal,
  tasaInteresMensual,
  plazo,
  tipo = "frances",
  frecuencia = "mensual"
) {
  const tasaMensual = tasaInteresMensual / 100;
  const tabla = [];

  // Multiplicador solo para ajustar la TASA según la frecuencia
  let multiplier = 1;
  if (frecuencia === "diario") multiplier = 30;
  else if (frecuencia === "semanal") multiplier = 4;
  else if (frecuencia === "quincenal") multiplier = 2;

  const n = Math.max(1, parseInt(plazo));
  const r = tasaMensual / multiplier;

  if (tipo === "flat") {
    // El interés total se calcula basado en el tiempo real (n cuotas / multiplicador = meses reales)
    const totalInteresPlan = Math.round((montoPrincipal * tasaMensual * (n / multiplier)) / 1000) * 1000;
    const capitalCuotaBase = Math.round((montoPrincipal / n) / 1000) * 1000;
    const interesCuotaBase = Math.round((totalInteresPlan / n) / 1000) * 1000;
    
    let saldoCapital = montoPrincipal;
    let saldoInteres = totalInteresPlan;

    for (let mes = 1; mes <= n; mes++) {
      let currentCapital = capitalCuotaBase;
      let currentInteres = interesCuotaBase;

      if (mes === n) {
        currentCapital = saldoCapital;
        currentInteres = saldoInteres;
      } else {
        currentCapital = Math.min(currentCapital, saldoCapital);
        currentInteres = Math.min(currentInteres, saldoInteres);
      }

      saldoCapital -= currentCapital;
      saldoInteres -= currentInteres;

      tabla.push({
        mes,
        cuota: currentCapital + currentInteres,
        capital: currentCapital,
        interes: currentInteres,
        saldo: Math.max(0, saldoCapital),
      });
    }
  } else {
    // Sistema Francés
    const cuotaBase = Math.round((montoPrincipal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1) / 1000) * 1000;
    let saldoCapital = montoPrincipal;

    for (let mes = 1; mes <= n; mes++) {
      let interes = Math.round((saldoCapital * r) / 1000) * 1000;
      let capital = cuotaBase - interes;
      
      if (mes === n) {
        capital = saldoCapital;
      }
      
      saldoCapital = Math.max(0, saldoCapital - capital);

      tabla.push({
        mes,
        cuota: capital + interes,
        capital,
        interes,
        saldo: saldoCapital,
      });
    }
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
 * @param {string} moneda - Código de moneda (default: COP)
 * @returns {string} Monto formateado
 */
function formatearMoneda(montoMilunidades, moneda = "COP") {
  const monto = montoMilunidades / 1000;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
