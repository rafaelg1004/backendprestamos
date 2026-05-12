const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");

/**
 * Obtener todas las cuentas
 * GET /api/cuentas
 */
const obtenerCuentas = asyncHandler(async (req, res) => {
  const { rows } = await db.query("SELECT * FROM cuentas ORDER BY nombre ASC");
  res.json({ success: true, data: rows });
});

/**
 * Obtener una cuenta por ID
 * GET /api/cuentas/:id
 */
const obtenerCuentaPorId = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query("SELECT * FROM cuentas WHERE id = $1", [id]);

  if (rows.length === 0) {
    throw new AppError("Cuenta no encontrada", 404);
  }

  res.json({ success: true, data: rows[0] });
});

/**
 * Crear una nueva cuenta
 * POST /api/cuentas
 */
const crearCuenta = asyncHandler(async (req, res) => {
  const { nombre, tipo, saldo_inicial = 0 } = req.body;

  const { rows } = await db.query(
    "INSERT INTO cuentas (nombre, tipo, saldo_actual) VALUES ($1, $2, $3) RETURNING *",
    [nombre, tipo, saldo_inicial]
  );

  res.status(201).json({ success: true, data: rows[0] });
});

/**
 * Actualizar una cuenta
 * PUT /api/cuentas/:id
 */
const actualizarCuenta = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo } = req.body;

  const { rows } = await db.query(
    "UPDATE cuentas SET nombre = $1, tipo = $2 WHERE id = $3 RETURNING *",
    [nombre, tipo, id]
  );

  if (rows.length === 0) {
    throw new AppError("Cuenta no encontrada", 404);
  }

  res.json({ success: true, data: rows[0] });
});

/**
 * Eliminar una cuenta
 * DELETE /api/cuentas/:id
 */
const eliminarCuenta = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verificar si tiene movimientos antes de eliminar
  const { rows: movimientos } = await db.query(
    "SELECT id FROM movimientos WHERE cuenta_id = $1 LIMIT 1",
    [id]
  );

  if (movimientos.length > 0) {
    throw new AppError("No se puede eliminar una cuenta que tiene movimientos registrados", 400);
  }

  const { rowCount } = await db.query("DELETE FROM cuentas WHERE id = $1", [id]);

  if (rowCount === 0) {
    throw new AppError("Cuenta no encontrada", 404);
  }

  res.json({ success: true, message: "Cuenta eliminada correctamente" });
});

/**
 * Sincronizar el saldo de una cuenta basado en sus movimientos
 * POST /api/cuentas/:id/sincronizar
 */
const sincronizarSaldo = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // 1. Verificar que la cuenta existe
  const { rows: cuentas } = await db.query("SELECT id FROM cuentas WHERE id = $1", [id]);
  if (cuentas.length === 0) {
    throw new AppError("Cuenta no encontrada", 404);
  }

  // 2. Obtener todos los movimientos de esta cuenta
  const { rows: movimientos } = await db.query(
    "SELECT tipo, monto_total FROM movimientos WHERE cuenta_id = $1",
    [id]
  );

  // 3. Calcular el saldo real
  let nuevoSaldo = 0;
  movimientos.forEach(m => {
    const monto = parseFloat(m.monto_total);
    // Entradas: pagos de clientes y dinero de inversionistas
    const esEntrada = ["pago_cliente", "recibo_inversion"].includes(m.tipo);
    if (esEntrada) {
      nuevoSaldo += monto;
    } else {
      // Salidas: entrega de préstamos y devolución a inversionistas
      nuevoSaldo -= monto;
    }
  });

  // 4. Actualizar el saldo actual en la tabla de cuentas
  await db.query("UPDATE cuentas SET saldo_actual = $1 WHERE id = $2", [nuevoSaldo, id]);

  res.json({ 
    success: true, 
    data: { saldo_actual: nuevoSaldo },
    message: "Saldo de la cuenta sincronizado correctamente con sus movimientos" 
  });
});

module.exports = {
  obtenerCuentas,
  obtenerCuentaPorId,
  crearCuenta,
  actualizarCuenta,
  eliminarCuenta,
  sincronizarSaldo,
};

