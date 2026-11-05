# Reportes

## Acceso

- El menu lateral incluye Reportes dentro de Inicio.
- `/reports` presenta el catalogo de reportes autorizados, independiente de Indicadores.
- `/reports/opportunities-quotations` contiene el reporte Oportunidades y cotizaciones.
- El reporte es de solo consulta: no crea ni modifica oportunidades, cotizaciones o estados.

## Permisos y alcance

Se requiere `oportunidades.read` o `oportunidades.read_all` y al menos uno de los
permisos de consulta del modulo de cotizaciones: `cotizaciones.operacion`,
`cotizaciones.revision`, `cotizaciones.ingreso`, `cotizaciones.aprobacion_humana`,
`cotizaciones.aprobacion_ia`, `cotizaciones.administracion` o `cotizaciones.externo`.
Los permisos de procesamiento de pedidos por si solos no conceden acceso.

Los resultados, catalogos y totales se limitan a la interseccion de las cuentas
autorizadas en ambos modulos. El alcance global requiere tanto
`oportunidades.read_all` como `cotizaciones.administracion`; de lo contrario solo se
consideran cuentas propias. No se muestran oportunidades cuyas cotizaciones no
pueden consultarse, para evitar interpretar informacion restringida como ausente.

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
  devuelve `{page, pageSize, total, summary, items}`.
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
