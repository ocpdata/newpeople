# Seguimiento Comercial (Pipeline)

## Objetivo

Ofrecer visibilidad del pipeline activo, salud de oportunidades y avance por periodos para control comercial.

## Alcance

- Resumen de pipeline abierto y ganado.
- Vistas por periodo, mensual y trimestral.
- Filtros rapidos de riesgo y ejecucion (bloqueadas, sin siguiente paso, sin actividad, etc.).

## Permisos y acceso

- `seguimiento_comercial.read`
- Requiere lectura de oportunidades (`oportunidades.read` o `oportunidades.read_all`).

## Ruta de UI

- `/commercial-tracking`

## Endpoints principales

- Prefijo:
  - `/api/commercial-tracking/*`

## Reglas operativas

- El orden de etapas comerciales es consistente con el proceso del CRM.
- Los indicadores de estancamiento se calculan contra SLA de etapa.
- Las vistas de periodo y forecast usan filtros temporales controlados.
- Se prioriza trazabilidad sobre oportunidad y no solo agregados.

## Estado actual (2026-07-29)

- Modulo activo con tabs de resumen, abiertas, ganadas, periodos y desempeno trimestral.
- Incluye filtros operativos para detectar riesgos de cierre.
- Integrado a navegacion de dashboards comerciales.
