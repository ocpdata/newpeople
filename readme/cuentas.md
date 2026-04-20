# Cuentas

## Alcance

Gestion de cuentas comerciales:

- Alta de cuenta con datos fiscales y de ubicacion.
- Edicion de cuenta desde acciones por fila.
- Seleccion de catalogos (tipo, sector, pais y estado de activacion interno).
- Asignacion de usuarios propietarios.
- Activacion y desactivacion de cuentas.
- Visualizacion en tabla con filtros y ordenamiento.

## Puntos clave de UX

- Boton de crear cuenta en encabezado.
- Creacion y edicion mediante ventana modal.
- Badge de estado de activacion de solo lectura en encabezado del modal de edicion.
- Secciones del formulario por contexto (datos principales, ubicacion,
  descripcion, propietarios, auditoria en edicion).
- Registro no obligatorio: si no se captura se envia vacio.
- Propietarios obligatorios, con doble vista:
  tarjetas de seleccionados + lista scrolleable de seleccion.
- Menu de acciones por fila (editar, activar, desactivar).
- Estado visual en tabla con badge (Activada/Desactivada).
- Filtro "Mostrar desactivadas" (por defecto solo activadas).
- Busqueda por texto y ordenamiento por columnas con flechas.

## API relacionada (resumen)

- GET /api/accounts
- GET /api/accounts/:id
- POST /api/accounts
- PUT /api/accounts/:id
- PATCH /api/accounts/:id/status
- GET /api/catalogs/countries
- GET /api/catalogs/account-types
- GET /api/catalogs/economic-sectors
- GET /api/catalogs/account-activation-statuses

## Consideraciones

- Validar catalogos antes de crear.
- Asegurar al menos un propietario (obligatorio).
- Mantener consistencia de datos entre formulario y tabla.
- En modo edicion se muestra auditoria de la cuenta debajo de propietarios.
- Los cambios de estado deben reflejarse de inmediato en tabla y badges.
