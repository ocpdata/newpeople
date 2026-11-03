# Aceptación de pedidos

## Objetivo

Formalizar la aceptación administrativa de cotizaciones ganadas y dar seguimiento al cierre documental y al procesamiento operativo del pedido.

## Alcance

- Bandeja de cotizaciones en estado `ganada` y `aceptada`.
- Validacion/consulta de documentos de cierre asociados.
- Accion de aceptacion y notificacion al vendedor.
- Seguimiento posterior a la aceptación por etapas, con documentos y evidencias.
- Generación de resúmenes con IA y envío de convocatorias de kick off, según los permisos asignados.

## Permisos y acceso

- `cotizaciones.administracion`: acceso administrativo al flujo de aceptación de cotizaciones.
- `aceptar_pedido.procesamiento.read`: consultar etapas, estados y documentos del procesamiento posterior a la aceptación.
- `aceptar_pedido.procesamiento.update`: editar la información de las etapas y gestionar documentos y evidencias.
- `aceptar_pedido.procesamiento.ia`: generar resúmenes con IA a partir de evidencias disponibles.
- `aceptar_pedido.procesamiento.convocar`: enviar convocatorias y notificaciones de kick off.

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
- La aceptación se considera acción administrativa de cierre comercial.
- La trazabilidad documental de orden de compra/cotizaciones proveedor debe quedar guardada.

## Estado actual (2026-07-29)

- Modulo activo en UI.
- Integrado al workflow de cotizaciones y documentos de cierre.
