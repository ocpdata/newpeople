# Especificación funcional del Chat Coach

Este documento describe exclusivamente el tab **Coach**. El módulo completo, el motor compartido y las integraciones con Cliente existente y Cuenta nueva se documentan en [Arquitectura Mi Coach](./arquitectura-mi-coach.md), [Motor Conversacional Mi Coach](./motor-conversacional-mi-coach.md) e [Integraciones Mi Coach](./integraciones-mi-coach.md).

Mi Coach es el asistente comercial del vendedor dentro del CRM. Usa el contexto real del CRM para responder preguntas sobre cuentas, contactos, leads y oportunidades, y guía al vendedor para avanzar de manera ordenada y sólida a través de las etapas del proceso comercial.

Mi Coach debe funcionar como un director comercial: ayuda a entender la situación de cada oportunidad, identifica riesgos e información faltante, recomienda próximos pasos y orienta al vendedor hacia la acción más conveniente. No sustituye el criterio del vendedor ni reemplaza los módulos existentes del CRM; los coordina desde una experiencia conversacional más sencilla.

## Objetivo

Mi Coach ayuda al vendedor a:

- Entender la situación de una cuenta, contacto, lead u oportunidad.
- Avanzar una oportunidad con disciplina a través de las etapas del proceso comercial.
- Identificar riesgos, bloqueos, necesidades, información faltante y próximos pasos.
- Consultar información de cuentas, contactos, leads y oportunidades.
- Preparar reuniones, llamadas, demostraciones, negociaciones y seguimientos.
- Iniciar la creación de cuentas, contactos, oportunidades, leads, mapeos de contactos, cotizaciones, propuestas y actividades.
- Proponer actualizaciones de campos de los registros permitidos.
- Proponer respuestas para preguntas de etapa cuando una afirmación del vendedor coincide claramente con una pregunta existente.

Mi Coach no guarda cambios automáticamente. Toda creación o actualización debe revisarse y aprobarse explícitamente por el vendedor en el módulo correspondiente o en el flujo de confirmación definido para la operación.

## Principios de funcionamiento

- **Primero comprende, después propone:** el Coach debe identificar la intención, el contexto y la información faltante antes de recomendar una acción.
- **El proceso comercial es la referencia:** las recomendaciones deben relacionarse con la etapa actual, sus preguntas, sus resultados esperados y la evidencia disponible.
- **El vendedor conserva el control:** el Coach orienta y prepara; el vendedor revisa, corrige y aprueba.
- **Los módulos siguen siendo responsables:** cada módulo conserva sus formularios, validaciones, permisos, reglas de negocio y guardado final.
- **No se inventan datos:** las respuestas deben distinguir hechos confirmados, inferencias, recomendaciones y datos pendientes.
- **Cada acción debe tener un resultado verificable:** una recomendación debe indicar qué se busca conseguir y cómo se sabrá si se completó.
- **La conversación debe tener continuidad:** el contexto y las acciones pendientes deben poder recuperarse cuando el vendedor regrese.

## Uso

1. Abre el módulo **Mi Coach**.
2. Entra a la pestaña **Coach** para usar la experiencia actual.
3. Selecciona una cuenta, oportunidad o contacto cuando quieras limitar el contexto. También puedes mencionar la entidad directamente en la conversación.
4. Revisa las estadísticas y preguntas rápidas.
5. Escribe una pregunta, una necesidad o una instrucción en el campo del Coach.
6. Revisa la respuesta, las recomendaciones y cualquier dato faltante.
7. Si solicitas crear un registro, confirma la información que el Coach preparó y continúa en el módulo correspondiente.
8. Revisa, completa y aprueba el formulario antes de guardarlo.
9. Regresa al chat para continuar la conversación desde el mismo contexto.

La cuenta es el contexto principal. La oportunidad y el contacto dependen de la cuenta seleccionada y solo muestran registros activos y accesibles para el usuario. Si el vendedor menciona una oportunidad de forma clara y única, el Coach puede identificarla sin que haya sido seleccionada previamente.

