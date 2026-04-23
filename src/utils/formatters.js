/**
 * Utilidades para formateo de datos
 */

/**
 * Formatea una fecha a string ISO
 * @param {Date|string} fecha 
 * @returns {string} Fecha en formato ISO
 */
function formatearFechaISO(fecha) {
  const date = new Date(fecha);
  return date.toISOString();
}

/**
 * Formatea una fecha a formato local
 * @param {Date|string} fecha 
 * @returns {string} Fecha formateada
 */
function formatearFechaLocal(fecha) {
  const date = new Date(fecha);
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Genera un número de referencia único para pagos
 * @param {string} prefijo - Prefijo del tipo de movimiento
 * @returns {string} Referencia única
 */
function generarReferenciaPago(prefijo = 'REF') {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefijo}-${timestamp}-${random}`;
}

/**
 * Sanitiza un string para prevenir XSS
 * @param {string} str 
 * @returns {string} String sanitizado
 */
function sanitizarString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '')
    .trim();
}

/**
 * Valida que un email tenga formato correcto
 * @param {string} email 
 * @returns {boolean}
 */
function esEmailValido(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Valida que un teléfono tenga formato básico
 * @param {string} telefono 
 * @returns {boolean}
 */
function esTelefonoValido(telefono) {
  const regex = /^[\d\s\-\+\(\)]{7,20}$/;
  return regex.test(telefono);
}

module.exports = {
  formatearFechaISO,
  formatearFechaLocal,
  generarReferenciaPago,
  sanitizarString,
  esEmailValido,
  esTelefonoValido
};
