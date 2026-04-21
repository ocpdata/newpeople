# Usuarios

## Alcance

Gestion de usuarios del CRM:

- Alta de usuario.
- Edicion de datos principales.
- Activacion y desactivacion.
- Envio de invitacion para establecer o reiniciar contrasena.
- Consumo de enlace de set password con token temporal y vigencia visible.
- Auditoria de acciones de usuarios.

## Puntos clave de UX

- Boton de crear usuario en encabezado.
- Alta de usuario mediante ventana modal.
- Edicion en modal con campos principales, roles y bloque de auditoria.
- Badge de estado (Activo/Inactivo) de solo lectura en encabezado del modal de edicion.
- Acciones por usuario en menu de tres puntos (editar, activar/desactivar,
  reiniciar contrasena).
- Tabla principal con ordenamiento por columnas y badge visual de estado.
- Filtro "Mostrar desactivados" (por defecto solo se muestran activos).
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
