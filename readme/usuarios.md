# Usuarios

## Alcance

Gestion de usuarios del CRM:

- Alta de usuario.
- Edicion de datos principales.
- Activacion y desactivacion.
- Envio de invitacion para establecer o reiniciar contrasena.
- Auditoria de acciones de usuarios.

## Puntos clave de UX

- Boton de crear usuario en encabezado.
- Alta de usuario mediante ventana modal.
- Edicion en modal con campos principales, roles y bloque de auditoria.
- Acciones por usuario en menu de tres puntos (editar, activar/desactivar,
  reiniciar contrasena).
- Tabla principal con ordenamiento por columnas y badge visual de estado.
- Filtros para busqueda en lista y auditoria (accion, actor, usuario afectado,
  texto libre).

## API relacionada (resumen)

- GET /api/users
- POST /api/users
- PUT /api/users/:id
- PATCH /api/users/:id/status
- POST /api/users/:id/reset-password-invite
- GET /api/users/audit

## Consideraciones

- El estado del usuario impacta acceso al sistema.
- La auditoria ayuda a trazabilidad de cambios.
- Mantener consistencia en mensajes de exito y error.
- En la edicion, la auditoria se muestra en formato compacto para no saturar la
  lectura del formulario.