## Uso del proceso comercial

Mi Coach debe utilizar como marco de referencia el [Proceso Comercial](./proceso-comercial.md). No debe limitarse a responder preguntas aisladas: debe evaluar si la oportunidad tiene fundamentos suficientes para avanzar de manera segura a la siguiente etapa.

El proceso comercial contempla siete etapas:

1. Contacto Inicial.
2. Identificación de Oportunidad.
3. Desarrollo.
4. Cotización.
5. Demostración.
6. Negociación.
7. Waiting.

En cada etapa, el Coach debe revisar las preguntas, actividades y resultados esperados definidos para esa fase. A partir de esa revisión debe informar al vendedor:

- Qué información ya está confirmada.
- Qué información falta para cumplir los criterios de la etapa.
- Qué respuestas son débiles, ambiguas o insuficientes.
- Qué riesgos pueden impedir el avance.
- Qué contactos o roles todavía deben identificarse o mapearse.
- Qué actividad o conversación debe realizarse a continuación.
- Si la oportunidad está lista para avanzar, si debe avanzar con cautela o si conviene continuar trabajando la etapa actual.

El Coach debe explicar siempre por qué recomienda avanzar o permanecer en la etapa actual. No debe impulsar el cambio de etapa únicamente porque exista una actividad registrada, una cotización creada o una solicitud del vendedor. El avance debe sustentarse en respuestas adecuadas a las preguntas de la etapa, evidencia comercial y resultados verificables.

### Criterios de preparación de etapa

Cuando el vendedor pregunte qué necesita para avanzar, Mi Coach debe producir un diagnóstico práctico y accionable. Como mínimo debe incluir:

1. **Etapa actual:** dónde se encuentra la oportunidad y cuál es el objetivo de esa etapa.
2. **Avances confirmados:** hechos, respuestas y actividades que ya cumplen un criterio.
3. **Pendientes:** preguntas sin respuesta, datos faltantes, contactos no identificados o actividades necesarias.
4. **Riesgos:** información contradictoria, falta de acceso al decisor, necesidad no validada, presupuesto incierto, fechas indefinidas u otros bloqueos.
5. **Siguiente paso recomendado:** acción concreta, responsable sugerido, fecha objetivo y criterio para considerar que se completó.
6. **Recomendación de avance:** avanzar, avanzar con cautela o permanecer en la etapa actual.

El vendedor debe poder preguntar, por ejemplo:

- “¿Qué me falta para pasar esta oportunidad a Desarrollo?”
- “¿La oportunidad está lista para cotizar?”
- “¿Qué preguntas de la etapa siguen sin respuesta?”
- “¿Qué debo validar con el cliente antes de programar la demostración?”
- “¿Qué riesgo impide avanzar a negociación?”

Las respuestas deben basarse en la información real de la oportunidad, sus preguntas de etapa, contactos, actividades, cotizaciones, propuestas y demás registros accesibles. Cuando falte información, el Coach debe indicarlo claramente y proponer cómo obtenerla.

Cuando el vendedor pregunte qué contiene una cotización, Coach puede consultar la ultima version accesible de una oportunidad resuelta si tiene `oportunidades.read`, al menos un permiso `cotizaciones.*` y acceso por ownership. La respuesta puede resumir secciones, productos o servicios, cantidades, precios y descuentos; excluye costos internos, margenes y notas internas. Si no puede resolver una oportunidad unica o no encuentra una cotizacion accesible, Coach pide seleccion o lo aclara.

## Creación y actualización desde el chat

El chat es el punto de entrada para iniciar acciones, pero los módulos existentes siguen siendo responsables de sus formularios, validaciones, reglas de negocio y guardado final.

Cuando el vendedor solicite crear una cuenta, contacto, oportunidad, lead, mapeo de contactos, cotización, propuesta o actividad, Mi Coach debe:

