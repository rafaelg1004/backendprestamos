const db = require("../../config/db");
const { asyncHandler, AppError } = require("../../middleware/errorHandler");

const obtenerPrestamosMora = asyncHandler(async (req, res) => {
  const hoy = new Date().toISOString().split("T")[0];

  const { rows: prestamosMora } = await db.query(
    `SELECT p.*, 
      json_build_object(
        'id', pref.id, 
        'nombre_completo', pref.nombre_completo, 
        'email', pref.email
      ) as cliente
    FROM prestamos p
    JOIN perfiles pref ON p.cliente_id = pref.id
    WHERE (COALESCE(p.fecha_ultimo_corte, p.fecha_inicio) + INTERVAL '1 month')::date < $1 AND p.estado = 'activo'
    ORDER BY p.fecha_ultimo_corte ASC`,
    [hoy]
  );

  res.json({
    success: true,
    data: prestamosMora || [],
    total: prestamosMora?.length || 0,
  });
});

const obtenerPrestamosPorCedula = asyncHandler(async (req, res) => {
  const { cedula } = req.params;

  const { data: perfil, error: perfilError } = await db
    .from("perfiles")
    .select("id, nombre_completo, telefono")
    .eq("identificacion", cedula)
    .single();

  if (perfilError || !perfil) {
    throw new AppError(
      "No se encontró ningún perfil con esa cédula",
      404,
      "NOT_FOUND",
    );
  }

  const { data: prestamos, error: prestamosError } = await db
    .from("prestamos")
    .select("*")
    .eq("cliente_id", perfil.id)
    .order("fecha_inicio", { ascending: false });

  if (prestamosError) {
    throw new AppError("Error al buscar préstamos", 500, "DB_ERROR");
  }

  res.json({
    success: true,
    data: {
      perfil: {
        nombre: perfil.nombre_completo,
        telefono: perfil.telefono,
      },
      prestamos: prestamos || [],
      total: prestamos?.length || 0,
    },
  });
});

module.exports = {
  obtenerPrestamosMora,
  obtenerPrestamosPorCedula
};
