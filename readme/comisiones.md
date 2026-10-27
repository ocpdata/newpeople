# Comisiones

## Alcance

Modelo trimestral de comisiones para vendedores dentro de Planeacion Comercial.

- La configuracion de comisiones vive dentro de Planeacion Comercial.
- Cada periodo trimestral puede definir porcentajes distintos por vendedor.
- El seguimiento de comisiones se calcula sobre cotizaciones aceptadas, ubicadas por la fecha en que se declararon ganadas.
- La elegibilidad depende de cuota trimestral y margen minimo por cotizacion.
- El calculo de comision se hace por item sobre contribucion.

## Estado actual de implementacion

La primera version ya permite configurar porcentajes y consultar seguimiento por periodo.

- La UI expone dos tabs: `Comisiones · Configuracion` y `Comisiones · Seguimiento`.
- La configuracion se persiste por periodo y vendedor.
- El seguimiento se calcula en backend de forma dinamica a partir de las cotizaciones aceptadas cuya fecha ganada cae en el trimestre.
- El seguimiento muestra resumen por vendedor y detalle por cotizacion.
- La configuracion queda bloqueada si el periodo ya esta cerrado.

### Pestaña Comisiones · Configuracion

- Encabezado con selector de año, guardado y enlace a `Metas`, de donde se toman las cuotas.
- Bloques informativos plegables: `Reglas de comision` (70% de cuota, 10% de margen, base y formula), `Categorias de comision` y `Simulador de comision`. Los umbrales se muestran, no se editan; el calculo sigue en backend.
- El simulador usa los porcentajes en pantalla (aun sin guardar), no persiste datos y calcula una cotizacion con la misma logica de elegibilidad.
- Un panel por trimestre con tabla de vendedores, `Aplicar a todos los vendedores` y `Copiar de T{n-1}` (los cambios se guardan hasta pulsar `Guardar configuracion`).
- Avisos por vendedor cuando no tiene cuota en Metas o todos sus porcentajes estan en 0.

### Pestaña Comisiones · Seguimiento

- Muestra las reglas resumidas y el motivo de bloqueo de cada cotizacion, por ejemplo `Bloqueada por margen (7.50% < 10%)`.
- La vista inicial es `Año completo`: matriz vendedor × T1–T4 con la comision de cada trimestre, el total anual y la venta aceptada. Las pestañas `T1`–`T4` muestran un solo trimestre.
- Debajo del cumplimiento se muestra la venta aceptada trimestral en miles aproximados, con menor tamaño y el importe exacto al pasar el cursor o enfocar el dato. Las ventas menores a mil se indican como tales y las ventas cero se muestran en cero, incluso sin cuota.
- La matriz anual termina con una fila `Total` (o `Total mostrado` al filtrar), que suma las comisiones y ventas de los vendedores visibles, sin porcentaje de cumplimiento global. Los totales se calculan antes de redondear.
- Filtro por vendedor, interruptor `Solo con actividad` y exportacion a Excel (`comisiones-seguimiento-{año}.xlsx`, con hojas de resumen anual, trimestres, cotizaciones aceptadas y pendientes).
- El Excel conserva los cuatro trimestres para los vendedores visibles; el resumen anual incluye ventas trimestrales exactas y una fila de totales sin abreviar.
- Tarjetas de resumen del alcance elegido: comision a pagar, venta aceptada / cuota, vendedores habilitados, contribucion elegible y `Por aceptar`.
- En la vista trimestral cada vendedor muestra barra de cumplimiento con marca en 70%, un estado que explica por que tiene o no comision (por ejemplo `faltan $X para habilitar`) y un detalle desplegable con categorias (contribucion × % = comision) y cotizaciones.
- `Pendientes de aceptar` lista las cotizaciones en estado `ganada` cuya fecha ganada cae en el periodo. No suman a venta, cumplimiento ni comision hasta que se acepten.

## Ubicacion funcional

La funcionalidad vive en Planeacion Comercial.

- La configuracion se hace sobre el periodo seleccionado.
- El sistema toma como base la version activa del periodo, o la version seleccionada cuando se envia `versionId`.
- La cuota trimestral usada en comisiones proviene de las metas del vendedor en esa version del periodo.

## Reglas de negocio

