# Registros de Fabricantes

## Objetivo

Controlar solicitudes, aprobaciones, renovaciones y vencimientos de registros de fabricantes vinculados a oportunidades.

## Alcance

- Solicitud y actualizacion de registro por oportunidad/proveedor.
- Aprobacion con folio y vigencia.
- Renovacion, rechazo y reapertura.
- Filtros por estado, alerta de vencimiento y ownership.

## Permisos y acceso

- Lectura:
  - `registros_fabricantes.read`
  - `registros_fabricantes.read_all`
- Operacion:
  - `registros_fabricantes.request`
  - `registros_fabricantes.update`
  - `registros_fabricantes.manage`
- Depende tambien de alcance de oportunidades (`oportunidades.read[_all]`).

## Ruta de UI

- `/manufacturer-registrations`

## Endpoints principales

- Prefijo en API:
  - `/api/manufacturer-registrations/*`

## Reglas operativas

- No se permite operar registros cuando la oportunidad esta cerrada (`ganada`, `perdida`, `anulada`).
- Se aplican alertas de vigencia por umbrales operativos.
- El alcance de datos respeta ownership cuando no hay permiso global.

## Estado actual (2026-07-29)

- Modulo activo con flujo completo de solicitud, aprobacion, rechazo y renovacion.
- Integrado con auditoria y filtros operativos por riesgo de vencimiento.
