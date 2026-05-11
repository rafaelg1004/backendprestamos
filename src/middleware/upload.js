const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configurar almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadDir = process.env.UPLOAD_DIR || 'uploads/documentos';
    
    // Si el middleware previo definió una subcarpeta (ej: Nombre_Fecha), la usamos
    if (req.uploadSubFolder) {
      uploadDir = path.join(uploadDir, req.uploadSubFolder);
    }

    // Asegurarse de que la carpeta existe (recursivamente)
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Nombre: timestamp-nombreOriginal (limpio)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${uniqueSuffix}-${originalName}`);
  }
});

// Filtro de archivos (opcional)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo PDF, Imágenes y Word.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite 10MB
  }
});

module.exports = upload;
