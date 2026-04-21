# Oportunidades

## Alcance

Gestion de oportunidades comerciales asociadas a cuentas y contactos:

- Alta de oportunidad con datos comerciales y de seguimiento.
- Edicion de oportunidad desde acciones por fila.
- Asignacion de un vendedor.
- Seleccion opcional de ingeniero preventa.
- Cambio de estado de activacion desde menu por fila.
- Visualizacion en tabla con filtros y ordenamiento.
- Auditoria visible en modo edicion.

## Puntos clave de UX

- Boton de crear oportunidad en encabezado.
- El boton aparece tanto con permiso de crear como de solicitar oportunidades.
- Creacion y edicion mediante ventana modal.
- Badge de estado de activacion de solo lectura en encabezado del modal de edicion.
- Secciones del formulario por contexto:
  - Datos principales.
  - Gestion comercial.
  - Auditoria en modo edicion.
- El listado muestra activadas y pendientes por defecto, y permite incluir desactivadas.
- Busqueda por texto y ordenamiento por columnas con flechas.
- Menu de acciones por fila con editar, activar, marcar pendiente y desactivar.

## API relacionada (resumen)

- GET /api/opportunities
- GET /api/opportunities/:id
- POST /api/opportunities
- PUT /api/opportunities/:id
- PATCH /api/opportunities/:id/status
- GET /api/catalogs/opportunity-accounts
- GET /api/catalogs/opportunity-contacts
- GET /api/catalogs/opportunity-seller-users
- GET /api/catalogs/opportunity-business-lines
- GET /api/catalogs/opportunity-sales-stages
- GET /api/catalogs/opportunity-activation-statuses

## Consideraciones

- Cada oportunidad debe estar asociada a una cuenta y a un contacto de esa misma cuenta.
- Los usuarios no administradores solo ven y operan oportunidades de cuentas de las que son propietarios.
- Los administradores pueden ver y operar todas las oportunidades.
- El identificador de la oportunidad corresponde al `id` interno del registro.
- Debe existir un vendedor con rol de vendedor.
- Preventa es opcional y corresponde a un usuario activo.
- Con `oportunidades.create`, la oportunidad se registra activada automaticamente.
- Con `oportunidades.request`, la oportunidad se registra en pendiente automaticamente.
- Solo usuarios con `oportunidades.create` pueden cambiar el estado de activacion de una oportunidad.
- El rol Administrador no sustituye esta regla: para oportunidades manda el permiso explicito.
- Si el usuario no tiene `oportunidades.create` ni `oportunidades.request`, no puede crear ni solicitar oportunidades.
- La auditoria se muestra en modo edicion al final del formulario.