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

## Nombres de las cifras de pipeline (2026-11-01)

Hay tres cifras que no deben confundirse. Se usan los mismos nombres en Coach.

| Nombre | Qué cuenta |
| --- | --- |
| **Pipeline abierto** | Oportunidades donde el usuario es el vendedor, en proceso y activadas, sin importar su fecha de cierre. No aparece en esta pantalla; Coach lo da como «Mi pipeline abierto». |
| **Pipeline del trimestre** | Las abiertas con fecha de cierre en el trimestre actual. Es la base del funnel (antes «Monto abierto»), la cobertura, los vencidos y los sin siguiente paso. |
| **Pipeline del siguiente Q** | Las abiertas con cierre en el trimestre siguiente. |

**Mis oportunidades** son siempre las del vendedor de la oportunidad (`seller_user_id`). Que un usuario vea oportunidades de sus cuentas asignadas solo decide el acceso, no a quién se le atribuyen la cuota, el ranking ni la comisión.

El cálculo del tablero está en `buildSellerLeaguePayload` (`routes.commercial-tracking.js`), que usan la pantalla y la herramienta de Coach, de modo que las cifras siempre coinciden.

