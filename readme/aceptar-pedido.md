# Aceptar Pedido

## Objetivo

Formalizar la aceptacion administrativa de cotizaciones ganadas y cerrar el ciclo documental del pedido.

## Alcance

- Bandeja de cotizaciones en estado `ganada` y `aceptada`.
- Validacion/consulta de documentos de cierre asociados.
- Accion de aceptacion y notificacion al vendedor.

## Permisos y acceso

- `cotizaciones.administracion`

## Ruta de UI

- `/accept-order`

## Especificacion funcional de procesamiento

- Ver documento: `aceptar-pedido-procesamiento-especificacion.md`

## Endpoints principales

- `GET /api/quotations?latestStatusCodes=ganada,aceptada`
- `GET /api/quotation-versions/:versionId/won-documents`
- `POST /api/quotation-versions/:versionId/won-documents`
- `POST /api/quotation-versions/:versionId/transition` (accion `aceptar`)

## Reglas operativas

- Solo cotizaciones en estado ganado/aceptado participan en esta bandeja.
- La aceptacion se considera accion administrativa de cierre comercial.
- La trazabilidad documental de orden de compra/cotizaciones proveedor debe quedar guardada.

## Estado actual (2026-07-29)

- Modulo activo en UI.
- Integrado al workflow de cotizaciones y documentos de cierre.
