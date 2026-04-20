# Contactos

## Alcance

Gestion de contactos comerciales asociados a cuentas:

- Alta de contacto con datos personales, de empresa y de ubicacion.
- Edicion de contacto desde acciones por fila.
- Asignacion de catalogos (tipo de relacion, participacion en compra,
  situacion en empresa, estado de activacion).
- Jerarquia de contactos: jefe directo e influencias.
- Activacion y desactivacion de contactos.
- Visualizacion en tabla con filtros y ordenamiento.
- Auditoria de cambios por contacto.

## Puntos clave de UX

- Boton de crear contacto en encabezado.
- Creacion y edicion mediante ventana modal.
- Badge de estado (Activado/Desactivado) de solo lectura en encabezado del
  modal de edicion.
- Secciones del formulario por contexto:
  - Datos principales (nombre, puesto, cuenta).
  - Contacto (telefono, celular, email, departamento).
  - Ubicacion (pais, estado, ciudad, direccion).
  - Relacion y contexto (tipo de relacion, participacion en compra,
    situacion en empresa).
  - Jerarquia (jefe, contacto al que influye).
  - Auditoria (en modo edicion).
- Filtro "Mostrar desactivados" (por defecto solo activados).
- Busqueda por texto y ordenamiento por columnas con flechas.
- Menu de acciones por fila (editar, activar, desactivar).
- Estado visual en tabla con badge (Activado/Desactivado).

## API relacionada (resumen)

- GET /api/contacts
- GET /api/contacts/:id
- POST /api/contacts
- PUT /api/contacts/:id
- PATCH /api/contacts/:id/status

Permisos requeridos:

- contactos.read
- contactos.create
- contactos.update

## Catalogos de contactos

Los siguientes catalogos aplican exclusivamente al modulo de contactos:

- contact_relationship_types (tipo de relacion)
- contact_purchase_participations (participacion en compra)
- contact_employment_statuses (situacion en empresa)
- contact_activation_statuses (estado de activacion)

## Consideraciones

- Cada contacto debe estar asociado a una cuenta (obligatorio).
- La jerarquia (jefe / influye en) es opcional y referencia otros contactos.
- El estado de activacion se cambia desde el menu de acciones de la tabla,
  no desde el formulario de edicion.
- En modo edicion, el badge del encabezado muestra el estado actual de forma
  informativa.
- La auditoria se muestra en modo edicion al final del formulario.
