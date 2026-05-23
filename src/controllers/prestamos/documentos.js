const db = require("../../config/db");
const fs = require("fs");
const path = require("path");
const { asyncHandler, AppError } = require("../../middleware/errorHandler");

const prepararCarpetaPrestamo = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const { rows: [p] } = await db.query(
    `SELECT pref.nombre_completo, p.fecha_inicio 
     FROM prestamos p 
     JOIN perfiles pref ON p.cliente_id = pref.id 
     WHERE p.id = $1`,
    [id]
  );

  if (!p) {
    throw new AppError("Préstamo no encontrado", 404);
  }

  const nombreLimpio = p.nombre_completo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .substring(0, 30);
  
  const fechaObj = p.fecha_inicio instanceof Date 
    ? p.fecha_inicio 
    : new Date(p.fecha_inicio);

  const año = fechaObj.getFullYear();
  const mes = fechaObj.getMonth();
  const semestre = mes < 6 ? 'Semestre_1' : 'Semestre_2';
  const fechaStr = fechaObj.toISOString().split('T')[0];

  req.uploadSubFolder = path.join(
    String(año),
    semestre,
    `${nombreLimpio}_${fechaStr}`
  );
  next();
});

const subirDocumento = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tipo_documento } = req.body;
  const file = req.file;

  if (!file) {
    throw new AppError("No se recibió ningún archivo", 400);
  }

  const rutaFinal = req.uploadSubFolder 
    ? path.join(req.uploadSubFolder, file.filename)
    : file.filename;

  const { rows: [doc] } = await db.query(
    `INSERT INTO prestamo_documentos (prestamo_id, nombre_archivo, ruta_archivo, tipo_documento)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, file.originalname, rutaFinal, tipo_documento || 'otro']
  );

  res.status(201).json({
    success: true,
    data: doc,
    message: "Documento subido y organizado correctamente"
  });
});

const obtenerDocumentos = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { rows: documentos } = await db.query(
    "SELECT * FROM prestamo_documentos WHERE prestamo_id = $1 ORDER BY fecha_subida DESC",
    [id]
  );

  res.json({
    success: true,
    data: documentos || []
  });
});

const eliminarDocumento = asyncHandler(async (req, res) => {
  const { docId } = req.params;

  const { rows: [doc] } = await db.query(
    "SELECT * FROM prestamo_documentos WHERE id = $1",
    [docId]
  );

  if (!doc) {
    throw new AppError("Documento no encontrado", 404);
  }

  await db.query("DELETE FROM prestamo_documentos WHERE id = $1", [docId]);

  const uploadDir = process.env.UPLOAD_DIR || 'uploads/documentos';
  const filePath = path.join(process.cwd(), uploadDir, doc.ruta_archivo);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.json({
    success: true,
    message: "Documento eliminado exitosamente"
  });
});

module.exports = {
  prepararCarpetaPrestamo,
  subirDocumento,
  obtenerDocumentos,
  eliminarDocumento
};
