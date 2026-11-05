# Reportes

## Acceso

- El menu lateral incluye Reportes dentro de Inicio.
- `/reports` presenta el catalogo de reportes autorizados, independiente de Indicadores.
- `/reports/opportunities-quotations` contiene el reporte Oportunidades y cotizaciones.
- El reporte es de solo consulta: no crea ni modifica oportunidades, cotizaciones o estados.

## Rentabilidad de oportunidades ganadas

- Disponible en `/reports/opportunity-profitability` y en el catalogo de Reportes.
  Tiene permisos y alcance propios, descritos abajo.
- Incluye solo oportunidades con estado comercial `ganada` que tengan cotizaciones
  cuya version vigente (`latest_version_id`) este `ganada` o `aceptada`.
  No agrega condiciones de activacion diferentes de las del reporte general.
- Una fila por oportunidad suma todas sus cotizaciones elegibles. No suma versiones
  historicas, cotizaciones en otros estados ni el monto estimado de la oportunidad.
- Muestra venta neta despues de descuentos y sin IVA, costo de productos, costo de
  servicios, costo total, utilidad bruta y margen bruto porcentual.
- Reutiliza el calculo de partidas hoja de cotizaciones (sin duplicar paquetes).
  Los servicios corresponden a `servicio_propio`; las otras partidas hoja distintas
  de `grupo_productos` corresponden a productos, siguiendo el modelo actual.
  Los costos incluyen el descuento de fabricante y el costo de importacion.
- El descuento global se aplica una sola vez; si ya esta distribuido por partida,
  no se reaplica. Utilidad = venta neta - costo total. Margen = utilidad / venta
  neta * 100; con venta cero se muestra "No calculable". Se conservan las perdidas.
- Consolida en USD dividiendo venta y costos entre el tipo de cambio guardado en
  cada cotizacion; USD no requiere conversion. Para otras monedas se exige moneda
  informada y tasa positiva distinta de 1, igual que en el reporte general.
- Si una cotizacion no puede convertirse, la oportunidad muestra "Total incompleto".
  El resumen muestra solo el subtotal convertible, advierte cuantas cotizaciones
  fueron excluidas de la conversion y no presenta un margen global.
  El desglose conserva sus importes originales y muestra los equivalentes disponibles.
- El resumen incluye todos los resultados filtrados, no solo la pagina visible.
  El margen global se calcula sobre importes acumulados, no promediando porcentajes.
- Filtros: busqueda, cliente, vendedor y fecha de cierre comercial (ambos extremos
  inclusivos). Ordenamiento por oportunidad, nombre, venta, costo, utilidad o margen;
  paginacion de 10, 50 o 100 oportunidades.
- Es rentabilidad cotizada, no costo real de ejecucion. No incluye exportacion ni
  comparacion cotizado contra real.

## Contribucion de oportunidades ganadas

- Reporte independiente en `/reports/opportunity-contribution`, disponible desde
  Reportes. API: `/api/reports/opportunity-contribution` y su ruta `/catalogs`.
- Reutiliza seleccion, filtros, conversion USD, paginacion y desglose de Rentabilidad:
  solo oportunidades ganadas con cotizaciones vigentes ganadas o aceptadas, sumadas.
- Conserva toda la venta neta de productos y servicios, despues de descuentos y
  sin IVA. Contribucion = venta neta - costo de productos. Margen de contribucion =
  contribucion / venta neta * 100; con venta cero no es calculable.
- No resta el costo de servicios. No representa utilidad final ni margen real de
  ejecucion. El reporte de Rentabilidad original sigue restando ambos costos.
  La tabla y el resumen de Contribucion omiten costo de servicios y costo total.
- Permisos independientes: `reportes.contribucion.read` (vendedor asignado actual)
  y `reportes.contribucion.read_all` (todos los usuarios). Incluyen acceso al modulo,
  sin permisos de origen ni de Rentabilidad; requieren asignacion explicita en
  instalaciones existentes.

## Permisos y alcance

Los permisos se administran bajo el grupo **Reportes**:

| Permiso | Acceso |
|---|---|
| `reportes.access` | Entrar al modulo; sin permisos especificos muestra "No tienes reportes habilitados" |
| `reportes.oportunidades_cotizaciones.read` | Oportunidades y cotizaciones propias |
| `reportes.oportunidades_cotizaciones.read_all` | Oportunidades y cotizaciones de todos los usuarios |
| `reportes.rentabilidad.read` | Rentabilidad propia, incluidos costos, utilidad y margen |
| `reportes.rentabilidad.read_all` | Rentabilidad de todos los usuarios, incluidos costos, utilidad y margen |
| `reportes.contribucion.read` | Contribucion propia: venta neta menos costo de productos |
| `reportes.contribucion.read_all` | Contribucion de todos los usuarios: venta neta menos costo de productos |

