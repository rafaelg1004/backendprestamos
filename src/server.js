const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();
const db = require("./config/db");

// Verificar conexión a la base de datos al inicio
db.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Error conectando a PostgreSQL:", err.message);
  } else {
    console.log("✅ Conexión a PostgreSQL establecida correctamente");
  }
});

const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

// Importar rutas
const authRoutes = require("./routes/auth");
const perfilesRoutes = require("./routes/perfiles");
const prestamosRoutes = require("./routes/prestamos");
const inversionesRoutes = require("./routes/inversiones");
const movimientosRoutes = require("./routes/movimientos");
const dashboardRoutes = require("./routes/dashboard");
const cuentasRoutes = require("./routes/cuentas");

const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos (Documentos de préstamos)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Middleware
app.use(helmet()); // Seguridad

// CORS configuración
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : "*";

app.use(
  cors({
    origin:
      allowedOrigins === "*"
        ? "*"
        : (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error("Origen no permitido por CORS"));
            }
          },
    credentials: true,
  }),
);
app.use(morgan("dev")); // Logging
app.use(express.json()); // Parsear JSON
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes - Auth (público)
app.use("/api/auth", authRoutes);

// API Routes - Protegidas (requieren auth)
app.use("/api/perfiles", perfilesRoutes);
app.use("/api/prestamos", prestamosRoutes);
app.use("/api/inversiones", inversionesRoutes);
app.use("/api/movimientos", movimientosRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/cuentas", cuentasRoutes);

// Ruta base
app.get("/", (req, res) => {
  res.json({
    name: "API de Sistema de Préstamos e Inversiones",
    version: "1.0.0",
    description: "API REST para gestión de préstamos a clientes e inversiones",
    endpoints: {
      auth: "/api/auth",
      perfiles: "/api/perfiles",
      prestamos: "/api/prestamos",
      inversiones: "/api/inversiones",
      movimientos: "/api/movimientos",
      dashboard: "/api/dashboard",
      cuentas: "/api/cuentas",
    },
    documentation: "Consulta el README.md para más información",
  });
});

// Manejo de rutas no encontradas
app.use(notFoundHandler);

// Manejo de errores
app.use(errorHandler);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 API de Sistema de Préstamos e Inversiones                ║
║                                                              ║
║   Servidor corriendo en: http://localhost:${PORT}              ║
║                                                              ║
║   Endpoints disponibles:                                     ║
║   • Auth:           http://localhost:${PORT}/api/auth           ║
║   • Perfiles:      http://localhost:${PORT}/api/perfiles       ║
║   • Préstamos:     http://localhost:${PORT}/api/prestamos      ║
║   • Inversiones:   http://localhost:${PORT}/api/inversiones    ║
║   • Movimientos:   http://localhost:${PORT}/api/movimientos    ║
║   • Dashboard:     http://localhost:${PORT}/api/dashboard      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
