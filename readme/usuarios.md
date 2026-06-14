# Usuarios

## Alcance

Gestion de usuarios del CRM:

- Alta de usuario.
- Edicion de datos principales.
- Activacion y desactivacion.
- Envio de invitacion para establecer o reiniciar contrasena.
- Consumo de enlace de set password con token temporal y vigencia visible.
- Auditoria de acciones de usuarios.

## Logica de negocio

### Estado y acceso

- Solo usuarios con estado activo pueden operar el sistema.
- Un JWT valido no alcanza por si solo: en cada request el backend vuelve a cargar al usuario y verifica que siga activo.
- Un usuario inactivo puede seguir apareciendo en historicos, auditoria y relaciones existentes, pero no recuperar acceso.

### Alta, roles e invitaciones

- El alta de usuario se considera exitosa cuando se persiste el usuario y sus roles, aunque falle el envio de correo.
- Los roles pueden asignarse desde el alta o despues; el backend toma los permisos efectivos desde roles activos.
- La invitacion inicial y el reinicio de acceso usan token temporal opaco, de un solo uso y con vigencia limitada.
- Si SMTP falla, la operacion principal no se revierte: el backend devuelve el enlace temporal y su expiracion para resolucion manual.

### Desactivacion y restricciones

- Desactivar un usuario corta su acceso inmediatamente.
- La desactivacion no elimina auditoria ni relaciones historicas.
- Si el usuario es el ultimo propietario activo de una o mas cuentas activas, la desactivacion debe bloquearse.
- El objetivo de ese bloqueo es evitar cuentas activas sin responsable comercial vigente.

### Efectos visibles en otros modulos

- Un usuario inactivo puede seguir mostrandose como propietario historico en cuentas existentes.
- Cuando la UI necesita mostrarlo en listas historicas, se distingue visualmente como `Nombre (inactivo)`.
- No debe ofrecerse como nueva opcion operativa en catalogos de seleccion para propietarios o responsables.

## Puntos clave de UX

- Encabezado unificado: titulo con icono SVG, subtitulo, boton `+ Crear usuario` a la derecha.
- Barra de filtros: pills de estado (Todos / Activos / Inactivos) + campo de busqueda inline.
- Alta de usuario mediante ventana modal.
- Edicion en modal con campos principales, roles y bloque de auditoria.
- Badge de estado (Activo/Inactivo) de solo lectura en encabezado del modal de edicion.
- Acciones por usuario en menu de tres puntos (editar, activar/desactivar,
  reiniciar contrasena).
- Tabla principal con ordenamiento por columnas y badge visual de estado.
- Paginacion con selector de 10 / 50 / 100 registros por pagina y navegacion previo/siguiente.
- Filtros para busqueda en lista y auditoria (accion, actor, usuario afectado,
  texto libre).

## API relacionada (resumen)

- GET /api/users
- POST /api/users
- PUT /api/users/:id
- PATCH /api/users/:id/status
- POST /api/users/:id/reset-password-invite
- GET /api/users/audit
- GET /api/auth/set-password-context
- POST /api/auth/set-password

## Consideraciones

- El estado del usuario impacta acceso al sistema.
- La auditoria ayuda a trazabilidad de cambios.
- Mantener consistencia en mensajes de exito y error.
- Las invitaciones y reinicios usan token opaco de un solo uso; no exponer email como mecanismo de autorizacion en la URL.
- Si SMTP falla, el backend devuelve el enlace temporal y su expiracion para resolver el acceso manualmente.
- En la edicion, la auditoria se muestra en formato compacto para no saturar la
  lectura del formulario.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
