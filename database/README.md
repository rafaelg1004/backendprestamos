# Base de Datos - Sistema de Préstamos

## Estructura SQL

### Tablas Principales

1. **perfiles** - Usuarios del sistema (clientes e inversionistas)
2. **prestamos** - Préstamos otorgados a clientes
3. **inversiones** - Inversiones recibidas de inversionistas
4. **movimientos** - Registro de todas las transacciones

### Tipos ENUM

- `tipo_persona`: 'inversionista', 'cliente'
- `tipo_movimiento`: 'entrega_prestamo', 'pago_cliente', 'recibo_inversion', 'devolucion_inversion'

## Vistas Disponibles

### 1. `vista_detalle_clientes`
Muestra información consolidada de préstamos y pagos por cliente.

**Columnas:**
- `cliente_id`, `cliente`, `cliente_email`
- `prestamo_id`, `capital_prestado`, `tasa_interes_mensual`, `tasa_mora_diaria`
- `capital_pagado`, `saldo_capital_pendiente`, `intereses_pagados`
- `dias_mora`, `interes_mora_generado`, `total_adeudado`
- `estado`, `notas`

**Uso:**
```sql
SELECT * FROM vista_detalle_clientes WHERE estado = 'activo';
SELECT * FROM vista_detalle_clientes WHERE dias_mora > 0;
```

### 2. `vista_detalle_inversionistas`
Muestra seguimiento de inversiones y devoluciones.

**Columnas:**
- `inversionista_id`, `inversionista`, `email`
- `inversion_id`, `inversion_inicial`, `tasa_acordada`
- `capital_devuelto`, `intereses_pagados`, `total_devuelto`
- `capital_todavia_adeudado`, `intereses_acumulados_estimados`
- `estado`, `fecha_inversion`

**Uso:**
```sql
SELECT * FROM vista_detalle_inversionistas WHERE estado = 'activo';
```

### 3. `vista_balance_general`
Resumen financiero global del negocio.

**Columnas:**
- `total_capital_en_la_calle`
- `total_deuda_con_inversionistas`
- `intereses_ganados_clientes`
- `intereses_pagados_inversionistas`
- `utilidad_neta_intereses`
- `transacciones_con_soporte`
- `total_movimientos`
- `prestamos_en_mora`
- `monto_total_en_mora`
- `fecha_actualizacion`

**Uso:**
```sql
SELECT * FROM vista_balance_general;
```

### 4. `vista_movimientos_detalle`
Todos los movimientos con información completa de perfiles.

**Columnas:**
- `movimiento_id`, `fecha_operacion`, `tipo_movimiento`
- `nombre_perfil`, `tipo_perfil`, `email_perfil`
- `monto_total`, `monto_capital`, `monto_interes`, `monto_mora`
- `metodo_pago`, `referencia_pago`, `url_captura`
- `flujo` ('entrada', 'salida', 'otro')

**Uso:**
```sql
SELECT * FROM vista_movimientos_detalle WHERE flujo = 'entrada';
```

### 5. `vista_alertas_vencimientos`
Préstamos próximos a vencer (7 días) o ya vencidos.

**Columnas:**
- `prestamo_id`, `cliente`, `cliente_email`, `cliente_telefono`
- `capital_prestado`, `fecha_vencimiento`, `dias_restantes`
- `capital_pagado`, `saldo_pendiente`
- `nivel_alerta` ('proximo', 'critico', 'vencido')

**Uso:**
```sql
SELECT * FROM vista_alertas_vencimientos WHERE nivel_alerta = 'critico';
```

## Cálculos Financieros

### Sistema de Milunidades
Todas las cantidades monetarias en las tablas se almacenan como enteros en **milunidades**:
- `1000` = $1.00
- `150000` = $150.00
- `10550` = $10.55

Las vistas automáticamente convierten a unidades legibles dividiendo por `1000.0`.

### Fórmulas en las Vistas

**Mora:**
```
interes_mora = saldo_pendiente × tasa_mora_diaria% × dias_mora
```

**Total Adeudado (con mora):**
```
total = saldo_pendiente × (1 + tasa_mora_diaria% × dias_mora)
```

**Intereses de Inversión:**
```
intereses = capital × tasa_acordada% × meses_transcurridos
```

## Instalación

1. Ejecutar el script de tablas primero en Supabase SQL Editor
2. Luego ejecutar `vistas.sql` para crear las vistas
3. Las vistas se actualizan automáticamente con cada consulta

## Uso desde el Backend

```javascript
// Usar vistas desde Supabase
const { data, error } = await supabase
  .from('vista_balance_general')
  .select('*')
  .single();

// Filtrar vista de clientes
const { data: clientesMora } = await supabase
  .from('vista_detalle_clientes')
  .select('*')
  .gt('dias_mora', 0);

// Alertas de vencimiento
const { data: alertas } = await supabase
  .from('vista_alertas_vencimientos')
  .select('*')
  .in('nivel_alerta', ['critico', 'vencido']);
```

## Notas de Seguridad

- Las vistas respetan las políticas RLS definidas en las tablas base
- Un usuario solo verá los datos que tiene permiso de ver en las tablas originales
- No es necesario definir RLS adicional para las vistas
