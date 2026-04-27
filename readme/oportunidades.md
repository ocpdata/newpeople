# Oportunidades

## Alcance

Gestion de oportunidades comerciales asociadas a cuentas y contactos:

- Alta de oportunidad con datos comerciales y de seguimiento.
- Edicion de oportunidad desde acciones por fila.
- Asignacion de un vendedor.
- Seleccion opcional de ingeniero preventa.
- Gestion de cotizaciones asociadas a la oportunidad en modo edicion.
- Gestion del proceso comercial por etapas con preguntas configurables.
- Cierre comercial como Ganada, Perdida o Anulada.
- Cambio de estado de activacion desde menu por fila.
- Visualizacion en tabla con filtros y ordenamiento.
- Auditoria visible en modo edicion.

## Logica de negocio

### Dependencias obligatorias

- Toda oportunidad pertenece a una cuenta.
- Toda oportunidad debe referenciar un contacto de esa misma cuenta.
- No se permite mezclar cuenta y contacto de cuentas distintas.

### Responsables comerciales

- El vendedor es obligatorio y debe ser un usuario activo con rol `Vendedor`.
- El preventa es opcional, pero si se asigna debe ser un usuario activo con rol `Preventa`.

### Estados y permisos

- `oportunidades.create` crea la oportunidad activada.
- `oportunidades.request` crea la oportunidad en `pendiente_activacion`.
- `oportunidades.update` permite editar datos sin cambiar estado de activacion.
- Solo `oportunidades.create` habilita cambios de estado posteriores.
- El rol `Administrador` no sustituye esta regla; para activacion manda el permiso explicito.

### Flujo comercial

- El backend fuerza `Contacto inicial` y `En proceso` al crear una oportunidad nueva.
- El avance de etapa exige que todas las preguntas obligatorias de la etapa actual tengan respuesta.
- El retroceso solo es valido mientras la oportunidad siga `En proceso`.
- `Ganada` solo puede aplicarse como cierre comercial desde `Waiting`.
- `Perdida` y `Anulada` pueden aplicarse desde cualquier etapa, pero exigen motivo.
- Una oportunidad cerrada ya no puede avanzar, retroceder ni guardar nuevas respuestas de etapa.
- El estado de activacion sigue siendo independiente del flujo comercial.

### Pantalla de preguntas comerciales

- Las preguntas se administran por etapa comercial y sin tocar código.
- El orden de preguntas es parte de la logica de negocio: la UI puede reordenar y el backend persiste la secuencia completa.
- Cada pregunta define tipo de respuesta, orden y si es obligatoria.
- Activar o desactivar una pregunta afecta la captura futura de oportunidades que consulten nuevamente el catalogo de su etapa.

### Alcance de acceso

- `oportunidades.read_all`: ve y opera todas las oportunidades y habilita cuentas/contactos ajenos en catalogos relacionados.
- Usuario no administrador: solo ve y opera oportunidades de cuentas de las que es propietario.

## Modelo funcional

La UI distingue tres conceptos separados:

- Etapa operativa: describe en qué punto del proceso comercial se encuentra la oportunidad.
- Estado comercial: describe si la oportunidad sigue En proceso o ya fue cerrada como Ganada, Perdida o Anulada.
- Estado de activacion: describe si el registro está Activado, Pendiente de activacion o Desactivado.

Las 7 etapas operativas vigentes son:

1. Contacto inicial
2. Identificacion de oportunidad
3. Desarrollo
4. Cotizacion
5. Demostracion
6. Negociacion
7. Waiting

Los 4 estados comerciales vigentes son:

1. En proceso
2. Ganada
3. Perdida
4. Anulada

`Ganada` ya no es una etapa operativa. Solo puede aplicarse como cierre comercial desde `Waiting`.

## Puntos clave de UX

- Encabezado unificado: titulo con icono SVG, subtitulo, boton `+ Crear oportunidad` a la derecha.
- El boton aparece tanto con permiso de crear como de solicitar oportunidades.
- Barra de filtros: pills de estado (Todos / Activadas / Pendientes / Desactivadas) + busqueda inline.
- Creacion y edicion mediante ventana modal.
- Badges separados de estado de activacion y estado comercial en el encabezado del modal de edicion.
- El encabezado del modal de edicion muestra tambien la etapa operativa actual como badge independiente.
- Secciones del formulario por contexto:
  - Datos principales.
  - Gestion comercial.
  - Proceso comercial.
  - Cotizaciones y versiones asociadas.
  - Auditoria en modo edicion.
