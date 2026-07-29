# Configuracion del Proceso Comercial

## Objetivo

Administrar preguntas por etapa comercial para estandarizar captura de contexto y calidad de ejecucion.

## Alcance

- Catalogo de preguntas por etapa de ventas.
- Alta/edicion de preguntas y tipo de respuesta.
- Activar/desactivar y reordenar preguntas.

## Permisos y acceso

- Lectura: `proceso_comercial_config.read`
- Edicion: `proceso_comercial_config.update`

## Ruta de UI

- `/opportunities/questions`

## Endpoints principales

- `GET /api/catalogs/opportunity-sales-stages`
- `GET /api/catalogs/opportunity-stage-questions-admin?salesStageId=...`
- `POST /api/catalogs/opportunity-stage-questions`
- `PUT /api/catalogs/opportunity-stage-questions/:questionId`
- `PATCH /api/catalogs/opportunity-stage-questions/:questionId/status`
- `PATCH /api/catalogs/opportunity-stage-questions/:questionId/order`

## Reglas operativas

- Las preguntas se asocian a etapa y orden de despliegue.
- Se controla si una pregunta es obligatoria.
- El estado activo/inactivo afecta la captura operativa en oportunidades.

## Estado actual (2026-07-29)

- Modulo activo con modal de alta/edicion y reorder.
- Integrado con catalogos y permisos de proceso comercial.
