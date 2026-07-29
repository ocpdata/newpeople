# Propuestas

## Objetivo

Documentar el modulo de propuestas comerciales asociado al flujo de cotizaciones.

## Alcance

- Gestionar propuestas por oportunidad/cotizacion.
- Editar componentes de contenido por seccion.
- Generar vista de impresion y envio por correo.
- Aplicar plantillas y reutilizar activos institucionales/comerciales.

## Permisos y acceso

- Permisos de propuestas:
  - `propuestas.read`
  - `propuestas.create`
  - `propuestas.update`
- Tambien pueden acceder perfiles de cotizaciones:
  - `cotizaciones.operacion`
  - `cotizaciones.revision`
  - `cotizaciones.ingreso`
  - `cotizaciones.administracion`
  - `cotizaciones.externo`

## Rutas de UI

- `/proposals`
- `/proposals/print`

## Endpoints principales

- `GET /api/proposals`
- `POST /api/proposals`
- `GET /api/proposals/:proposalId`
- `PUT /api/proposals/:proposalId`
- `POST /api/proposals/:proposalId/pdf`
- `POST /api/proposals/:proposalId/send-email`
- `POST /api/proposals/:proposalId/components/:componentCode/suggestions`
- `POST /api/proposals/:proposalId/components/:componentCode/suggestions/:suggestionPublicId/consume`

## Reglas operativas

- La propuesta se opera en contexto comercial real (cuenta, contacto, oportunidad y cotizacion versionada).
- El contenido por componente se persiste por bloques (heading, paragraph, list, image, brochure).
- La impresion usa render de backend para asegurar consistencia del documento final.
- El envio por correo valida destinatarios y genera auditoria de accion.

## Integraciones

- Configuracion de contenido de propuesta y branding.
- Biblioteca comercial para activos reutilizables.
- IA para sugerencias de secciones (resumen ejecutivo, antecedentes y secciones genericas).

## Estado actual (2026-07-29)

- Modulo activo en UI y API.
- Soporta sugerencias asistidas por IA con control de configuracion.
- Soporta impresion y envio de propuesta desde el flujo comercial.
