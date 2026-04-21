# Cuentas

## Alcance

Gestion de cuentas comerciales:

- Alta de cuenta con datos fiscales y de ubicacion.
- Edicion de cuenta desde acciones por fila.
- Seleccion de catalogos (tipo, sector, pais y estado de activacion interno).
- Asignacion de usuarios propietarios.
- Activacion, marcado pendiente y desactivacion de cuentas.
- Visualizacion en tabla con filtros y ordenamiento.

## Puntos clave de UX

- Encabezado unificado: titulo con icono SVG, subtitulo, boton `+ Crear cuenta` a la derecha.
- El boton aparece tanto con permiso de crear como de solicitar cuentas.
- Barra de filtros: pills de estado (Todos / Activadas / Pendientes / Desactivadas) + busqueda inline.
- Creacion y edicion mediante ventana modal.
- Badge de estado de activacion de solo lectura en encabezado del modal de edicion.
- Secciones del formulario por contexto (datos principales, ubicacion,
  descripcion, propietarios, auditoria en edicion).
- Registro no obligatorio: si no se captura se envia vacio.
- Propietarios obligatorios, con doble vista:
  tarjetas de seleccionados + lista scrolleable de seleccion.
- Menu de acciones por fila (editar, activar, marcar pendiente, desactivar).
- Estado visual en tabla con badge (Activada/Desactivada/Pendiente).
- Busqueda por texto y ordenamiento por columnas con flechas.
- Paginacion con selector de 10 / 50 / 100 registros por pagina y navegacion previo/siguiente.

## API relacionada (resumen)

- GET /api/accounts
- GET /api/accounts/:id
- POST /api/accounts
- PUT /api/accounts/:id
- PATCH /api/accounts/:id/status
- GET /api/catalogs/account-owner-users
- GET /api/catalogs/countries
- GET /api/catalogs/account-types
- GET /api/catalogs/economic-sectors
- GET /api/catalogs/account-activation-statuses

## Consideraciones

- Validar catalogos antes de crear.
- Asegurar al menos un propietario (obligatorio).
- La seleccion de propietarios usa un catalogo minimo de usuarios activos y no requiere acceso al modulo de usuarios.
- Los usuarios no administradores solo ven y operan cuentas de las que son propietarios.
- Los administradores pueden ver y operar todas las cuentas.
- Con `cuentas.create`, la cuenta se registra activada automaticamente.
- Con `cuentas.request`, la cuenta se registra en pendiente automaticamente.
- Solo usuarios con `cuentas.create` pueden cambiar el estado de activacion de una cuenta.
- El rol Administrador no sustituye esta regla: para cuentas manda el permiso explicito.
- Si el usuario no tiene `cuentas.create` ni `cuentas.request`, no puede crear ni solicitar cuentas.
- Mantener consistencia de datos entre formulario y tabla.
- En modo edicion se muestra auditoria de la cuenta debajo de propietarios.
- Los cambios de estado deben reflejarse de inmediato en tabla y badges.