1. Interpretar la intención del vendedor.
2. Recopilar la información proporcionada en la conversación.
3. Identificar datos faltantes, ambiguos o incompatibles.
4. Resumir el registro que se pretende crear.
5. Dirigir al vendedor al módulo correspondiente.
6. Abrir el formulario de creación con los campos poblados con la información obtenida del chat.
7. Permitir que el vendedor revise, complete y modifique los datos.
8. Dejar que el módulo aplique sus validaciones y solicite la aprobación final antes de guardar.

Mi Coach no debe crear directamente estos registros desde el chat ni duplicar la lógica de los módulos. Por ejemplo, ante la solicitud "Crea una oportunidad para Grupo Andino por 45,000 dólares", debe identificar la cuenta, el nombre y el importe, dirigir al vendedor al módulo de oportunidades y abrir el formulario con esos campos preparados.

El mismo flujo aplica a:

- Cuentas.
- Contactos.
- Oportunidades.
- Leads.
- Mapeos y relaciones de contactos.
- Cotizaciones.
- Propuestas.
- Actividades.

Para una actualización, el Coach debe mostrar el registro, el campo actual, el nuevo valor propuesto y la evidencia o motivo del cambio. El vendedor debe aprobarla antes de ejecutarla.

## Continuidad de la conversación

La conversación debe conservarse como un espacio de trabajo persistente. Cuando el vendedor abandone el chat para completar una acción en otro módulo y regrese después, Mi Coach debe recuperar:

- El historial de mensajes.
- La cuenta, oportunidad, contacto o lead relacionado.
- La intención original del vendedor.
- Los datos identificados y enviados al formulario.
- Los campos que aún están pendientes.
- El módulo y la acción iniciada.
- Las recomendaciones, decisiones y compromisos anteriores.

El Coach debe continuar desde el punto en que quedó la conversación, sin obligar al vendedor a repetir el contexto. Si una acción quedó incompleta o fue cancelada, debe indicarlo y ofrecer continuarla, corregirla o iniciar otra.

## Espacios internos

Mi Coach se organiza en cinco espacios:

- **Resumen**: entrada del módulo con indicadores comerciales, análisis de situación y prioridades.
- **Coach**: contiene el Chat del Coach, cuya conversación, selector y contexto se mantienen independientes del análisis general.
- **Cliente existente**: parte de un selector de cuenta propio y responde cómo está el cliente, qué riesgo atender y qué desarrollar, sin reutilizar la cuenta o sesión del Chat del Coach.
- **Cuenta nueva**: ejecuta prospección asistida antes de crear registros reales en el CRM.
- **Administración**: configura el gobierno de Mi Coach y solo aparece para usuarios con permiso administrativo; se mantiene separada de la navegación cotidiana.

Resumen presenta la cuota, el monto ganado, la brecha y el tamaño/cobertura del pipeline abierto. El total abierto incluye oportunidades activas no terminales, también las etapas tempranas, y excluye oportunidades ganadas, perdidas, anuladas e inactivas. Los importes USD se convierten a la moneda de la cuota con la tasa de referencia Frankfurter; Resumen muestra la tasa y fecha de referencia, y no presenta brecha/cobertura si no se pudo obtener. Es una base comparable de reporte, no una conversión contable histórica por fecha de cierre.

El vendedor inicia o actualiza desde Resumen el análisis completo de actividad, evidencia de etapa, riesgos y acciones prioritarias; no se ejecuta automáticamente ni modifica registros. La comparación actividad/avance considera como evidencia una respuesta de etapa registrada después de la última actividad reciente (ventana de siete días); no afirma por sí sola que la oportunidad haya cambiado de etapa o estado. La navegación no duplica las conversaciones ni combina el contexto de Coach con los espacios especializados.

### Aislamiento entre espacios