- La periodicidad de comisiones es trimestral.
- La venta que cuenta para comisiones es la cotizacion con estado `aceptada`; una cotizacion solo `ganada` aun no cuenta.
- El trimestre de la venta se determina por la fecha en que se declaro ganada, no por la de aceptacion.
- Cada vendedor debe alcanzar al menos el 70% de su cuota trimestral para habilitar comisiones.
- Si el vendedor alcanza el 70% al cierre del trimestre, todas sus cotizaciones elegibles del trimestre quedan habilitadas retroactivamente.
- Una cotizacion con margen menor a 10% no genera comision, pero si cuenta para el cumplimiento de cuota.
- La validacion del margen minimo se hace a nivel cotizacion completa.
- El calculo monetario de la comision se hace por item sobre la contribucion del item.
- No hay ventas compartidas entre vendedores en esta version.
- No se contemplan notas de credito ni ajustes posteriores en esta version.
- Los porcentajes se consideran fijos dentro del periodo trimestral.

## Categorias de comision

Cada item elegible cae en una sola categoria:

- `products`: items de producto normales.
- `services`: items `servicio_propio` asociados a Access Quality.
- `renewals`: items marcados como renovacion.

Reglas de clasificacion actuales:

- Si `isRenewal` es verdadero, el item cae en `renewals`.
- Si el `itemType` es `servicio_propio` y el proveedor contiene `Access Quality`, el item cae en `services`.
- Todo lo demas cae en `products`.

## Formula funcional

Para cada vendedor en el trimestre:

1. Se suman las ventas aceptadas del trimestre para medir cumplimiento de cuota.
2. Si el cumplimiento es menor a 70%, la comision total del trimestre es cero.
3. Si el cumplimiento es al menos 70%, se revisa cada cotizacion aceptada del trimestre.
4. Si la cotizacion tiene margen menor a 10%, esa cotizacion no genera comision.
5. Si la cotizacion cumple margen, cada item calcula su contribucion.
6. La comision del item es `contribucion * porcentaje_categoria / 100`.
7. La comision total del vendedor es la suma de productos, servicios y renovaciones elegibles.

## Ejemplos numericos de calculo

### Ejemplo 1: vendedor habilitado y cotizacion elegible

- Cuota trimestral: $100,000.
- Venta aceptada acumulada al cierre: $82,000.
- Cumplimiento: 82%.
- La comision queda habilitada porque supera 70%.
- Cotizacion A: venta total $20,000, costo total $17,000, contribucion $3,000.
- Margen de la cotizacion A: 15%, por lo tanto si es elegible.
- Items de la cotizacion A:
  - Producto con contribucion $2,000 y porcentaje 5% => comision $100.
  - Renovacion con contribucion $1,000 y porcentaje 8% => comision $80.
- Comision total de la cotizacion A: $180.

### Ejemplo 2: cotizacion bloqueada por margen

- El vendedor ya alcanzo 90% de cuota, asi que supera el umbral trimestral.
- Cotizacion B: venta total $12,000, costo total $11,100, contribucion $900.
- Margen de la cotizacion B: 7.5%.
- Aunque la venta cuenta para cuota, no genera comision porque el margen es menor a 10%.
- Comision total de la cotizacion B: $0.

### Ejemplo 3: vendedor no habilitado por cuota

- Cuota trimestral: $100,000.
- Venta aceptada acumulada al cierre: $64,000.
- Cumplimiento: 64%.
- Aunque una cotizacion tenga margen mayor a 10%, ninguna cotizacion del trimestre genera comision porque no se alcanzo el 70%.
- Comision total del trimestre para ese vendedor: $0.

## Datos que se guardan

### Tabla principal

`commercial_planning_commission_configs`

Guarda por periodo y vendedor:

- `period_id`
- `seller_user_id`
- `product_commission_pct`
- `service_commission_pct`
- `renewal_commission_pct`
- `notes`
- auditoria de creacion y actualizacion

## Datos que se calculan en linea

El seguimiento no se persiste como snapshot en esta version. Se calcula al consultar:

- venta aceptada del trimestre
- porcentaje de cumplimiento de cuota
- habilitacion por umbral 70%
- conteo de cotizaciones elegibles
- conteo de cotizaciones bloqueadas por margen
- contribucion elegible por categoria
- comision calculada por categoria y total
- detalle por cotizacion e item

