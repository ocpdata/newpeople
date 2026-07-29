# Desarrollo Comercial

## Objetivo

Operar la ejecucion diaria de oportunidades con foco en siguiente paso, actividades, dependencias y narrativa comercial.

## Alcance

- Gestion de actividades comerciales (llamadas, visitas, presentaciones, etc.).
- Gestion de acciones (seguimiento, envio de documentos, coordinacion interna).
- Vista de calendario comercial con pendientes y estados.
- Apoyo narrativo asistido para priorizacion y accion sugerida.

## Permisos y acceso

- `desarrollo_comercial.read`
- `desarrollo_comercial.update`
- Normalmente se combina con permisos de lectura de oportunidades.

## Ruta de UI

- `/commercial-development`

## Endpoints principales

- Prefijo principal:
  - `/api/commercial-development/*`
- Alias operativo compartido:
  - `/api/execution-commercial/*`

## Reglas operativas

- Las actividades y acciones usan estados operativos normalizados (`pending`, `in_progress`, `blocked`, `done`, etc.).
- La agenda y alertas siguen zona horaria de negocio configurada.
- Se aplican definiciones unificadas de pendiente para no divergir entre vistas.
- El soporte de IA se sujeta a credito disponible y politicas de uso.

## Integraciones

- Oportunidades, contactos y cuentas.
- Biblioteca comercial para sugerir adjuntos.
- Cotizaciones/propuestas para acciones de seguimiento.

## Estado actual (2026-07-29)

- Modulo activo con experiencia de trabajo diario y calendario.
- Incluye worker de narrativa comercial y jobs asincronos.
- Incluye capacidades de correo comercial con adjuntos controlados.
