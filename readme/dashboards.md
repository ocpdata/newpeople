# Dashboards

## Objetivo

Centralizar la navegacion de tableros analiticos y operativos del CRM por dominio comercial.

## Alcance

- Hub de dashboards disponibles por permiso.
- Acceso unificado a tableros de cuota, pipeline, ritmo, planeacion, ejecucion y leads.
- Reserva de espacios para futuros tableros.

## Rutas de UI

- `/dashboards`
- `/dashboards/cuota-mensual`

## Reglas operativas

- Cada tarjeta solo aparece si el usuario tiene permisos del modulo destino.
- El hub no reemplaza los modulos; actua como catalogo/navegacion de analitica.
- Incluye seccion de dashboards disponibles y proximos.

## Dependencias de permisos (ejemplos)

- Pipeline: `seguimiento_comercial.read`
- Ritmo: `ritmo_comercial.read`
- Planeacion: `planeacion_comercial.read`
- Leads: `interacciones.read` o `interacciones.read_all`

## Estado actual (2026-07-29)

- Hub activo con tarjetas por contexto.
- Incluye enlaces directos a vistas comerciales principales.