## Endpoints

Los endpoints viven bajo `/api/commercial-planning`.

- `GET /periods/:periodId/commission-configs`
  - devuelve periodo, version base, vendedores elegibles y configuracion actual.
- `PUT /periods/:periodId/commission-configs`
  - reemplaza la configuracion trimestral completa del periodo.
  - requiere `planeacion_comercial.update`.
  - rechaza cambios si el periodo esta cerrado.
- `GET /periods/:periodId/commission-tracking`
  - devuelve el resumen y detalle del seguimiento calculado, mas `pendingQuotations` (cotizaciones `ganada` aun sin aceptar, sin items y sin sumar al calculo) e `invalidQuotations` (cotizaciones que no se pudieron convertir a la moneda de la cuota, con el motivo).

## Permisos funcionales

- `planeacion_comercial.read`: consultar configuracion y seguimiento.
- `planeacion_comercial.update`: guardar configuracion trimestral.
- `planeacion_comercial.audit.read`: consultar trazabilidad de cambios en auditoria.

## Dependencias funcionales

La funcionalidad de comisiones depende de:

- periodos y versiones de Planeacion Comercial
- metas trimestrales por vendedor
- cotizaciones asociadas a oportunidades con vendedor asignado
- workflow de cotizaciones: estado final `aceptada` y evento `declarar_ganada` para la fecha
- flag `isRenewal` en items de cotizacion

## Supuestos y limitaciones actuales

- Solo cuentan cotizaciones `aceptada`; su fecha para comisiones es el ultimo evento `declarar_ganada` exitoso de la version mayor en `audit_log`. Si no existe (por ejemplo, se acepto sin pasar por ganada), se usa el primer evento `aceptar` y, en ultimo caso, `quotation_versions.updated_at`.
- El seguimiento devuelve `wonAt` y `statusCode` por cotizacion.
- El vendedor se toma de `opportunities.seller_user_id`.
- Monedas: las ventas se convierten a la moneda anual de la cuota. Una cotizacion en la misma moneda no se convierte; una en MXN con cuota en USD se divide entre su tipo de cambio. Si la cotizacion tiene moneda o tipo de cambio invalido (por ejemplo MXN con tipo de cambio 1), o si la cuota anual no esta en USD y la cotizacion esta en otra moneda (no hay tipo de cambio de planeacion), la cotizacion no suma a venta, cumplimiento ni comision: se devuelve en `invalidQuotations` y la pantalla la lista en `Sin convertir a la moneda de la cuota`.
- Descuento global: se aplica sobre la venta sin IVA, en la moneda de la cotizacion (`summary_discount_value` por monto esta en esa moneda). Con descuento por monto en una cotizacion con IVA por item, el monto se compara contra el total con IVA. Se reparte en proporcion a la venta de cada item; la contribucion y el margen se calculan con la venta descontada. Con distribucion `per_item` el descuento ya esta dentro del descuento final de cada item y no se aplica otra vez. El detalle expone `discountAmount`.
- La clasificacion de servicios de Access Quality se resuelve por heuristica sobre tipo de item y nombre del proveedor.
- El seguimiento usa calculo dinamico; si cambian datos historicos de cotizaciones, el seguimiento historico tambien cambia.
- No existe aun cierre contable de comisiones ni snapshot oficial del trimestre.
- No existe manejo de ventas compartidas, devoluciones ni notas de credito.

## Trazabilidad y auditoria

- Cada guardado de configuracion genera auditoria en el modulo `planeacion_comercial`.
- El evento auditado actual es `updated_commission_configs`.
- El before/after registra el reemplazo completo de configuraciones del periodo.

## Archivos clave

- `apps/api/src/commercial-planning/schema.js`
- `apps/api/src/routes.commercial-planning.js`
- `apps/web/src/CommercialPlanningPage.jsx`
- `apps/api/src/routes.quotations.js`

## Pendientes naturales

- snapshot o cierre oficial de comisiones por trimestre
- soporte para notas de credito o ajustes
- clasificacion mas explicita de servicios en lugar de heuristica por proveedor
- exportacion o reporte formal de comisiones

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
