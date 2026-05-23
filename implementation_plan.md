# Transición a Préstamos de Capital Abierto (Rotativos)

Este documento detalla el plan técnico para cambiar la lógica de los préstamos. Pasaremos de un sistema de cuotas fijas (amortización) a un sistema de crédito abierto o rotativo donde el capital se mantiene y genera intereses según el tiempo transcurrido, permitiendo pagos libres de capital e interés en cualquier momento.

## User Review Required

> [!WARNING]
> **Eliminación de las Cuotas:** Este cambio eliminará permanentemente la tabla y la lógica de "Cuotas". Ya no habrá un plan de pagos fijo ni fechas de vencimiento pre-calculadas. 

> [!IMPORTANT]
> **¿Qué hacemos con los préstamos actuales?**
> Propongo la **Migración Total**: 
> 1. Leeremos cuánto capital han abonado realmente los clientes en sus préstamos actuales (sumando sus recibos de pago).
> 2. Calcularemos el `Capital Pendiente` real.
> 3. Estableceremos el día de hoy (o la fecha de su último pago) como su punto de partida para seguir generando intereses.
> 4. Eliminaremos todas sus "cuotas pendientes" para que entren al nuevo modelo libre.
> *¿Estás de acuerdo con convertir todos los préstamos actuales a este formato, o prefieres mantener los viejos tal como están y usar el nuevo sistema solo para los nuevos? (Recomiendo la conversión total para tener un solo sistema).*

## Proposed Changes

---

### 1. Base de Datos (Migraciones)

Necesitamos agregar columnas a la tabla `prestamos` para rastrear el estado real del crédito abierto y deshacernos de las cuotas.

#### [MODIFY] Script de actualización BD
- Crear un script `migrar-prestamos-abiertos.js` que:
  1. Agregue la columna `saldo_capital` (NUMERIC) a `prestamos` (por defecto igual al `monto_principal`).
  2. Agregue la columna `interes_acumulado` (NUMERIC) para guardar saldos de intereses no pagados.
  3. Agregue la columna `fecha_ultimo_corte` (DATE) para saber desde cuándo empezar a contar los nuevos intereses.
  4. Agregue la columna `interes_devuelto` a la tabla `prestamo_fondos` (que me pediste en tu comentario anterior).
  5. Calcule el `saldo_capital` real de todos los préstamos existentes restando los abonos a capital registrados en la tabla `movimientos`.
  6. Elimine la tabla `cuotas` y limpie dependencias.

---

### 2. Backend (Lógica de Negocio)

Reemplazaremos toda la matemática de amortización (sistema francés, flat, etc.) por la matemática de interés simple diario.

#### [MODIFY] `backend/src/utils/calculos.js`
- Crear función `calcularInteresGenerado(saldoCapital, tasaMensual, fechaUltimoCorte)`.
- Si ha pasado 1 mes exacto, el interés será exactamente el mensual. Si han pasado días, será proporcional a los días transcurridos.

#### [MODIFY] `backend/src/controllers/prestamos/core.js`
- **`crearPrestamo`**: Ya no generará bucles `INSERT INTO cuotas`. Simplemente insertará el préstamo con `saldo_capital = monto_principal` y `fecha_ultimo_corte = fecha_inicio`.
- **`obtenerPrestamos`**: Calculará en tiempo real el `interes_generado` sumando el `interes_acumulado` + el interés desde la `fecha_ultimo_corte`.
- **`obtenerPrestamo`**: (Detalle) Ya no devolverá el arreglo de `cuotas`. Devolverá el capital actual, y el interés generado al día de hoy exacto.

#### [MODIFY] `backend/src/controllers/prestamos/pagos.js`
- **`registrarPagoLibre`** (Reemplaza a `pagarCuota`): 
  - Recibirá cuánto se está pagando en total, y cómo el administrador decidió dividirlo (cuánto a capital, cuánto a intereses).
  - Recibirá en qué cuentas entra el dinero (soportando cuenta separada para intereses, como pediste).
  - Restará el pago a capital del `saldo_capital`.
  - Descontará el pago de intereses del interés generado. Si se paga todo el interés, la `fecha_ultimo_corte` se mueve al día de hoy.
  - Distribuirá las ganancias entre el Inversionista y el Administrador.

---

### 3. Frontend (Interfaz de Usuario)

La pantalla de detalle del préstamo dejará de ser una tabla larga de cuotas y se convertirá en un panel de control financiero en vivo.

#### [MODIFY] `frontend/src/hooks/prestamos/usePrestamoDetalle.js`
- Remover la lógica de manejo de cuota seleccionada.
- Adaptar las variables de estado para manejar un único flujo de pago.
- Calcular y sugerir automáticamente las distribuciones de inversionistas vs. ganancias del administrador basado en el interés pagado.

#### [MODIFY] `frontend/src/components/PrestamoDetalleView/index.jsx`
- Eliminar por completo la sección "Plan de Pagos (Cuotas)".
- En su lugar, colocar un gran panel de **"Estado de Cuenta al día de hoy"** mostrando:
  - Capital Prestado Inicial.
  - Capital Pendiente Actual.
  - Intereses generados sin pagar (Deuda de Interés).
- Un único botón principal: **"Registrar Pago"**.

#### [MODIFY] `frontend/src/components/PrestamoDetalleView/PagoLibreModal.jsx` (Nuevo/Reemplazo)
- Formulario donde el usuario ingresa:
  - **Monto Total Recibido**.
  - **Abono a Capital**: (Monto manual).
  - **Abono a Intereses**: (Monto manual).
  - Selección de **Cuenta destino para Capital**.
  - Selección de **Cuenta destino para Intereses**.
- **Distribución en Vivo**: Mostrará cuánto del interés ingresado le toca a los inversionistas (según su tasa pactada) y cuánto te queda a ti (la ganancia libre).

## Verification Plan

### Automated Tests
- Correr el script de migración para asegurar que no se pierda la información del capital abonado por los clientes existentes.

### Manual Verification
- Crear un préstamo nuevo de $1.000.000.
- Simular un mes de avance (modificando la fecha en la BD) y verificar que el interés generado sea exacto.
- Hacer un pago que solo cubra intereses y verificar que el capital se mantenga en $1.000.000.
- Hacer un abono a capital y verificar que al mes siguiente, el nuevo interés se calcule sobre el nuevo capital más bajo.
- Verificar que el dinero caiga en las cuentas bancarias separadas seleccionadas en el modal.