Cambiar entre **Coach**, **Cliente existente** y **Cuenta nueva** solo cambia la vista activa; no transfiere ni combina cuentas, oportunidades, prospectos, sesiones o análisis. Cliente existente conserva su cuenta y resultados mientras se cambia el selector del Coach. Cuenta nueva conserva su ficha de prospección hasta que el vendedor la limpie o realice una conversión explícita. El Chat del Coach conserva su propio selector, contexto e hilo al navegar entre espacios. No existe una selección global compartida. Una futura acción explícita **Abrir esta cuenta en Coach** podría transferir únicamente el ID de cuenta; no fusionaría conversaciones ni análisis y no forma parte del flujo actual.

### Estados, switches y permisos

El estado comercial (`en_proceso`, `ganada`, `perdida`, `anulada`) y el estado de activación (`activada`, `desactivada`, `pendiente_activacion`) son dimensiones independientes. Solo oportunidades activadas y no terminales forman pipeline/forecast. Las terminales activadas aparecen en las colecciones históricas que habilitan los switches de Administración; los switches solo controlan disponibilidad para consulta y nunca actualizan estados del CRM ni intervienen en cuota, real ganado o pipeline. Toda oportunidad no activada, incluso si su estado comercial es terminal, se muestra en una colección **Desactivadas** independiente y queda fuera del historial terminal y del pipeline.

Resumen, Coach y Cliente existente aplican alcance de lectura por cuenta, contacto y oportunidad. Cliente existente requiere `inteligencia_comercial.read` y lectura de cuentas; sus datos relacionados se limitan además a los permisos de lectura de contactos, oportunidades e interacciones. Cuenta nueva requiere `prospeccion.read` para consultar sesiones o `prospeccion.create` para iniciar la preparación; confirmar/rechazar y convertir requiere `prospeccion.update` más el permiso del módulo destino. La investigación pública requiere `fuentes_externas.execute`, permiso de prospección/investigación y aprobación de gobierno. La interfaz oculta o deshabilita acciones cuando falta permiso y la API vuelve a comprobarlo.

### Chat del Coach

El Chat del Coach es la experiencia conversacional continua del vendedor. Permite hacer preguntas, explicar una necesidad o iniciar una acción usando el contexto real del CRM.

El chat puede:

- Responder preguntas sobre una cuenta, contacto, lead u oportunidad.
- Identificar una oportunidad mencionada en la pregunta o en el historial cuando la coincidencia es clara y única.
- Revisar qué información falta para cumplir los criterios de la etapa actual.
- Recomendar preguntas, actividades y próximos pasos.
- Mantener la historia de la conversación y recuperar el contexto cuando el vendedor regresa.
- Preparar la creación o actualización de un registro.
- Dirigir al vendedor al módulo correspondiente con los campos del formulario previamente poblados.
- Mostrar operaciones que requieren revisión y aprobación del vendedor.

El Chat del Coach trabaja principalmente sobre la necesidad concreta del vendedor y puede profundizar en una cuenta u oportunidad específica. No sustituye los formularios ni las reglas de los módulos existentes.

### Análisis de situación comercial

El Análisis de situación comercial vive en **Resumen**. Es un diagnóstico estructurado de la situación del vendedor, su cuota y su pipeline. No es una conversación ni sustituye al Chat del Coach.

El análisis puede:

- Revisar la cuota asignada, el importe ganado y la brecha pendiente.
- Evaluar la cobertura y la calidad del pipeline.
- Detectar oportunidades en riesgo.
- Comparar las actividades realizadas con el avance comercial real.
- Identificar oportunidades con actividad pero sin progreso.
- Evaluar la salud comercial de las oportunidades.
- Mostrar alertas, riesgos y problemas de venta.
- Ordenar las acciones prioritarias para el vendedor.
- Explicar el resultado esperado y el criterio de éxito de cada acción.

El análisis se inicia desde Resumen, utiliza un snapshot autorizado del contexto comercial y se ejecuta como un trabajo asíncrono. Sus recomendaciones enlazan a las oportunidades correspondientes; cualquier siguiente paso requiere una acción explícita del vendedor y los permisos correspondientes. El análisis no crea, actualiza ni cierra registros automáticamente.

