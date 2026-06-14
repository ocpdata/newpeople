# Roles y permisos

## Alcance

Administracion de roles y permisos del sistema:

- Creacion de roles.
- Edicion de nombre y descripcion del rol.
- Activacion y desactivacion de roles.
- Asignacion de permisos por rol.
- Consulta de usuarios asociados a un rol.
- Visualizacion de auditoria del rol seleccionado.

## Logica de negocio

### Permisos efectivos

- Los permisos efectivos de un usuario salen de la union de permisos de sus roles activos.
- Un rol inactivo deja de aportar permisos aunque siga asignado al usuario.
- El rol `Administrador` funciona como bypass general de autorizacion, salvo reglas comerciales donde sigue mandando el permiso explicito `*.create` para cambios de estado.

### Ciclo de vida del rol

- Crear o editar un rol solo afecta nombre y descripcion; los permisos se gestionan como una operacion separada.
- La asignacion de permisos debe ser explicita y auditable.
- Un rol del sistema no debe desactivarse desde UI.
- Un rol no puede desactivarse mientras siga teniendo usuarios asignados; primero deben retirarse o reasignarse.

### Impacto operativo

- Cambiar permisos de un rol afecta a todos los usuarios que lo tengan asignado y activo.
- Si se actualizan permisos del rol del usuario actual, la aplicacion debe refrescar su contexto para recalcular navegacion y acciones disponibles.
- La seleccion de un rol en pantalla debe cargar inmediatamente permisos, usuarios asociados y su auditoria resumida.

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

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
