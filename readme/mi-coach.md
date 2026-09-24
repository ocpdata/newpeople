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
2. Entra a la pestaña **Coach** para usar la experiencia actual.
3. Selecciona una cuenta activa.
4. Opcionalmente selecciona una oportunidad y un contacto.
5. Revisa las estadísticas y preguntas rápidas.
6. Escribe una pregunta en el campo del Coach o elige una pregunta rápida.
7. Revisa la respuesta y cualquier operación propuesta.
8. Cuando corresponda, selecciona **Revisar y confirmar**.
9. Edita los datos si es necesario y confirma el guardado.

La cuenta es el contexto principal. La oportunidad y el contacto dependen de la cuenta seleccionada y solo muestran registros activos y accesibles para el usuario.

## Espacios internos

Mi Coach se organiza en tres espacios internos:

- **Coach**: conserva la experiencia actual de chat, análisis comercial, preguntas rápidas y operaciones confirmables.
- **Cliente existente**: ejecuta inteligencia comercial interna sobre cuentas, contactos y oportunidades ya registradas.
- **Cuenta nueva**: ejecuta prospección asistida antes de crear registros reales en el CRM.

La pestaña **Cliente existente** ofrece dos acciones: **Analizar cuenta**, que usa exclusivamente datos internos del CRM, y **Enriquecer con fuentes públicas**, que ejecuta la orquestación Tavily/OpenAI para contactos, tecnología e iniciativas públicas. La pestaña **Cuenta nueva** permite capturar empresa, país, sitio e industria, generar una ficha de prospección, revisar contactos objetivo, hipótesis de oportunidad, hallazgos y correo inicial. Ninguna de estas funciones crea registros reales automáticamente.

### Contrato de Account Intelligence

La inteligencia de **Cliente existente** usa un contrato común para que los resultados internos y externos puedan combinarse sin perder trazabilidad. El alcance funcional contempla:

- resumen ejecutivo;
- salud de cuenta;
- riesgos;
- oportunidades;
- contactos clave;
- actividad reciente;
- investigación pública;
- renovación y expansión;
- acciones recomendadas.

Cada hallazgo conserva categoría, título, resumen, evidencia, fuente, URL o referencia, confianza, certeza y, cuando aplica, entidad/campo/valor sugeridos. Los hallazgos que pueden modificar el CRM incluyen `requiresConfirmation=true` y nunca se aplican sin confirmación del vendedor.

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

## Inteligencia comercial interna

La Fase 1 agrega el dominio backend de inteligencia comercial para clientes existentes. Este dominio prepara jobs asíncronos, snapshot autorizado por permisos, hallazgos sugeridos y confirmación o rechazo de hallazgos.

Endpoints principales:

- `POST /api/commercial-intelligence/customer-research/jobs`: crea una investigación interna sobre una cuenta, oportunidad o contacto accesible.
- `GET /api/commercial-intelligence/customer-research/jobs/:jobId`: consulta el estado, resultado y hallazgos del job.
- `GET /api/commercial-intelligence/findings`: lista hallazgos filtrados por cuenta, oportunidad, contacto o estado.
- `POST /api/commercial-intelligence/findings/:findingId/confirm`: confirma un hallazgo sugerido.
- `POST /api/commercial-intelligence/findings/:findingId/reject`: rechaza un hallazgo sugerido.
- `POST /api/commercial-intelligence/commercial-discovery/jobs`: prepara un briefing comercial para llamada usando el contexto interno.
- `GET /api/commercial-intelligence/commercial-discovery/jobs/:jobId`: consulta el briefing comercial generado.
- `POST /api/commercial-intelligence/external-research/jobs`: ejecuta investigación externa controlada para un cliente existente.
- `GET /api/commercial-intelligence/external-research/jobs/:jobId`: consulta el resultado de la investigación externa.
- `GET /api/commercial-intelligence/automatic-briefing/next`: prepara un briefing automático para la próxima actividad comercial accesible.
- `GET /api/commercial-intelligence/account-intelligence/snapshot`: devuelve el snapshot autorizado y versionado de una cuenta, oportunidad o contacto.
- `POST /api/commercial-intelligence/executive-briefing/jobs`: inicia una síntesis ejecutiva basada en el snapshot autorizado.
- `GET /api/commercial-intelligence/executive-briefing/jobs/:jobId`: consulta el resumen ejecutivo generado.
- `POST /api/commercial-intelligence/agents/jobs`: ejecuta la orquestación de agentes especializados sobre un snapshot autorizado.
- `GET /api/commercial-intelligence/agents/jobs/:jobId`: consulta los resultados de la orquestación.
- `GET /api/commercial-intelligence/agents/metrics`: devuelve jobs y consumo de IA de Account Intelligence de los últimos 30 días.

Los hallazgos se generan inicialmente con reglas internas sobre datos del CRM, sin fuentes externas ni IA generativa. Cada hallazgo incluye categoría, resumen, evidencia, fuente, confianza, certeza y estado.

El snapshot `account-intelligence.v1` incluye cuenta, contactos, oportunidades, interacciones/actividades, renovaciones de registros de fabricantes y partidas de cotizaciones con estado `ganada` o `aceptada`. Estas partidas se clasifican como `won` o `accepted` y `fulfillmentStatus: not_verified`; no se presentan como compradas porque el CRM no confirma adquisición mediante factura u orden de compra. Los casos de soporte quedan fuera de esta fase y `dataAvailability.supportCases` permanece en `false`.