### Cómo se complementan

Ambas capacidades utilizan el [Proceso Comercial](./proceso-comercial.md), pero trabajan en niveles distintos:

- El **Análisis de situación comercial** ofrece una visión general y prioriza dónde actuar.
- El **Chat del Coach** profundiza en una cuenta u oportunidad y ayuda a ejecutar el siguiente paso.
- El análisis puede recomendar una acción.
- El chat puede explicar qué información falta para realizarla y dirigir al vendedor al módulo correspondiente.
- Ninguna de las dos capacidades debe avanzar una oportunidad automáticamente.

**Cliente existente** organiza la cuenta seleccionada en resumen y última interacción, salud/riesgos/renovaciones, historial de oportunidades abiertas, ganadas, perdidas, anuladas y desactivadas, partidas de cotizaciones, contactos/mapa relacional, hipótesis de expansión, investigación y siguiente paso. Los enlaces a registros respetan el snapshot autorizado y las acciones de escritura requieren los permisos y la confirmación existentes.

Las partidas conservan el estado comercial de la cotización (por ejemplo, aceptada o ganada) y `fulfillmentStatus: not_verified`. Una cotización no se presenta como compra, factura ni entrega confirmada. Las hipótesis de renovación, venta adicional y venta cruzada incluyen evidencia y confianza y siempre requieren validación; no son hechos ni generan oportunidades automáticamente. El CRM interno, la investigación pública y las inferencias se identifican por separado. Los hallazgos públicos muestran proveedor/fuente y URL cuando está disponible.

El espacio ofrece **Analizar cuenta**, que usa exclusivamente datos internos del CRM, y **Enriquecer con fuentes públicas**, que ejecuta la orquestación Tavily/OpenAI para contactos, tecnología e iniciativas públicas. La preparación de llamada y los próximos pasos pueden proponer una actividad para revisión; nunca se guardan sin acción del vendedor. La pestaña **Cuenta nueva** permite capturar empresa, país, sitio e industria, generar una ficha de prospección, revisar contactos objetivo, hipótesis de oportunidad, hallazgos y correo inicial. Ninguna de estas funciones crea registros reales automáticamente.

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

## Tipos de interacción del Chat del Coach

Los tipos de interacción describen la intención del vendedor y el resultado que debe producir el chat. No deben confundirse con las operaciones que eventualmente se ejecuten en un módulo.

### Consulta de contexto

El vendedor solicita información que ya existe en el CRM.

Ejemplos:

- "¿Cuál es el importe de esta oportunidad?"
- "¿Qué contactos tiene esta cuenta?"
- "¿Cuál fue la última actividad registrada?"

El Coach debe responder con datos confirmados, indicar la entidad utilizada y mostrar evidencia cuando sea relevante. No debe proponer cambios si el vendedor solo pidió información.

### Consulta de preparación de etapa

El vendedor quiere saber si una oportunidad está suficientemente preparada para avanzar.

Ejemplos:

- "¿Qué me falta para pasar esta oportunidad a Desarrollo?"
- "¿Está lista para cotizar?"
- "¿Qué preguntas de la etapa siguen sin respuesta?"

La respuesta debe incluir la etapa actual, el objetivo de la etapa, criterios cumplidos, información faltante, respuestas débiles o ambiguas, riesgos, siguiente acción y recomendación de avanzar, avanzar con cautela o permanecer en la etapa actual.

### Diagnóstico de riesgo y salud comercial

El vendedor solicita una evaluación de una oportunidad específica.

Ejemplos:

- "¿Por qué está en riesgo esta oportunidad?"
- "¿Qué señales indican que puede estancarse?"
- "¿Qué debo corregir antes de negociar?"

El Coach debe separar evidencia, riesgo, impacto y medida de mitigación. Este diagnóstico puede centrarse en una oportunidad; no debe confundirse con el **Análisis de situación comercial**, que evalúa la cuota y el pipeline completo.

### Recomendación comercial

El vendedor solicita orientación sobre qué hacer a continuación.

