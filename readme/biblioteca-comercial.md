# Biblioteca Comercial

## Objetivo

Centralizar piezas comerciales (archivos y enlaces) para su uso en propuestas, correos y ejecucion comercial.

## Alcance

- Catalogar activos por tipo, audiencia, visibilidad y contexto comercial.
- Subir archivos, registrar enlaces y mantener versiones.
- Operar gobierno de calidad y ciclo de vida de activos.
- Reusar activos desde propuestas y correos comerciales.

## Permisos y acceso

- Lectura/uso:
  - `enablement_comercial.use`
  - `enablement_comercial.read`
  - `enablement_comercial.analytics`
- Carga/gestion:
  - `enablement_comercial.upload`
  - `enablement_comercial.manage`
  - `enablement_comercial.update`
  - `enablement_comercial.admin`

## Ruta de UI

- `/commercial-enablement`

## Endpoints principales

- `GET /api/commercial-enablement/bootstrap`
- `GET /api/commercial-enablement/dashboard`
- `GET /api/commercial-enablement/catalogs`
- `GET /api/commercial-enablement/assets`
- `POST /api/commercial-enablement/assets`
- `PUT /api/commercial-enablement/assets/:publicId`
- `POST /api/commercial-enablement/intake-sessions`
- `POST /api/commercial-enablement/intake-sessions/:publicId/analyze`
- `POST /api/commercial-enablement/intake-sessions/:publicId/review`

## Reglas operativas

- Cada activo se clasifica por catalogos comerciales (fabricante, tecnologia, solucion, industria, etc.).
- La visibilidad del activo determina si es apto para cliente (`client_safe`) o uso interno.
- El gobierno considera estado del activo (`draft`, `published`, `obsolete`, `archived`) y validaciones de calidad.
- Se registra uso para trazabilidad y analitica.

## Estado actual (2026-07-29)

- Modulo activo con tabs de uso, gestion y gobierno.
- Flujo asistido de ingesta disponible (sesiones de intake y analisis).
- Integrado con propuestas y correos comerciales.
