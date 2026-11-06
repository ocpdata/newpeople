# Variable comercial

Ubicación: **Gestión de ventas → Variable comercial**.

Muestra, para un trimestre, cuánto pagaría el variable del equipo comercial con las ventas
aceptadas a la fecha y por qué. Es una vista de dirección: incluye a todos los vendedores con
cuota. No existe aún una vista de vendedor.

## Permisos

| Permiso | Efecto |
|---|---|
| `variable_comercial.read` | Consultar el tablero y las reglas vigentes. |
| `variable_comercial.update` | Editar las reglas de pago (incluye consulta). |

Se asignan desde **Roles**; los roles de sistema y `Administrador` los reciben al arrancar la API.
No requieren permisos de Metas y comisiones ni de Reportes.

## De dónde salen los datos

Todo se calcula en la API (`GET /api/variable-compensation?year=&quarter=`) reutilizando el
seguimiento de **Metas y comisiones**, para que el tablero y ese módulo no discrepen:

- **Cuota**: suma de las cuotas por vendedor del trimestre. Solo cuentan vendedores con cuota
  capturada; las ventas de vendedores sin cuota se excluyen y se avisa.
- **Venta, costo y margen**: cotizaciones **aceptadas** ubicadas en el trimestre de la fecha de
  cierre de su oportunidad ganada, en la moneda base de la planeación (convertidas con el tipo de
  cambio de la cotización y con el descuento global aplicado). El margen es **ponderado por
  importe** y usa venta menos costo de producto **y de servicio** (el de Rentabilidad).
- Las ganadas por aceptar no suman; se informan aparte.
- **Cliente nuevo**: la cuenta no tiene **otra oportunidad ganada** en los N meses anteriores
  (24 por defecto) al **inicio del trimestre** de la venta. Todas las ventas del trimestre de esa
  cuenta cuentan como venta a clientes nuevos. No usa la etapa de ciclo de vida de Campañas
  (90 días).
- **Cuentas actuales**: venta a cuentas que no son nuevas contra la misma medida del mismo
  trimestre del año anterior (mismo equipo). Si no hay planeación comparable o la moneda difiere,
  se muestra **Sin base** y no paga.
- **Línea** de cada venta: Producto, Servicio o Renovación según sus partidas (Mixta si hay varias).
- **Equipo en cuota**: vendedores con avance individual ≥ la cuota individual configurada.

## Reglas de pago

Se guardan en la base (`variable_compensation_rules`, una fila con control de versión) y se editan
en **Reglas de pago**. Cada guardado se audita (módulo `variable_comercial`). Los valores iniciales
son los del diseño del tablero y quedan **pendientes de validar con la carta** hasta que alguien
con permiso de edición marque la casilla de validación.

| Componente | Regla inicial |
|---|---|
| Cuota (80,000) | Bajo 70%: 0. De 70% a 100%: de 40% a 100% del pago base, de forma lineal. Sobre 100%: +3% del pago base por punto, máximo 2×, solo con margen ≥ 32%; con menos, queda en 80,000. |
| Margen (50,000) | ≥ 35%: 50,000. 32% a 34.99%: 25,000. Menos: 0. Requiere llegar al piso de 70%. |
| Equipo | 3 / 4 / 5 vendedores en cuota: 9,000 / 18,000 / 30,000. |
| Clientes nuevos (20,000) | Venta a nuevos ≥ 10% de la cuota y 3 clientes con ≥ 0.67% de la cuota cada uno. |
| Cuentas actuales (20,000) | Crecimiento ≥ +10% contra el mismo trimestre del año anterior. |
| Activación | Equipo, clientes nuevos y cuentas actuales solo desde 80% de la cuota. |
| Tope | 280,000 por trimestre. |

Los montos de ventas de clientes nuevos se definen como **porcentaje de la cuota** (equivalentes
a 4.5 M y 300 k sobre una cuota de 45 M) para no depender de la moneda de las ventas, que es la
de la planeación (hoy USD). Los pagos están en la moneda de pago (MXN) y no se convierten.

La fórmula vive en `shared/variable-compensation.js` y la usan la API y el simulador de la
pantalla, por lo que ambos dan siempre el mismo resultado.

## Alcance y límites

- No incluye cobranza (el variable no se condiciona a cobro), pipeline ponderado ni bono anual:
  el CRM no captura hoy fechas de cobro ni resultados trimestrales del pronóstico.
- "Variable del trimestre" es el pago con ventas **aceptadas a la fecha**, no una proyección.
- El tablero informa; no calcula nómina ni congela cifras de periodos cerrados.
- Las ventas con margen menor al umbral (10%) cuentan para cuota y se marcan en la tabla; el
  tablero no calcula comisiones por venta (eso sigue en Metas y comisiones).
