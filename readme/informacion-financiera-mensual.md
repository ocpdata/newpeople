# Información financiera mensual

Ubicación: **Operaciones → Información financiera mensual**.

Un registro compartido por empresa, año y mes. No existen cierres, reaperturas ni
bloqueos de periodos anteriores. No se asigna a un vendedor ni se limita a datos
propios.

## Captura anual en una sola pantalla

La vista **Año completo** es la predeterminada en escritorio:

- Selector de año (‹ 2026 ›), que inicia en el año actual de la zona horaria del negocio.
- Una tabla con un concepto por fila y un mes por columna, más **Total del año**.
  Los conceptos y el total anual permanecen visibles al desplazarse.
- Secciones: Ventas y compras, Gastos generales, Otros ingresos y gastos, Porcentajes.
- Cada mes muestra su estado (`Sin datos`, `8/13` o `Completo`) y un punto cuando tiene
  cambios sin guardar.
- **Moneda del año**: una sola para todos los meses. Cambiarla **no convierte** los importes
  y exige confirmación. Si un año ya tiene meses con monedas distintas se avisa, no se
  calculan totales anuales y hay que elegir una moneda antes de guardar.
- **Un solo botón Guardar cambios**. Solo se envían los meses modificados; los meses nuevos
  sin ningún importe no se crean. Se permite guardar información parcial.

La vista **Un mes** muestra el mismo estado como un formulario de un mes (en móvil es la
vista inicial). Ambas vistas comparten datos y guardado.

Un campo vacío significa **pendiente**; `0` significa un importe confirmado en cero. Importes
no negativos, hasta 12 enteros y 2 decimales. ISR y PTU admiten de 0 a 100 y hasta 2
decimales: `30` significa 30%.

Los totales por mes y por año de gastos generales, otros ingresos y otros gastos se calculan
con los conceptos registrados. Cuando faltan componentes se marcan como **parcial**. Las
compras no se consideran costo de ventas. No se calcula utilidad neta ni importes de ISR o PTU.

### Atajos

- **Enter / ↓ / ↑** mueven la captura entre conceptos del mismo mes (Shift+Enter sube).
  **Tab** avanza al mes siguiente del mismo concepto.
- **Pegar desde Excel**: se admite un rango (filas = conceptos en el orden de la tabla,
  columnas = meses consecutivos) desde la celda seleccionada. Si algún valor no es válido o
  el rango excede la tabla, no se aplica nada y se explica el motivo.
- **Repetir →** en ISR y PTU copia el último valor capturado a los meses vacíos siguientes,
  sin sobrescribir valores existentes.

### Protecciones

- Las celdas inválidas se marcan, se listan y llevan a la primera con error; nada se envía.
- Si ocurre un error al guardar, se conserva toda la captura y se puede reintentar. Un fallo
  de consulta no se muestra como un año vacío.
- Si otra persona modificó algún mes, **no se guarda nada**; se compara únicamente ese mes y
  se puede cargar su versión actual (con confirmación) conservando los demás cambios.
- Se advierte antes de cambiar de año o salir con cambios sin guardar.

## Permisos

- `informacion_financiera.read`: consulta del módulo, importes y monedas.
- `informacion_financiera.update`: captura y modificación de cualquier mes;
  incluye consulta sin requerir el permiso anterior.

Son independientes de configuración, pedidos y reportes. Se registran al iniciar
la API; en instalaciones existentes deben asignarse explícitamente a los roles.

## API y persistencia

- `GET /api/monthly-financials/currencies`: monedas activas.
- `GET /api/monthly-financials/:year`: `{ year, records }` con los meses que ya existen.
- `PUT /api/monthly-financials/:year`: `{ months: [...] }` (1 a 12 meses distintos). Cada mes
  lleva `month`, moneda, revisión (`version: 0` para crear) y los 13 conceptos como cadenas
  decimales o `null`. No se aceptan propiedades desconocidas ni conceptos omitidos. Es
  atómico: guarda todos los meses o ninguno. Una revisión obsoleta devuelve 409 con
  `conflicts: [{ month, record }]` (versión actual de cada mes en conflicto).
- `GET`/`PUT /api/monthly-financials/:year/:month`: acceso a un solo mes (mismas reglas).

Años admitidos: 1900–2100. Una clave única impide duplicar el periodo.
Se almacenan importes `DECIMAL`, revisión y usuario/fecha de modificación en
`monthly_financials`. La API crea la tabla al iniciar.

El guardado usa transacción y revisión optimista por mes. Cada mes creado o actualizado se
audita (periodo, actor y valores antes/después) en la misma transacción; si falla la
auditoría se revierte todo. La auditoría se consulta en el módulo existente, filtrando
**Información financiera mensual**.