Ejemplos:

- "¿Cuál debería ser mi siguiente paso?"
- "¿Qué debo validar con el cliente?"
- "¿Cómo conviene preparar la próxima reunión?"

La respuesta debe indicar la acción recomendada, el motivo, el responsable sugerido, el momento adecuado, el resultado esperado y el criterio de éxito. Una recomendación no modifica el CRM por sí sola.

### Preparación de interacción

El vendedor solicita ayuda para una llamada, reunión, demostración, negociación o seguimiento.

El Coach puede preparar objetivo, preguntas de descubrimiento, participantes, riesgos, mensajes clave, evidencias necesarias y el siguiente compromiso esperado. Preparar una interacción no equivale a registrar una actividad.

### Creación guiada

El vendedor quiere crear una cuenta, contacto, oportunidad, lead, mapeo de contactos, cotización, propuesta o actividad.

El Coach debe recopilar los datos, detectar campos faltantes, revisar posibles duplicados, resumir lo que se pretende crear y dirigir al vendedor al módulo correspondiente con el formulario preparado. El registro solo se guarda después de la revisión y aprobación del vendedor.

### Actualización guiada

El vendedor quiere modificar un registro existente.

El Coach debe identificar el registro, el campo actual, el nuevo valor, el motivo o evidencia del cambio y el flujo o módulo destino. El vendedor debe poder corregir y aprobar la modificación antes de ejecutarla.

### Continuación de trabajo

El vendedor retoma una conversación o acción anterior.

Ejemplos:

- "Continuemos con la oportunidad de Grupo Andino."
- "Ayer dejamos pendiente la propuesta."
- "Ya confirmé el presupuesto, ¿qué sigue?"

El Coach debe recuperar el historial, el contexto, los datos ya identificados, los pendientes y el estado de la acción, sin exigir que el vendedor repita la información.

### Solicitud de aclaración

El Coach debe pedir aclaraciones cuando no puede continuar de forma segura.

Debe hacerlo cuando existan varias coincidencias, falte una entidad necesaria, no se haya indicado un dato obligatorio, haya información contradictoria o exista riesgo de duplicar un registro. La pregunta debe ser concreta y limitarse a los datos necesarios para continuar.

### Estructura de cada respuesta

Cuando corresponda, una respuesta del Coach debe separar claramente:

- **Hechos:** información confirmada en el CRM o en la conversación.
- **Evidencia:** registro, pregunta de etapa, actividad o dato que sustenta la respuesta.
- **Interpretación:** lectura comercial o inferencia, claramente identificada.
- **Pendientes:** información que falta o debe validarse.
- **Recomendación:** siguiente acción sugerida.
- **Operación propuesta:** cambio o creación que requiere revisión y aprobación.

Esta estructura evita confundir una respuesta informativa con una recomendación o con una acción de actualización.

## Actividades comerciales

Las solicitudes explícitas de actividad deben iniciar el flujo del módulo de actividades. El Coach recopila la información de la conversación, identifica la oportunidad cuando sea posible y dirige al vendedor al formulario correspondiente con los campos preparados. La actividad solo se guarda después de que el vendedor la revise y la apruebe.

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

Si falta la oportunidad o existen varias coincidencias posibles, el Coach pide seleccionarla o aclararla antes de continuar.

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
- Las creaciones se entregan al módulo correspondiente con un formulario precargado.
- El vendedor puede editar los valores en el formulario antes de guardar.
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

Estas métricas describen la actividad del Chat del Coach. No deben interpretarse como el resultado completo del Análisis de situación comercial ni como una medida automática del avance de las oportunidades.

## API

Las rutas principales están bajo `/api/mi-agent`:

- `GET /api/mi-agent/context`: carga el contexto comercial autorizado para el vendedor.
- `POST /api/mi-agent/coach`: inicia una consulta conversacional del Chat del Coach.
- `GET /api/mi-agent/coach/jobs/:jobId`: consulta el resultado de una interacción del chat.
- `POST /api/mi-agent/analyze`: inicia un Análisis de situación comercial sobre el snapshot del vendedor.
- `GET /api/mi-agent/analyze/jobs/:jobId`: consulta el resultado del diagnóstico general.
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

