# Preguntas por etapa

## Objetivo

Configurar las preguntas que se presentan al registrar información de una oportunidad en cada etapa de venta. Esto estandariza la captura de contexto y la calidad de ejecución; no modifica las etapas comerciales.

## Alcance

- Catalogo de preguntas por etapa de ventas.
- Alta/edicion de preguntas y tipo de respuesta.
- Activar/desactivar y reordenar preguntas.

## Permisos y acceso

- Consulta: `proceso_comercial_config.read`
- Administración de preguntas: `proceso_comercial_config.update`

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

- Módulo activo con alta y edición de preguntas, cambios de orden y activación o desactivación.
- Integrado con catalogos y permisos de proceso comercial.
