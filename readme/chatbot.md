# Chatbot

## Objetivo

Proveer asistente conversacional interno con trazabilidad de sesiones, jobs y consumo de credito IA.

## Alcance

- Crear sesiones de chat por usuario.
- Enviar mensajes con procesamiento asincrono por job.
- Consultar estado de jobs y historial de mensajes.
- Consultar cartera/uso de credito IA asociado al feature.

## Permisos y acceso

- Accesible para usuarios autenticados con permisos del CRM.
- El consumo se sujeta a disponibilidad de credito IA.

## Endpoints principales

- `GET /api/chatbot/settings`
- `POST /api/chatbot/sessions`
- `POST /api/chatbot/messages`
- `GET /api/chatbot/jobs/:jobId`
- `GET /api/chatbot/sessions/:sessionId/messages`
- `GET /api/chatbot/wallet/me`
- `GET /api/chatbot/usage/me`

## Reglas operativas

- Cada mensaje crea un job asincrono y se cola para procesamiento.
- Si no hay credito IA disponible, el envio se rechaza.
- La sesion debe pertenecer al usuario y estar activa.
- El worker de chatbot procesa jobs pendientes y registra salida.

## Estado actual (2026-07-29)

- Integrado como widget en la aplicacion principal.
- Incluye sesiones, jobs, historial y control de credito IA.