La investigación externa controlada usa Tavily cuando `TAVILY_ENABLE_SEARCH=true`, existe `TAVILY_API_KEY` y la gobernanza permite fuentes externas. OpenAI interpreta los resultados de Tavily sin realizar una búsqueda adicional. Si Tavily no está habilitado, el job termina correctamente con una advertencia. Todo hallazgo externo queda como sugerido, con proveedor, URL, evidencia y certeza `evidenced`; no se confirma automáticamente.

## Prospección asistida

La Fase 5 completa la prospección de cuentas nuevas como un espacio separado de preparación comercial. Captura empresa, país del catálogo, sitio web e industria; prepara una ficha sin escribir en cuentas, contactos, leads u oportunidades; y presenta hallazgos con estado, confianza, evidencia y fuente. Los países no reconocidos se rechazan y nunca se sustituyen silenciosamente.

Endpoints principales:

- `POST /api/prospect-research/sessions`: crea una sesión de prospección con empresa, país, sitio web opcional e industria opcional.
- `GET /api/prospect-research/sessions/:sessionId`: consulta la sesión, ficha, hallazgos, contactos sugeridos e hipótesis.
- `POST /api/prospect-research/sessions/:sessionId/run`: genera la ficha de prospección.
- `POST /api/prospect-research/sessions/:sessionId/run-external`: ejecuta investigación externa controlada para la cuenta nueva.
- `POST /api/prospect-research/findings/:findingId/confirm`: confirma un hallazgo sugerido.
- `POST /api/prospect-research/findings/:findingId/reject`: rechaza un hallazgo sugerido.
- `POST /api/prospect-research/hypotheses/:hypothesisId/confirm`: confirma con el vendedor una hipótesis de oportunidad.
- `POST /api/prospect-research/hypotheses/:hypothesisId/reject`: rechaza una hipótesis de oportunidad.
- `POST /api/prospect-research/sessions/:sessionId/convert-to-account`: crea o vincula una cuenta desde la sesión.
- `POST /api/prospect-research/sessions/:sessionId/convert-to-lead`: crea un lead/interacción desde la sesión.
- `POST /api/prospect-research/contacts/:contactId/convert`: convierte un contacto objetivo en contacto CRM.
- `POST /api/prospect-research/hypotheses/:hypothesisId/convert-to-opportunity`: convierte una hipótesis en oportunidad preliminar.

La investigación pública solo se ejecuta mediante una acción explícita del vendedor, con `fuentes_externas.execute`, el permiso y los límites diarios de gobierno. Los hallazgos públicos deben conservar URL HTTP(S) y evidencia cuando la política así lo exige; la interfaz ofrece el enlace de fuente. Las áreas y roles de contacto se muestran como sugerencias no confirmadas, no como contactos existentes del CRM. Las hipótesis siguen sin confirmar hasta que el vendedor las valida y no se pueden convertir en oportunidades antes de esa validación.

Antes de convertir a cuenta, la ficha revisa posibles duplicados por nombre/país y dominio dentro del alcance de lectura autorizado del usuario. La conversión exige que esta revisión haya podido ejecutarse; si hay coincidencias, el vendedor decide vincular una cuenta accesible o crear otra explícitamente. La API repite la comprobación al convertir. La conversión de contactos también rechaza un email ya presente en la cuenta seleccionada.

La prospección no crea registros del CRM durante la investigación. Las conversiones son operaciones explícitas, auditadas, sujetas a permisos y a los módulos oficiales. Vincular una cuenta existente requiere elegir una coincidencia de la revisión; la investigación en sí no la reutiliza automáticamente.

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
- `cuentas.read` o `cuentas.read_all`: revisar posibles cuentas duplicadas antes de convertir.

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