- El bloque `Proceso comercial` usa un stepper clickable con las 7 etapas operativas.
- Al abrir una oportunidad en edicion, el step seleccionado coincide con la etapa actual de la oportunidad.
- Se puede hacer clic en etapas pasadas o futuras para revisar sus preguntas y respuestas en modo solo lectura.
- Solo la etapa actual permite guardar respuestas, avanzar, retroceder y cerrar sin mezclar estas acciones con la edicion de datos base.
- La pantalla `Preguntas comerciales` permite administrar preguntas por etapa sin tocar código.
- El listado muestra activadas y pendientes por defecto, y permite incluir desactivadas.
- Busqueda por texto y ordenamiento por columnas con flechas.
- El listado muestra por separado etapa operativa, estado comercial y estado de activacion.
- Menu de acciones por fila con editar, activar, marcar pendiente y desactivar.
- Paginacion con selector de 10 / 50 / 100 registros por pagina y navegacion previo/siguiente.

## Reglas del flujo comercial

- Toda oportunidad nueva inicia en `Contacto inicial` y `En proceso`, aunque el cliente intente enviar otros valores.
- El avance de etapa exige que todas las preguntas obligatorias de la etapa actual tengan respuesta.
- El retroceso solo está disponible mientras la oportunidad siga `En proceso`.
- `Ganada` solo puede aplicarse desde `Waiting`.
- `Perdida` y `Anulada` pueden aplicarse desde cualquier etapa, pero exigen motivo.
- Una oportunidad cerrada como `Ganada`, `Perdida` o `Anulada` ya no puede avanzar, retroceder ni guardar nuevas respuestas.
- El estado de activacion sigue siendo independiente del flujo comercial.

## API relacionada (resumen)

- GET /api/opportunities
- GET /api/opportunities/:id
- GET /api/opportunities/:id/commercial-context
- GET /api/opportunities/:id/stage-view/:salesStageId
- POST /api/opportunities
- PUT /api/opportunities/:id
- POST /api/opportunities/:id/stage-answers
- POST /api/opportunities/:id/stage-transition
- POST /api/opportunities/:id/commercial-close
- PATCH /api/opportunities/:id/status
- GET /api/opportunities/:id/quotations
- POST /api/opportunities/:id/quotations
- GET /api/catalogs/opportunity-accounts
- GET /api/catalogs/opportunity-contacts
- GET /api/catalogs/opportunity-seller-users
- GET /api/catalogs/opportunity-business-lines
- GET /api/catalogs/opportunity-sales-stages
- GET /api/catalogs/opportunity-commercial-statuses
- GET /api/catalogs/opportunity-activation-statuses
- GET /api/catalogs/opportunity-stage-questions
- GET /api/catalogs/opportunity-stage-questions-admin
- POST /api/catalogs/opportunity-stage-questions
- PUT /api/catalogs/opportunity-stage-questions/:id
- PATCH /api/catalogs/opportunity-stage-questions/:id/status
- POST /api/catalogs/opportunity-stage-questions/reorder

Las APIs especificas del modulo de cotizaciones se documentan en `cotizaciones.md`.

## Consideraciones

- Cada oportunidad debe estar asociada a una cuenta y a un contacto de esa misma cuenta.
- Los usuarios no administradores solo ven y operan oportunidades de cuentas de las que son propietarios.
- Usuarios con `oportunidades.read_all` pueden ver y operar todas las oportunidades.
- El identificador de la oportunidad corresponde al `id` interno del registro.
- Debe existir un vendedor con rol de vendedor.
- Preventa es opcional y corresponde a un usuario activo.
- Con `oportunidades.create`, la oportunidad se registra activada automaticamente.
- Con `oportunidades.request`, la oportunidad se registra en pendiente automaticamente.
- El backend fuerza `Contacto inicial` y `En proceso` al crear la oportunidad.
- Solo usuarios con `oportunidades.create` pueden cambiar el estado de activacion de una oportunidad.
- El rol Administrador no sustituye esta regla: para oportunidades manda el permiso explicito.
- Si el usuario no tiene `oportunidades.create` ni `oportunidades.request`, no puede crear ni solicitar oportunidades.
- La auditoria se muestra en modo edicion al final del formulario.
- Las respuestas por etapa se guardan con histórico; una nueva captura no sobrescribe la anterior.
- `commercial-context` devuelve la etapa actual junto con el resumen de todas las etapas para pintar el stepper inicial.
- `stage-view/:salesStageId` devuelve la vista de cualquier etapa activa de la oportunidad, manteniendo visible cuál sigue siendo la etapa actual.
