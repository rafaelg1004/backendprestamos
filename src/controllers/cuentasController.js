const db = require("../config/db");
const { asyncHandler, AppError } = require("../middleware/errorHandler");

/**
 * Obtener todas las cuentas
 * GET /api/cuentas
 */
const obtenerCuentas = asyncHandler(async (req, res) => {
  const { incluir_billeteras } = req.query;
  let query = "SELECT * FROM cuentas";
  if (incluir_billeteras !== 'true') {
    query += " WHERE tipo != 'billetera'";
  }
  query += " ORDER BY nombre ASC";
  const { rows } = await db.query(query);
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

  const cuenta = rows[0];

  // Si la cuenta pertenece a un perfil (billetera), buscar rendimientos de sus inversiones
  if (cuenta.perfil_id) {
    const { rows: rendimientos } = await db.query(`
      SELECT 
        i.id as inversion_id,
        i.fecha_inversion,
        i.monto_invertido,
        COALESCE(SUM(pf.interes_devuelto), 0) as total_ganado
      FROM inversiones i
      LEFT JOIN prestamo_fondos pf ON i.id = pf.inversion_id
      WHERE i.inversionista_id = $1
      GROUP BY i.id
      HAVING COALESCE(SUM(pf.interes_devuelto), 0) > 0
    `, [cuenta.perfil_id]);
    
    cuenta.rendimientos_por_inversion = rendimientos;
  }

  res.json({ success: true, data: cuenta });
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
    // Entradas: pagos de clientes, dinero de inversionistas, ganancias de interés
    const esEntrada = ["pago_cliente", "recibo_inversion", "ganancia_interes"].includes(m.tipo);
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

