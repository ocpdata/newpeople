# Roles y permisos

## Alcance

Administracion de roles y permisos del sistema:

- Creacion de roles.
- Activacion y desactivacion de roles.
- Asignacion de permisos por rol.
- Consulta de usuarios asociados a un rol.
- Visualizacion de auditoria del rol seleccionado.

## Puntos clave de UX

- Boton de crear rol alineado en encabezado.
- Creacion de rol mediante ventana modal.
- Filtro Mostrar desactivados para incluir o excluir roles inactivos.
- Listado de roles con badge de estado (Activo/Desactivado).
- Conteos visibles por modulo:
  roles totales, permisos totales y usuarios del rol seleccionado.
- Seleccion de rol con actualizacion inmediata de:
  permisos asignados, usuarios asociados y datos de auditoria.
- Confirmacion previa para cambios sensibles de estado.

## API relacionada (resumen)

- GET /api/roles
- POST /api/roles
- PATCH /api/roles/:id/status
- GET /api/roles/permissions
- PUT /api/roles/:id/permissions
- GET /api/roles/:id/users

## Consideraciones

- Los roles de sistema no deben desactivarse accidentalmente.
- La asignacion de permisos debe ser explicita y revisable.
- Los cambios de estado deben quedar auditables.
- Si un rol se desactiva y el filtro de desactivados esta apagado, el rol puede
  salir de la lista visible.
