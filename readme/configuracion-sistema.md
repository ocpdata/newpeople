# Configuracion del Sistema

## Objetivo

Concentrar parametros globales de operacion (empresa, branding, IA, chatbot y configuraciones comerciales).

## Alcance

- Perfil de empresa y branding de documentos.
- Configuracion de capacidades de IA y prompts.
- Componentes de contenido de propuesta.
- Ajustes de chatbot y settings temporales.
- Parametros comerciales globales (incluida zona horaria de negocio).

## Permisos y acceso

- Lectura: `configuracion.read`
- Actualizacion: `configuracion.update`

## Ruta de UI

- `/settings`

## Endpoints principales

- Prefijo principal:
  - `/api/settings/*`
- Incluye recursos de:
  - company profile
  - document branding
  - proposal content config
  - AI parameters config
  - chatbot settings
  - commercial settings
- Crédito IA (servicios de IA):
  - `GET /api/admin/ai/services` (resumen; `?refreshTavily=true` relee el uso de Tavily)
  - `PUT /api/admin/ai/services/settings` (proveedor por módulo, modelos, límites; requiere `expectedVersion`)
  - `GET /api/admin/ai/services/usage?fromUtc&toUtc` (monitoreo)
  - `GET /api/ai/services/alerts` y `POST /api/ai/services/alerts/:id/acknowledge` (avisos)
  - `GET/PUT /api/admin/ai/allocations` (porcentaje del saldo capturado por usuario activo)
  - Acceso directo: `/settings?section=ai_budget`

## Reglas operativas

- Los cambios globales impactan multiples modulos (cotizaciones, propuestas, desarrollo, calendario, etc.).
- La publicacion de configuraciones sensibles (IA/propuesta) debe dejar auditoria.
- La zona horaria de negocio se usa para calculos y cortes operativos.

## Estado actual (2026-07-29)

- Modulo activo y centralizado.
- Incluye administracion de parametros IA y configuracion comercial transversal.
