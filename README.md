# Backend - Sistema de Préstamos e Inversiones

API REST construida con Node.js, Express y Supabase para gestionar préstamos a clientes e inversiones de inversionistas.

## Características

- **Autenticación**: Integración con Supabase Auth
- **Gestión de Perfiles**: Clientes e inversionistas
- **Préstamos**: Con cálculo automático de intereses y mora
- **Inversiones**: Con tasas de interés pactadas individualmente
- **Movimientos**: Registro completo del flujo de caja
- **Dashboard**: Resumen financiero y alertas

## Requisitos

- Node.js 18+
- Cuenta en Supabase con la base de datos configurada

## Instalación

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de Supabase

# Iniciar en modo desarrollo
npm run dev

# O iniciar en modo producción
npm start
```

## Configuración de Supabase

1. Crea un proyecto en [Supabase](https://supabase.com)
2. Ejecuta el script SQL proporcionado en el editor SQL de Supabase
3. Copia las credenciales (URL y keys) a tu archivo `.env`

## Estructura del Proyecto

```
backend/
├── src/
│   ├── config/
│   │   └── supabase.js          # Configuración de Supabase
│   ├── controllers/
│   │   ├── perfilesController.js
│   │   ├── prestamosController.js
│   │   ├── inversionesController.js
│   │   ├── movimientosController.js
│   │   └── dashboardController.js
│   ├── middleware/
│   │   ├── auth.js              # Middleware de autenticación
│   │   ├── errorHandler.js      # Manejo de errores
│   │   └── validate.js          # Validaciones
│   ├── routes/
│   │   ├── perfiles.js
│   │   ├── prestamos.js
│   │   ├── inversiones.js
│   │   ├── movimientos.js
│   │   └── dashboard.js
│   ├── utils/
│   │   ├── calculos.js          # Cálculos financieros
│   │   └── formatters.js        # Formateo de datos
│   └── server.js                # Punto de entrada
├── database/
│   ├── vistas.sql               # Vistas SQL para reportes
│   └── README.md                # Documentación de base de datos
├── .env.example
├── .gitignore
└── package.json
```

## API Endpoints

### Perfiles

- `GET /api/perfiles` - Listar perfiles
- `POST /api/perfiles` - Crear perfil
- `GET /api/perfiles/:id` - Obtener perfil
- `PUT /api/perfiles/:id` - Actualizar perfil
- `DELETE /api/perfiles/:id` - Eliminar perfil
- `GET /api/perfiles/:id/resumen` - Resumen financiero

### Préstamos

- `GET /api/prestamos` - Listar préstamos
- `POST /api/prestamos` - Crear préstamo
- `GET /api/prestamos/:id` - Obtener préstamo
- `PUT /api/prestamos/:id` - Actualizar préstamo
- `POST /api/prestamos/:id/pagar` - Registrar pago
- `DELETE /api/prestamos/:id` - Eliminar préstamo
- `GET /api/prestamos/mora/listado` - Préstamos en mora

### Inversiones

- `GET /api/inversiones` - Listar inversiones
- `POST /api/inversiones` - Crear inversión
- `GET /api/inversiones/:id` - Obtener inversión
- `PUT /api/inversiones/:id` - Actualizar inversión
- `POST /api/inversiones/:id/devolver` - Registrar devolución
- `DELETE /api/inversiones/:id` - Eliminar inversión

### Movimientos

- `GET /api/movimientos` - Listar movimientos
- `POST /api/movimientos` - Crear movimiento
- `GET /api/movimientos/:id` - Obtener movimiento
- `PUT /api/movimientos/:id` - Actualizar movimiento
- `DELETE /api/movimientos/:id` - Eliminar movimiento
- `GET /api/movimientos/resumen/flujo-caja` - Resumen financiero

### Dashboard

- `GET /api/dashboard/resumen` - Resumen general (usa `vista_balance_general`)
- `GET /api/dashboard/clientes/detalle` - Detalle de clientes con balances (usa `vista_detalle_clientes`)
  - Query params: `?estado=activo`, `?solo_mora=true`, `?page=1&limit=20`
- `GET /api/dashboard/inversionistas/detalle` - Detalle de inversionistas (usa `vista_detalle_inversionistas`)
  - Query params: `?estado=activo`, `?page=1&limit=20`
- `GET /api/dashboard/alertas/vencimientos` - Alertas de vencimientos (usa `vista_alertas_vencimientos`)
- `GET /api/dashboard/movimientos/recientes` - Movimientos recientes (usa `vista_movimientos_detalle`)

## Vistas SQL de Supabase

El backend puede aprovechar 5 vistas SQL para consultas optimizadas:

1. **`vista_detalle_clientes`** - Saldos, pagos, días de mora por cliente
2. **`vista_detalle_inversionistas`** - Seguimiento de inversiones y devoluciones
3. **`vista_balance_general`** - Resumen financiero global del negocio
4. **`vista_movimientos_detalle`** - Movimientos con información de perfiles
5. **`vista_alertas_vencimientos`** - Préstamos próximos a vencer o vencidos

### Instalación de Vistas

Ejecuta el archivo `database/vistas.sql` en el SQL Editor de Supabase.

### Uso de Vistas

El backend detecta automáticamente si las vistas existen:

- Si existen: Usa las vistas para respuestas más rápidas
- Si no existen: Calcula manualmente (con un mensaje en `_meta`)

## Modelo de Datos

Las cantidades se manejan en **milunidades** (ej: 1000 = $1.00) para evitar problemas de precisión con decimales.

### Tipos de Movimiento

- `entrega_prestamo`: Dinero que sale hacia un cliente
- `pago_cliente`: Pago recibido de un cliente
- `recibo_inversion`: Dinero que entra de un inversionista
- `devolucion_inversion`: Dinero que se devuelve al inversionista

### Estados de Préstamo

- `activo`: Préstamo vigente
- `pagado`: Préstamo completamente pagado
- `mora`: Préstamo vencido

### Estados de Inversión

- `activo`: Inversión vigente
- `finalizada`: Inversión completamente devuelta

## Variables de Entorno

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

## Seguridad

- Todas las rutas requieren autenticación (token JWT de Supabase)
- Validación de entradas con express-validator
- Headers de seguridad con Helmet
- CORS configurado

## Licencia

MIT
