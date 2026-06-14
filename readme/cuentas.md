# Cuentas

## Alcance

Gestion de cuentas comerciales:

- Alta de cuenta con datos fiscales y de ubicacion.
- Edicion de cuenta desde acciones por fila.
- Seleccion de catalogos (tipo, sector, pais y estado de activacion interno).
- Asignacion de usuarios propietarios.
- Activacion, marcado pendiente y desactivacion de cuentas.
- Visualizacion en tabla con filtros y ordenamiento.

## Logica de negocio

### Naturaleza de la entidad

- La cuenta es la raiz operativa para contactos y oportunidades.
- No se deben crear contactos ni oportunidades fuera del contexto de una cuenta existente.

### Propietarios y ownership

- Toda cuenta debe tener al menos un propietario.
- La propiedad es N:M entre cuentas y usuarios.
- Los propietarios activos determinan visibilidad y operacion para usuarios no administradores.
- Una cuenta activa no debe quedar sin propietarios activos.
- Los propietarios inactivos se conservan por trazabilidad, pero no deben reemplazar al menos un propietario vigente.

### Estados y permisos

- `cuentas.create` crea la cuenta activada.
- `cuentas.request` crea la cuenta en `pendiente_activacion`.
- `cuentas.update` permite editar datos sin implicar cambio de estado.
- Solo `cuentas.create` habilita cambios de estado posteriores.
- El rol `Administrador` no sustituye esta regla; para activacion manda el permiso explicito.

### Restricciones de estado

- Una cuenta no puede desactivarse si tiene contactos activos.
- Una cuenta no puede marcarse como pendiente si tiene contactos activos o desactivados.
- Los cambios de estado deben reflejarse de inmediato en tabla, badges y acciones disponibles.

### Alcance de acceso

- `cuentas.read_all`: ve y opera todas las cuentas sin depender del rol `Administrador`.
- Usuario no administrador: solo ve y opera cuentas de las que es propietario.

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
- Usuarios con `cuentas.read_all` pueden ver y operar todas las cuentas.
- Con `cuentas.create`, la cuenta se registra activada automaticamente.
- Con `cuentas.request`, la cuenta se registra en pendiente automaticamente.
- Solo usuarios con `cuentas.create` pueden cambiar el estado de activacion de una cuenta.
- El rol Administrador no sustituye esta regla: para cuentas manda el permiso explicito.
- Si el usuario no tiene `cuentas.create` ni `cuentas.request`, no puede crear ni solicitar cuentas.
- Mantener consistencia de datos entre formulario y tabla.
- En modo edicion se muestra auditoria de la cuenta debajo de propietarios.
- Los cambios de estado deben reflejarse de inmediato en tabla y badges.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
