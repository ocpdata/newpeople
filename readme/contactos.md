# Contactos

## Alcance

Gestion de contactos comerciales asociados a cuentas:

- Alta de contacto con datos personales, de empresa y de ubicacion.
- Edicion de contacto desde acciones por fila.
- Asignacion de catalogos (tipo de relacion, participacion en compra,
  situacion en empresa, estado de activacion).
- Jerarquia de contactos: jefe directo e influencias.
- Activacion, marcado pendiente y desactivacion de contactos.
- Visualizacion en tabla con filtros y ordenamiento.
- Auditoria de cambios por contacto.

## Puntos clave de UX

- Encabezado unificado: titulo con icono SVG, subtitulo, boton `+ Crear contacto` a la derecha.
- El boton aparece tanto con permiso de crear como de solicitar contactos.
- Barra de filtros: pills de estado (Todos / Activados / Pendientes / Desactivados) + busqueda inline.
- Creacion y edicion mediante ventana modal.
- Badge de estado (Activado/Desactivado/Pendiente) de solo lectura en encabezado del
  modal de edicion.
- Secciones del formulario por contexto:
  - Datos principales (nombre, puesto, cuenta).
  - Contacto (telefono, celular, email, departamento).
  - Ubicacion (pais, estado, ciudad, direccion).
  - Relacion y contexto (tipo de relacion, participacion en compra,
    situacion en empresa).
  - Jerarquia (jefe, contacto al que influye).
  - Auditoria (en modo edicion).
- Busqueda por texto y ordenamiento por columnas con flechas.
- Menu de acciones por fila (editar, activar, marcar pendiente, desactivar).
- Estado visual en tabla con badge (Activado/Desactivado/Pendiente).
- Paginacion con selector de 10 / 50 / 100 registros por pagina y navegacion previo/siguiente.

## API relacionada (resumen)

- GET /api/contacts
- GET /api/contacts/:id
- POST /api/contacts
- PUT /api/contacts/:id
- PATCH /api/contacts/:id/status

Permisos requeridos:

- contactos.read
- contactos.create
- contactos.request
- contactos.update

## Catalogos de contactos

Los siguientes catalogos aplican exclusivamente al modulo de contactos:

- contact_relationship_types (tipo de relacion)
- contact_purchase_participations (participacion en compra)
- contact_employment_statuses (situacion en empresa)
- contact_activation_statuses (estado de activacion)

## Consideraciones

- Cada contacto debe estar asociado a una cuenta (obligatorio).
- Los usuarios no administradores solo ven y operan contactos de cuentas de las que son propietarios.
- Los administradores pueden ver y operar todos los contactos.
- La jerarquia (jefe / influye en) es opcional y referencia otros contactos.
- Con `contactos.create`, el contacto se registra activado automaticamente.
- Con `contactos.request`, el contacto se registra en pendiente automaticamente.
- Solo usuarios con `contactos.create` pueden cambiar el estado de activacion de un contacto.
- El rol Administrador no sustituye esta regla: para contactos manda el permiso explicito.
- Si el usuario no tiene `contactos.create` ni `contactos.request`, no puede crear ni solicitar contactos.
- El estado de activacion se cambia desde el menu de acciones de la tabla,
  no desde el formulario de edicion.
- En modo edicion, el badge del encabezado muestra el estado actual de forma
  informativa.
- La auditoria se muestra en modo edicion al final del formulario.
