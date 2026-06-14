# Auditoria

## Alcance

Modulo de auditoria transversal del sistema para registrar y consultar eventos
de seguridad y operaciones de negocio.

Incluye eventos de:

- Auth (login exitoso y fallido, bootstrap inicial).
- Usuarios (alta, edicion, cambio de estado, reset/invitacion).
- Roles (alta, cambio de estado, cambios de permisos).
- Cuentas (alta, edicion, cambio de estado).

En invitaciones y reinicios de password, los eventos pueden incluir:

- `invite_purpose`: `invite` o `reset`
- `invite_expires_at`: vigencia del enlace temporal
- razon y detalle SMTP cuando el envio falla

## Logica de negocio

### Objetivo funcional

- La auditoria registra trazabilidad operativa y de seguridad, no telemetria de bajo nivel.
- Debe permitir responder quien hizo que, sobre que entidad, con que resultado y que campos cambiaron.

### Politica de registro

- Toda operacion sensible de negocio debe intentar registrar auditoria.
- La auditoria debe guardar solo el delta funcional de cambios, no snapshots completos ni secretos.
- Passwords, tokens planos y credenciales no deben persistirse en auditoria.
- En invitaciones y reinicios solo se documentan proposito, expiracion y errores de envio cuando aplican.

### Relacion con el resto del sistema

- La auditoria es transversal: auth, usuarios, roles, cuentas y otros modulos deben converger en el mismo stream consultable.
- Agregar un modulo nuevo implica instrumentar sus eventos en backend para que aparezcan automaticamente en la pantalla global.
- La consulta de auditoria es solo de lectura; no reemplaza backups, restore ni bitacoras de base de datos.

## Puntos clave de UX

- Pantalla dedicada en menu lateral: Auditoria.
- Tabla central con eventos ordenados por fecha descendente.
- Filtros por texto, modulo, estado y rango de fechas.
- Paginacion server-side.
- Columna Entidad con nombre legible cuando existe
  (ejemplo: `user: Omar Carrillo`, `role: Administrador`,
  `account: AccessQ`).
- Columna Cambios en formato resumido (solo campos modificados).
- Badges visuales por resultado: Exito / Error.

## API relacionada (resumen)

- GET /api/audit

Filtros soportados:

- page
- pageSize
- from
- to
- module
- action
- entityType
- status
- actorUserId
- q

Permiso requerido:

- audit.read

## Modelo de datos de auditoria

Tabla principal:

- audit_log

Campos funcionales clave:

- module
- action
- entity_type
- entity_id
- entity_name (resuelto en consulta por joins)
- status (`success` o `error`)
- detail
- changed_fields (JSON)
- performed_by_user_id
- performed_by_name
- performed_by_email
- ip_address
- user_agent
- created_at

## Politica aplicada en este proyecto

- Alcance: auditoria de todo el sistema (no solo usuarios).
- Exportacion CSV: no habilitada.
- Cambios almacenados: solo delta (before/after de campos cambiados).
- Retencion: 12 meses.
- Limpieza: purga automatica periodica de registros vencidos.

## Semantica de campos importantes

- Entidad:
  identifica el objeto afectado por el evento.
  Se compone de tipo (`entity_type`) y referencia (`entity_id`).
  En UI se prioriza nombre (`entity_name`) sobre id numerico.

- Cambios:
  JSON con diferencias por campo.
  Ejemplo:

```json
{
  "mobile": { "before": "5511111111", "after": "5512222222" },
  "role_ids": { "before": [1, 2], "after": [1] }
}
```

## Consideraciones operativas

- Evitar guardar secretos en auditoria (passwords, tokens, claves).
- En este proyecto solo se auditan proposito, expiracion y estado del enlace; el token plano no se persiste en auditoria.
- Mantener consistencia entre eventos y permisos RBAC.
- Si se agrega un nuevo modulo, instrumentar sus eventos en backend para que
  aparezcan automaticamente en la pantalla de auditoria.
- La auditoria es de consulta, no sustituye backups ni bitacoras de base de
  datos de bajo nivel.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
