# Comisiones

## Alcance

Modelo trimestral de comisiones para vendedores dentro de Planeacion Comercial.

- La configuracion de comisiones vive dentro de Planeacion Comercial.
- Cada periodo trimestral puede definir porcentajes distintos por vendedor.
- El seguimiento de comisiones se calcula sobre cotizaciones aceptadas del trimestre.
- La elegibilidad depende de cuota trimestral y margen minimo por cotizacion.
- El calculo de comision se hace por item sobre contribucion.

## Estado actual de implementacion

La primera version ya permite configurar porcentajes y consultar seguimiento por periodo.

- La UI expone dos tabs: `Comisiones · Configuracion` y `Comisiones · Seguimiento`.
- La configuracion se persiste por periodo y vendedor.
- El seguimiento se calcula en backend de forma dinamica a partir de las cotizaciones aceptadas del trimestre.
- El seguimiento muestra resumen por vendedor y detalle por cotizacion.
- La configuracion queda bloqueada si el periodo ya esta cerrado.

## Ubicacion funcional

La funcionalidad vive en Planeacion Comercial.

- La configuracion se hace sobre el periodo seleccionado.
- El sistema toma como base la version activa del periodo, o la version seleccionada cuando se envia `versionId`.
- La cuota trimestral usada en comisiones proviene de las metas del vendedor en esa version del periodo.

## Reglas de negocio

- La periodicidad de comisiones es trimestral.
- La venta que cuenta para comisiones es la cotizacion con estado `aceptada`.
- El trimestre de la venta se determina por la fecha de aceptacion.
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
  - devuelve el resumen y detalle del seguimiento calculado.

## Permisos funcionales

- `planeacion_comercial.read`: consultar configuracion y seguimiento.
- `planeacion_comercial.update`: guardar configuracion trimestral.
- `planeacion_comercial.audit.read`: consultar trazabilidad de cambios en auditoria.

## Dependencias funcionales

La funcionalidad de comisiones depende de:

- periodos y versiones de Planeacion Comercial
- metas trimestrales por vendedor
- cotizaciones asociadas a oportunidades con vendedor asignado
- workflow de cotizaciones con estado final `aceptada`
- flag `isRenewal` en items de cotizacion

## Supuestos y limitaciones actuales

- La fecha de aceptacion se toma de `quotation_versions.updated_at` de la version mayor cuando su estado actual es `aceptada`.
- El vendedor se toma de `opportunities.seller_user_id`.
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
