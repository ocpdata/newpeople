# Roles y permisos

## Alcance

Administracion de roles y permisos del sistema:

- Creacion de roles.
- Edicion de nombre y descripcion del rol.
- Activacion y desactivacion de roles.
- Asignacion de permisos por rol.
- Consulta de usuarios asociados a un rol.
- Visualizacion de auditoria del rol seleccionado.

## Puntos clave de UX

- Encabezado unificado: titulo con icono SVG, subtitulo, boton `+ Crear rol` a la derecha.
- Creacion de rol mediante ventana modal.
- Creacion y edicion de rol con campos nombre y descripcion.
- Filtro Mostrar desactivados para incluir o excluir roles inactivos.
- Listado de roles con badge de estado (Activo/Desactivado).
- Conteos visibles por modulo:
  roles totales, permisos totales y usuarios del rol seleccionado.
- Diseno de 3 columnas con altura controlada (`calc(100vh - 220px)`) y scroll
  independiente por columna:
  - Columna 1: lista de roles.
  - Columna 2: permisos agrupados por modulo.
  - Columna 3: usuarios asociados al rol seleccionado.
- Seleccion de rol con actualizacion inmediata de:
  permisos asignados, usuarios asociados y datos de auditoria.
- Confirmacion previa para cambios sensibles de estado.

## API relacionada (resumen)

- GET /api/roles
- POST /api/roles
- PUT /api/roles/:id
- PATCH /api/roles/:id/status
- GET /api/roles/permissions
- PUT /api/roles/:id/permissions
- GET /api/roles/:id/users

## Consideraciones

- Los roles de sistema no deben desactivarse accidentalmente.
- La asignacion de permisos debe ser explicita y revisable.
- Para cuentas, contactos y oportunidades existen permisos separados de lectura, creacion, solicitud y actualizacion.
- Los permisos `*.create` crean el recurso en estado activo.
- Los permisos `*.request` permiten solicitar el recurso y este nace en estado pendiente.
- Los cambios de estado deben quedar auditables.
- Si un rol se desactiva y el filtro de desactivados esta apagado, el rol puede
  salir de la lista visible.
