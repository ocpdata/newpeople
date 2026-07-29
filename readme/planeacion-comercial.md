# Planeacion Comercial

## Objetivo

Planificar metas trimestrales y reglas economicas por vendedor, y dar seguimiento a cumplimiento y comisiones.

## Alcance

- Administracion de periodos trimestrales y versiones.
- Captura de metas por vendedor.
- Configuracion de comisiones.
- Parametros comerciales por vendedor (ticket, ratios, tiempos).
- Seguimiento de comisiones y auditoria.

## Permisos y acceso

- `planeacion_comercial.read`
- `planeacion_comercial.update`
- `comercial.seller.eligible` (elegibilidad de vendedores en planeacion)

## Ruta de UI

- `/commercial-planning`

## Endpoints principales

- Prefijo:
  - `/api/commercial-planning/*`

## Reglas operativas

- La planeacion trabaja por periodo (anio/trimestre) y versiones publicables.
- Las metas y margenes se validan antes de publicar una version activa.
- El seguimiento de comisiones usa datos comerciales reales de cotizaciones aceptadas.
- Conserva trazabilidad de cambios por usuario y marca temporal.

## Relacion con otros documentos

- Regla de comisiones y formula operativa detallada en `comisiones.md`.
- Calculos transversales en `calculos.md`.

## Estado actual (2026-07-29)

- Modulo activo con tabs de resumen, periodos, metas, comisiones, parametros y auditoria.
- Integrado con elegibilidad de vendedores y workflow de publicacion.