La expansión comercial se entrega como hipótesis determinística (`renewal`, `upsell` o `cross_sell`) basada en renovaciones, productos actuales y catálogo activo. Cada hipótesis incluye evidencia y `requiresConfirmation=true`; no crea oportunidades ni afirma una compra sin confirmación del vendedor.

La Fase 8 orquesta agentes internos con el contrato `account-intelligence.agents.v1`: `crm_context`, `commercial_health`, `public_research`, `expansion`, `synthesis` y `actions`. Todos reciben el snapshot autorizado; el agente de acciones solo propone cambios y el resultado declara `writesPerformed=false`. La API mantiene permisos, persistencia, auditoría y confirmación humana.

La búsqueda pública de contactos prioriza tecnología, seguridad, infraestructura, operaciones, arquitectura, producto, innovación, transformación digital, usuarios responsables, influenciadores técnicos, responsables regionales, líderes de proyecto y compras. Finanzas, CFO y cargos equivalentes no forman parte del targeting público; los contactos financieros existentes del CRM no se eliminan.

La observabilidad de Account Intelligence conserva telemetría por ejecución: duración, fuentes, hallazgos, estado de jobs, tokens y costo registrado en el ledger IA. Las métricas no exponen prompts ni credenciales.

El briefing comercial incluye objetivo de llamada, contacto objetivo, preguntas de descubrimiento, riesgos, guion de llamada, próximos pasos sugeridos y un correo inicial editable. Los próximos pasos pueden convertirse en tareas desde la interfaz cuando exista una oportunidad seleccionada y el usuario tenga permisos de actualización.

El briefing automático detecta la próxima actividad comercial accesible del usuario y genera una preparación rápida con preguntas, riesgos, guion y correo sugerido. Si no hay actividades próximas, devuelve un mensaje claro sin fallar.

La investigación externa controlada usa Tavily cuando `TAVILY_ENABLE_SEARCH=true`, existe `TAVILY_API_KEY` y la gobernanza permite fuentes externas. OpenAI interpreta los resultados de Tavily sin realizar una búsqueda adicional. Si Tavily no está habilitado, el job termina correctamente con una advertencia. Todo hallazgo externo queda como sugerido, con proveedor, URL, evidencia y certeza `evidenced`; no se confirma automáticamente.

## Prospección asistida

La Fase 4 agrega el dominio backend de prospección para cuentas nuevas. Este dominio permite crear una sesión antes de registrar una cuenta real en el CRM, ejecutar una investigación determinística y guardar una ficha inicial con hallazgos, contactos objetivo e hipótesis de oportunidad.

Endpoints principales:

- `POST /api/prospect-research/sessions`: crea una sesión de prospección con empresa, país, sitio web opcional e industria opcional.
- `GET /api/prospect-research/sessions/:sessionId`: consulta la sesión, ficha, hallazgos, contactos sugeridos e hipótesis.
- `POST /api/prospect-research/sessions/:sessionId/run`: genera la ficha de prospección.
- `POST /api/prospect-research/sessions/:sessionId/run-external`: ejecuta investigación externa controlada para la cuenta nueva.
- `POST /api/prospect-research/findings/:findingId/confirm`: confirma un hallazgo sugerido.
- `POST /api/prospect-research/findings/:findingId/reject`: rechaza un hallazgo sugerido.
- `POST /api/prospect-research/sessions/:sessionId/convert-to-account`: crea o vincula una cuenta desde la sesión.
- `POST /api/prospect-research/sessions/:sessionId/convert-to-lead`: crea un lead/interacción desde la sesión.
- `POST /api/prospect-research/contacts/:contactId/convert`: convierte un contacto objetivo en contacto CRM.
- `POST /api/prospect-research/hypotheses/:hypothesisId/convert-to-opportunity`: convierte una hipótesis en oportunidad preliminar.

La prospección no crea cuentas, contactos, leads ni oportunidades automáticamente. El vendedor debe confirmar cada conversión desde la ficha y el API valida los permisos del dominio destino antes de crear registros reales.

## Permisos

El acceso al módulo requiere `mi_coach.use`. Este permiso solo habilita abrir Mi Coach, cargar sus métricas y hacer preguntas al asistente.

El contexto respeta los permisos de cada registro. Mi Coach solo puede usar datos de cuentas, contactos, oportunidades o leads cuando el usuario tiene los permisos de lectura correspondientes:

- Cuentas: `cuentas.read` o `cuentas.read_all`.
- Contactos: `contactos.read` o `contactos.read_all`.
- Oportunidades: `oportunidades.read` o `oportunidades.read_all`.
- Leads/interacciones: `interacciones.read` o `interacciones.read_all`.

Las operaciones requieren además `mi_coach.execute` y el permiso correspondiente al dominio que se modifica. Por ejemplo, las actividades requieren permisos de actualización de Desarrollo Comercial y de la oportunidad. La interfaz oculta o deshabilita operaciones que el usuario no puede ejecutar, y el API vuelve a validar los permisos antes de aceptar operaciones reversibles.

La inteligencia comercial interna requiere además:

- `inteligencia_comercial.read`: crear y consultar investigaciones y hallazgos.
- `inteligencia_comercial.update`: confirmar o rechazar hallazgos.
- `inteligencia_comercial.admin`: administrar gobierno y configuración futura del dominio.

La prospección asistida requiere además:

- `prospeccion.read`: ver sesiones y fichas de prospección.
- `prospeccion.create`: crear y ejecutar investigaciones de cuenta nueva.
- `prospeccion.update`: confirmar o rechazar hallazgos de prospección.
- `prospeccion.admin`: administrar gobierno y configuración futura del dominio.

Las investigaciones con fuentes públicas requieren además `fuentes_externas.execute`.

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