- Cualquier permiso especifico incluye entrada al modulo y todas las columnas y
  detalles del reporte. No requiere `reportes.access` ni permisos de Oportunidades,
  Cotizaciones o Cuentas. Los permisos de esos modulos ya no conceden acceso.
- `.read_all` funciona sin `.read` y prevalece si los roles conceden ambos.
  El alcance se resuelve por reporte; global en uno no amplia el otro.
- Datos propios significa que `opportunities.seller_user_id` coincide con el usuario
  autenticado. No depende del creador, preventa ni propietarios de la cuenta.
  La reasignacion cambia el acceso inmediatamente; no es un alcance historico.
  Sin oportunidades asignadas se devuelve un resultado vacio.
- Filas, desglose, catalogos, conteos y totales aplican el mismo alcance en la API,
  antes de filtros y paginacion. Un filtro por otro vendedor no amplia el acceso.
  El selector de vendedor solo se ofrece con alcance global; la pantalla indica
  "Mis datos" o "Todos los usuarios".
- Cada reporte tiene su endpoint de catalogos: `/api/reports/opportunities-quotations/catalogs`
  y `/api/reports/opportunity-profitability/catalogs`, protegido con su propio permiso.
- El permiso de reporte no concede entrada, edicion ni descarga de documentos en
  los modulos originales, cuyas autorizaciones se mantienen.
- Los permisos se registran mediante `ensureCorePermissions` al iniciar la API.
  Se conserva la politica de bootstrap: solo se asignan automaticamente a los roles
  administrativos/sistema en la inicializacion de permisos de una instalacion nueva.
  En instalaciones con permisos ya asignados se deben conceder explicitamente
  desde Roles y permisos, incluso para roles administrativos que aun no los tengan.
  No se migran automaticamente permisos de Oportunidades o Cotizaciones.

## Reglas del reporte

- Una fila principal por oportunidad, con sus cotizaciones desplegables.
- Los resultados agrupan los indicadores en tarjetas, los totales cotizados por
  moneda y el selector de visualizacion en una barra. Cada oportunidad queda
  separada de la siguiente y el detalle se despliega en un panel propio.
  Los importes de ordenes se agrupan bajo la referencia de su cotizacion.
- Las oportunidades y cotizaciones anuladas se excluyen siempre de resultados,
  detalle, catalogos y totales. No se ofrece Anulada como filtro de estado.
  Una oportunidad con solo cotizaciones anuladas se considera sin cotizaciones.
- La misma fila muestra el monto de la oportunidad en USD y el monto de cada
  cotizacion visible con su identificador y moneda, sin sumar monedas distintas.
- La tabla principal y el detalle no muestran columnas de estado, activacion o
  fechas; los filtros correspondientes se conservan.
- Si una cotizacion tiene moneda distinta de USD (moneda de las oportunidades),
  se muestra tambien su equivalente en USD y el tipo de cambio guardado en su
  version actual: `1 USD = N unidades de la moneda de cotizacion`. El monto en USD
  se obtiene dividiendo el importe original entre ese tipo de cambio. No se
  consulta una tasa de mercado actual ni se alteran los totales por moneda.
  Cuando falta un tipo de cambio valido se indica que la conversion no esta disponible.
- El importe original, el equivalente en USD y el tipo de cambio se presentan en
  columnas independientes, tanto en la fila principal como en el detalle. Cada
  importe de la fila principal identifica su cotizacion; para cotizaciones en USD,
  las columnas de conversion y tipo de cambio muestran un guion.
- Se consulta exclusivamente la version actual, referenciada por `latest_version_id`.
- La columna Valores de ordenes de compra muestra, para cada cotizacion visible,
  solo el valor y la moneda de cada orden de compra de su version actual,
  sin nombres de archivo. Se incluye tanto en la fila principal como en el
  detalle. No suma monedas distintas ni agrega estos valores a los totales.
  Los documentos eliminados y las ordenes historicas no se incluyen.
  Si falta el valor indica Valor sin registrar; si no hay orden seleccionada,
  indica Sin orden de compra registrada.
- Oportunidad ganada, cotizacion ganada y cotizacion aceptada son condiciones distintas.
- Una cotizacion historica aceptada no convierte su version actual en aceptada.
- Las oportunidades sin cotizaciones se conservan cuando cumplen los filtros.

### Consultas rapidas

| Consulta | Condicion |
|---|---|
| Todas | Sin restriccion de ganada/aceptada |
| Oportunidades ganadas | Estado comercial de oportunidad `ganada` |
| Con cotizaciones aceptadas | Al menos una cotizacion actual `aceptada` |
| Ambas condiciones (Y) | Ganada y con al menos una aceptada |
| Cualquiera de las dos (O) | Ganada o con al menos una aceptada |
| Ganadas sin cotizacion aceptada | Ganada y ninguna aceptada, incluso sin cotizaciones |
| Con cotizacion aceptada y oportunidad no ganada | Con aceptada y estado comercial diferente de ganada |

