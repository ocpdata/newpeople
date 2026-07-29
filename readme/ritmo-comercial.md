# Ritmo Comercial (Seller League TV)

## Objetivo

Visualizar el ritmo competitivo de ejecucion comercial por vendedor para seguimiento diario del equipo.

## Alcance

- Ranking y tableros por vendedor.
- Vista de detalle por vendedor con indicadores de funnel y avance.
- Modo de pantalla para despliegue continuo en TV/window.

## Permisos y acceso

- `ritmo_comercial.read`
- Para vista global/window:
  - `ritmo_comercial.read_all`

## Rutas de UI

- `/seller-league-tv`
- `/seller-league-tv/sellers/:sellerUserId`
- `/seller-league-tv/window`

## Endpoints principales

- Datos del tablero y detalle provienen de API de tracking/comercial.
- Integra metricas de pipeline, leads y conversiones por vendedor.

## Reglas operativas

- El ranking respeta alcance por permisos (propio vs global).
- Los indicadores usan orden estandar de etapas comerciales.
- El modo window requiere permisos amplios para lectura global.

## Estado actual (2026-07-29)

- Modulo activo con vista principal, detalle y modo pantalla.
- Integrado con metricas de planeacion/tracking para metas y brechas.
