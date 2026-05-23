# Cuentas Virtuales (Billeteras) de Inversionistas

## Interpretación de la Solicitud
Me indicas que quieres una "cuenta aparte que sea ficticia" para los intereses y ver todos los detalles de "de quién son los intereses". 

Entiendo que no quieres que los intereses simplemente caigan revueltos en tu cuenta bancaria real (como Nequi o Bancolombia) sin saber de quién es qué cosa. Quieres una **Cuenta Virtual o Billetera por cada Inversionista** dentro del sistema. Así, cuando el cliente paga el interés, el sistema "guarda" ese dinero en la billetera virtual de cada inversionista, y tú puedes ver exactamente cuánto le debes a cada uno.

## User Review Required

> [!IMPORTANT]
> **Por favor confirma si esta es la idea:**
> 1. Al registrar un pago, los intereses de los inversionistas **no** van a "Nequi" o "Bancolombia", sino que se van a una **Bolsa Ficticia Interna** de cada inversionista.
> 2. Tu ganancia (la tajada de administración) sí puede ir a tu cuenta real (Nequi/Caja).
> 3. Crearemos un **Panel de Inversionistas** donde podrás entrar y ver la "Billetera" de cada persona: Cuánto capital tienen invertido, cuánto interés han ganado, y cuánto dinero tienen disponible en su cuenta ficticia para que tú se los pagues o lo retiren.
> 
> *¿Es esto exactamente lo que necesitas? Si es así, aprueba el plan y lo construyo.*

## Proposed Changes

---

### 1. Base de Datos (Cuentas Virtuales)
#### [MODIFY] `cuentas` y `perfiles`
- Actualmente el sistema maneja cuentas bancarias. Podemos crear cuentas de tipo "billetera_inversionista" y asignarlas automáticamente a cada perfil que sea "inversionista".
- Cada vez que crees un inversionista nuevo, el sistema le creará una "Cuenta Virtual Ficticia" oculta en los bancos, pero visible en su panel.

### 2. Backend (Distribución de Pagos)
#### [MODIFY] `backend/src/controllers/prestamos/pagos.js`
- Modificar `registrarPagoLibre`.
- En lugar de registrar todo el abono a interés en la cuenta bancaria que selecciones en el modal, el sistema:
  - Tomará la porción del Inversionista A y hará un movimiento sumando ese dinero a la *Cuenta Ficticia* del Inversionista A.
  - Tomará la porción del Inversionista B y hará lo mismo.
  - Tomará el sobrante (tu ganancia libre) y lo mandará a la cuenta bancaria real que seleccionaste (Nequi, etc.).

### 3. Frontend (Modal y Panel)
#### [MODIFY] `frontend/src/components/PrestamoDetalleView/PagoLibreModal.jsx`
- Quitar la opción de "Selecciona la cuenta de destino para los intereses de los inversionistas", ya que el sistema lo mandará automáticamente a sus billeteras ficticias.
- Mantener la opción de cuenta destino solo para el **Capital** y para **Tu Ganancia**.

#### [NEW] `frontend/src/components/InversionistasView/`
- Crear una nueva pantalla en el menú izquierdo llamada **"Billeteras / Inversionistas"**.
- Mostrará una tabla con cada inversionista y su "Saldo en Cuenta Ficticia" (dinero que te han generado y que tú tienes guardado).
- Permitirá registrar "Retiros" (cuando le transfieras físicamente su ganancia al inversionista, descontando el saldo ficticio).