### Filtros adicionales

La interfaz agrupa busqueda y responsables, periodo opcional y estados.
Activacion, ordenamiento y tamano de pagina se encuentran en Opciones avanzadas,
plegadas inicialmente. Los estados seleccionados se resaltan y sin seleccion se
consideran todos. Aplicar filtros actualiza la consulta; Limpiar restablece los valores.

- Cuenta, vendedor, preventa, nombre o ID de oportunidad y nombre de cuenta.
- Estados comerciales y de cotizacion con seleccion multiple.
- Con o sin cotizaciones.
- Activacion de oportunidad y cotizacion, independientes del estado comercial.
- Rango de cierre previsto, cierre comercial real o fecha de cotizacion.
- Ordenamiento y paginacion de 10, 50 o 100 oportunidades.

Los filtros adicionales se acumulan con la consulta rapida. Los estados y fechas de
cotizacion deben coincidir en una misma cotizacion; en las consultas de aceptadas,
esa cotizacion debe estar aceptada. En la consulta O, una oportunidad ganada puede
coincidir mediante cualquier cotizacion que cumpla los filtros adicionales.

La activacion de cotizacion delimita el conjunto considerado para presencia,
aceptacion, detalle y totales. Por ejemplo, con activacion Activada, "sin
cotizaciones" significa sin cotizaciones activadas. Por defecto se consideran todas
las activaciones para no excluir cierres historicos.

El detalle muestra por defecto todas las cotizaciones consideradas y destaca las
coincidentes. La columna Cumple los filtros indica Cumple o No cumple segun los
filtros actuales, no compara importes. Se puede elegir mostrar solo las que cumplen el filtro.
El rango de fechas es inclusivo; la fecha de modificacion no se usa como fecha de
aceptacion. No se incluye filtro de fecha de aceptacion en esta version.

## Totales

- Los totales cubren todos los resultados filtrados, no solo la pagina visible.
- Las oportunidades y su importe en USD se cuentan una sola vez.
- Se separan cotizaciones consideradas, aceptadas y coincidentes.
- Los importes cotizados se agrupan por moneda y usan el mismo calculo de descuentos,
  bundles e IVA que el listado de cotizaciones existente.
- El selector de detalle alterna entre importes de todas las cotizaciones consideradas
  e importes de las coincidentes. No cambia la seleccion de oportunidades.
- Los importes de oportunidades y de cotizaciones no se suman entre si.
- Se conserva el desglose por moneda y se agrega un total cotizado equivalente en
  USD. Cada cotizacion en USD aporta su importe directo; las demas se convierten
  individualmente dividiendo por el cambio guardado en su version actual, antes
  de sumar. No se usa un cambio unico por moneda ni una tasa de mercado.
- El equivalente cubre todas las paginas y sigue el selector Todas/Solo las que
  cumplen el filtro. Usa los mismos descuentos e IVA que los totales por moneda.
- Si faltan moneda, importe o cambio valido, se muestra Subtotal convertible y
  la cantidad de cotizaciones excluidas. Para monedas distintas de USD se mantiene
  el criterio del detalle: cambio positivo y distinto de 1. No se asume un cambio.

## API

- `GET /api/reports/opportunities-quotations/catalogs`
  devuelve cuentas y responsables dentro del alcance autorizado.
- `GET /api/reports/opportunities-quotations`
  devuelve `{page, pageSize, total, scope, summary, items}`.
- `GET /api/reports/opportunity-profitability` devuelve la misma estructura general
  con metricas de rentabilidad y su propio alcance. `scope` es `own` o `all`.
- Cada cotizacion incluye `purchaseOrders` con `documentId`, `source`,
  `originalFileName`, `amount` y `currencyCode` por orden.
- `summary.quotedUsd` incluye `amount`, `matchingAmount`, `missingCount` y
  `matchingMissingCount`: subtotales convertibles y cantidades sin conversion para
  todas las cotizaciones consideradas y para las coincidentes, respectivamente.
- Parametros: `preset`, `accountId`, `sellerUserId`, `presalesUserId`,
  `commercialStatuses`, `quotationStatuses` (codigos separados por coma),
  `quotationPresence`, `opportunityActivation`, `quotationActivation`,
  `dateType`, `dateFrom`, `dateTo`, `search`, `sort`, `direction`, `page`, `pageSize`.
- Presets: `all`, `won`, `accepted`, `both`, `either`, `won_without_accepted`,
  `accepted_not_won`. Fechas: `expected_close`, `actual_close`, `quotation`.
- Los filtros invalidos devuelven 400; permisos insuficientes, 403.

No incluye exportaciones, envios programados, edicion ni historial de versiones.
