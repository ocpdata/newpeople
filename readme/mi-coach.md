# Mi Coach

Mi Coach es el asistente comercial dentro de Mi Coach. Usa el contexto real del CRM para responder preguntas sobre cuentas, contactos y oportunidades, y puede proponer cambios que el vendedor revisa antes de guardar.

## Objetivo

Mi Coach ayuda al vendedor a:

- Entender la situación de una oportunidad.
- Identificar riesgos, necesidades y próximos pasos.
- Consultar información de cuentas, contactos y oportunidades.
- Crear o actualizar actividades comerciales.
- Proponer respuestas para preguntas de etapa cuando una afirmación del vendedor coincide claramente con una pregunta existente.

Mi Coach no guarda cambios automáticamente. Toda operación propuesta debe revisarse y confirmarse.

## Uso

1. Abre el módulo **Mi Coach**.
2. Selecciona una cuenta activa.
3. Opcionalmente selecciona una oportunidad y un contacto.
4. Revisa las estadísticas y preguntas rápidas.
5. Escribe una pregunta en el campo del Coach o elige una pregunta rápida.
6. Revisa la respuesta y cualquier operación propuesta.
7. Cuando corresponda, selecciona **Revisar y confirmar**.
8. Edita los datos si es necesario y confirma el guardado.

La cuenta es el contexto principal. La oportunidad y el contacto dependen de la cuenta seleccionada y solo muestran registros activos y accesibles para el usuario.

## Tipos de consulta

### Consulta informativa

Responde usando el contexto disponible, sin proponer cambios.

Ejemplos:

- "¿Cuál es la motivación del cliente?"
- "¿Qué oportunidades tienen riesgo?"
- "¿Qué contactos importantes tiene esta cuenta?"

### Recomendación

Explica qué conviene hacer, pero no crea una actividad ni modifica el CRM por sí sola.

### Solicitud de cambio

Cuando el vendedor pide crear o modificar algo, Mi Coach genera una operación editable. La operación aparece con el botón **Revisar y confirmar**.

## Actividades comerciales

Las solicitudes explícitas de actividad conservan su flujo actual: el Coach propone la actividad, muestra el modal de confirmación y solo la guarda después de la aprobación.

El catálogo contiene ocho tipos:

- **Llamada** (`call`)
- **Reunión** (`conference`)
- **Demostración** (`presentation`)
- **Visita** (`visit`)
- **Correo** (`send_email`)
- **Tarea de seguimiento** (`next_step`)
- **Esperando cliente** (`waiting_customer`)
- **Otro** (`other`)

Una actividad puede incluir:

- Oportunidad.
- Título.
- Tipo.
- Fecha y hora programada.
- Fecha límite.
- Prioridad.
- Notas.
- Criterio de éxito.

Las prioridades disponibles son **Crítica**, **Alta**, **Media** y **Baja**.

Ejemplos de solicitudes:

- "Crea una llamada con el cliente para mañana."
- "Agenda una demostración para el 1 de octubre."
- "Registra una actividad de seguimiento para esta oportunidad."

Si falta la oportunidad, el Coach pide seleccionarla antes de continuar.

## Respuestas de etapa

Mi Coach también puede detectar que una afirmación del vendedor responde una pregunta de etapa, aunque el vendedor no use explícitamente la palabra "registrar".

Por ejemplo:

> "La motivación del cliente es evitar problemas de ciberseguridad."

Si existe una pregunta de etapa compatible, Mi Coach puede proponer una operación `stage_answer` con:

- La pregunta de etapa identificada.
- El texto que propone guardar.
- La respuesta anterior, si existe.
- La opción de reemplazar o agregar el nuevo texto.

El vendedor debe revisar y confirmar antes de modificar la respuesta de etapa. Si la coincidencia es ambigua o débil, Mi Coach responde sin proponer cambios.

Una solicitud explícita de actividad tiene prioridad y no se convierte en una respuesta de etapa.

## Confirmación y seguridad

- Las operaciones se muestran antes de ejecutarse.
- El vendedor puede editar valores en el modal de confirmación.
- Los permisos del usuario se validan antes de mostrar o ejecutar operaciones.
- Las entidades deben pertenecer al contexto accesible del usuario.
- Las operaciones se registran en auditoría cuando corresponde.
- Algunas operaciones permiten deshacer el último cambio.
- Los errores de guardado se muestran en el chat y en el modal.

Mi Coach no debe inventar IDs, oportunidades, contactos, fechas ni respuestas de etapa que no existan en el contexto.

## Métricas

El panel muestra datos de los últimos 30 días:

- **Consultas:** preguntas enviadas al Coach.
- **Decididas:** propuestas que terminaron aprobadas o rechazadas.
- **Aprobadas:** operaciones guardadas después de la confirmación.
- **Rechazadas:** propuestas descartadas por el vendedor.
- **Completadas:** operaciones aprobadas que posteriormente se marcaron como finalizadas.

Las métricas de consultas se calculan solo para consultas del Coach, no para todo el consumo de IA del sistema.

## API

Las rutas principales están bajo `/api/mi-agent`:

- `GET /api/mi-agent/context`: carga el contexto disponible.
- `POST /api/mi-agent/coach`: inicia una consulta asíncrona.
- `GET /api/mi-agent/coach/jobs/:jobId`: consulta el resultado de una consulta.
- `GET /api/mi-agent/coach/metrics`: obtiene las métricas del panel.
- `POST /api/mi-agent/coach/operations/rejected`: registra una propuesta rechazada.
- `POST /api/mi-agent/coach/operations/:auditId/undo`: deshace una operación compatible.

Las actividades se guardan mediante las rutas oficiales de Desarrollo Comercial:

- `POST /api/commercial-development/opportunities/:opportunityId/activities`
- `PATCH /api/commercial-development/opportunities/:opportunityId/activities/:activityId`

Las respuestas de etapa se guardan mediante la ruta oficial de oportunidades:

- `POST /api/opportunities/:opportunityId/stage-answers`

## Permisos

El acceso de lectura al Coach requiere `oportunidades.read`.

Las operaciones requieren además el permiso correspondiente al dominio que se modifica. Por ejemplo, las actividades requieren permisos de actualización de Desarrollo Comercial y de la oportunidad. La interfaz oculta o deshabilita operaciones que el usuario no puede ejecutar.

## Límites actuales

- El contexto se limita a registros activos y accesibles.
- Las respuestas dependen de la información disponible en el CRM.
- Una coincidencia de etapa debe ser suficientemente clara para generar una propuesta.
- El Coach no ejecuta modificaciones automáticamente.
- El análisis y las consultas se procesan como trabajos asíncronos.

## Archivos principales

- `apps/web/src/MiAgentPage.jsx`: interfaz, contexto, chat, confirmaciones y operaciones.
- `apps/web/src/mi-agent-coach.css`: estilos del panel del Coach.
- `apps/api/src/routes.mi-agent.js`: contexto, prompt, normalización, trabajos y métricas.
- `apps/api/src/routes.execution-commercial.js`: actividades oficiales de Desarrollo Comercial.
- `apps/api/test/mi-agent-coach-operations.test.js`: pruebas de normalización y seguridad de operaciones.
