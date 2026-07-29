# Herramientas

## Objetivo

Agrupar utilidades administrativas para diagnostico, saneamiento y reconciliacion de datos sensibles.

## Alcance

- Catalogo de herramientas disponibles y planificadas.
- Herramienta activa de duplicados en listas de precios.
- Espacios reservados para reconciliaciones futuras.

## Permisos y acceso

- `herramientas.read`

## Ruta de UI

- `/tools`
- `/tools/price-list-duplicates`

## Endpoints principales

- `GET /api/tools`
- `GET /api/tools/price-list-duplicates/summary`
- `GET /api/tools/price-list-duplicates/groups`
- `GET /api/tools/price-list-duplicates/groups/:groupKey`
- `POST /api/tools/price-list-duplicates/groups/:groupKey/consolidate`

## Reglas operativas

- La deteccion de duplicados normaliza codigo con criterio: trim + upper + remove spaces.
- La consolidacion exige candidato principal y valida referencias antes de archivar/eliminar.
- Las acciones de consolidacion deben dejar rastro auditado.

## Estado actual (2026-07-29)

- Catalogo activo en UI.
- Duplicados de listas de precios activo con riesgo y metricas por grupo.
- Otras herramientas en backlog marcado como planned.
