# Arquitectura del chat conversacional por canales

## Propósito

Este documento explica cómo una pregunta viaja desde la interfaz hasta los datos CRM y cómo regresa como respuesta. La arquitectura separa la experiencia del chat, la autorización, la planificación de consultas, la lectura de datos y la persistencia.

La regla principal es que el modelo puede interpretar una pregunta y proponer qué información consultar, pero no decide permisos ni accede directamente a la base de datos. El servidor valida el alcance, ejecuta las lecturas autorizadas y controla cualquier operación que pueda modificar el CRM.

## Vista general

![Flujo conversacional B1–B11: solicitud asíncrona, preparación por canal, orquestación B5, ciclo de evidencia y persistencia B11 a cargo de B3](./arquitectura-chat-conversacional-flujo.svg)

Cada pregunta inicia un job asíncrono, pero el recorrido no es una cadena lineal B1→B11. B1 puede consultar el estado mientras B3 procesa el job; dentro de B5, B6 propone un plan, B7/B8 ejecutan lecturas y B9 decide si basta la evidencia o si hace falta otra ronda. B11 es una tarea de persistencia de B3, no un servicio por el que pase la respuesta antes de volver a empezar.

## Conceptos principales

| Concepto                     | Responsabilidad                                                                                  | Ciclo de vida                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Sesión** (`chatSessionId`) | Agrupa la conversación y conserva su historial y contexto validado.                              | Persiste entre varios turnos. En Cliente existente queda asociada a una cuenta y a las entidades seleccionadas.                     |
| **Job** (`jobId`)            | Representa el procesamiento de una pregunta individual.                                          | Tiene un estado y un resultado propios. La interfaz consulta el job mientras se procesa.                                            |
| **Snapshot**                 | Proyección temporal de datos CRM que el usuario puede consultar en ese turno.                    | Se reconstruye desde el CRM, con permisos y límites aplicados. No es el historial de la conversación ni una copia completa del CRM. |
| **Contexto conversacional**  | Conserva las entidades, intenciones y filtros autorizados que dan continuidad a la conversación. | Se valida contra la cuenta y el snapshot antes de usarse en cada turno.                                                             |

Una sesión puede contener varios jobs. El snapshot se prepara para procesar un job; al finalizar, el resultado y el contexto actualizado se guardan en sus registros correspondientes.

:::details Resumen tabular de responsabilidades

| Bloque                            | Responsabilidad                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 · Interfaz**                 | Inicia o retoma la conversación, envía la pregunta y el contexto propio del canal, conserva sesión/job y muestra el resultado. Coach usa contexto CRM opcional; Cliente existente, la cuenta seleccionada; Cuenta nueva, una sesión de investigación sin `accountId` CRM. |
| **B2 · Rutas y jobs**             | Autentica y valida la solicitud, crea o recupera la sesión, crea el job y devuelve su estado y resultado a la interfaz.                                                                                                                                                   |
| **B3 · Servicio del canal**       | Comprueba que el job y la sesión pertenezcan al usuario, valida la cuenta y sus entidades, reconstruye el snapshot autorizado y coordina el procesamiento y la persistencia del canal.                                                                                    |
| **B4 · Adaptador**                | Traduce el contexto y las reglas del canal al contrato que espera el motor compartido. También normaliza la respuesta para ese canal.                                                                                                                                     |
| **B5 · Motor conversacional**     | Coordina el turno: planificación, lecturas, verificación de evidencia y preparación de la respuesta. No administra sesiones HTTP ni autoriza datos CRM.                                                                                                                   |
| **B6 · Planificador**             | Propone el plan de consulta: lecturas y filtros compatibles con el contexto y la intención vigente. Su plan es una propuesta, no una autorización.                                                                                                                        |
| **B7 · Read model**               | Convierte el plan validado en lecturas disponibles para el canal y limita las herramientas a las permitidas.                                                                                                                                                              |
| **B8 · Herramientas de lectura**  | Ejecuta consultas CRM de solo lectura sobre el snapshot autorizado y devuelve resultados acotados.                                                                                                                                                                        |
| **B9 · Verificador de evidencia** | Comprueba si las lecturas responden la pregunta. Si falta información, puede solicitar lecturas adicionales sujetas a los mismos controles y límites.                                                                                                                     |
| **B10 · Respuesta**               | Forma una respuesta a partir de evidencia verificada. Algunas respuestas se calculan de forma determinista; otras pasan por síntesis y auditoría.                                                                                                                         |
| **B11 · Persistencia**            | Guarda el resultado del job, el historial y el contexto actualizado de la sesión, además de las trazas permitidas.                                                                                                                                                        |

:::

La interfaz muestra la respuesta que recibe de la API. No ejecuta consultas CRM ni compone por su cuenta la respuesta del motor.

:::details Detalle de cada bloque

Los bloques son responsabilidades del flujo, no necesariamente módulos independientes. B1/B2 gestionan la interacción HTTP; B3 coordina el servicio del canal y la persistencia; B4 adapta el canal al motor; B5 coordina el procesamiento interno. B6–B10 se ejecutan dentro de esa orquestación; el ciclo de evidencia puede repetir B7/B8/B9 y algunas ramas pueden terminar antes según la intención, el contexto y la evidencia.

:::details B1 · Interfaz

**Recibe:** la pregunta del vendedor y la sesión/contexto de la interfaz. El contexto depende del canal; B1 no deduce IDs CRM a partir del texto.

**Hace (común):** muestra la conversación, envía la solicitud al servicio del canal, conserva los IDs de sesión/job y, si el trabajo es asíncrono, presenta un estado pendiente y consulta su progreso. El indicador de espera es estado visual local: no es una respuesta ni se envía como contenido al servidor.

**Hace (por canal):**

- **Coach:** restaura la sesión activa o guardada con mensajes, contexto y operaciones pendientes. Envía la pregunta, hasta ocho mensajes previos y el contexto disponible. Los IDs de cuenta, oportunidad, contacto y lead son opcionales y solo acotan la consulta si el vendedor seleccionó ese contexto. Consulta `GET /api/mi-agent/coach/jobs/:jobId` cada segundo, hasta tres minutos.
- **Cliente existente:** crea o recupera una sesión asociada a la cuenta seleccionada por el usuario. El chat envía la pregunta con el `accountId` y las opciones elegidas. Si se marca investigación pública, B1 envía `includePublicResearch` dentro del mismo job del chat; no crea un segundo job de investigación externa. La acción **Agentes especializados** sí inicia un job separado en `/agents/jobs` e incluye investigación pública; B1 lo sondea hasta 60 veces, con pausas de unos 600 ms. El job del chat se sondea hasta 100 veces con la misma pausa. B1 no infiere la cuenta a partir de la pregunta. La ruta API dedicada `/external-research/jobs` no es invocada directamente por la interfaz web actual.
- **Cuenta nueva:** recoge empresa y país (obligatorios), y sitio web e industria (opcionales). Al iniciar, crea una sesión de investigación identificada por `sessionId`, no por un `accountId` CRM, y lanza un job separado de investigación externa. Al abrir una sesión guardada restaura la ficha y el historial. El chat se envía asociado al `sessionId` y su job se consulta hasta 100 veces, con pausas de unos 600 ms. El job de investigación externa es distinto: B1 usa el `pollAfterMs` que devuelve el servidor, hasta 240 consultas; si sigue activo al agotar ese sondeo, conserva la ficha y permite volver a pulsar **Actualizar investigación** para recuperar su estado.

**Entrega (común):** muestra la respuesta o el error que devuelve el servidor. No consulta directamente el CRM, no autoriza el acceso ni redacta por su cuenta la respuesta del motor.

**Entrega (por canal):**

- **Coach:** sustituye el indicador pendiente por la respuesta, aplica el contexto activo devuelto y actualiza la bandeja de operaciones persistidas.
- **Cliente existente:** añade al chat el resultado asociado a la cuenta seleccionada o muestra el error/timeout del job.
- **Cuenta nueva:** añade la respuesta del asistente al chat y al historial de la sesión; al completar la investigación externa, actualiza la ficha y su estado. Las acciones para marcarla objetivo o convertirla a cuenta/lead se solicitan al servidor explícitamente desde la interfaz.

:::

:::details B2 · Rutas y jobs

**Recibe:** solicitudes HTTP autenticadas de B1 para iniciar un procesamiento o consultar el estado de un `jobId`. El payload y los permisos requeridos dependen del canal y del tipo de trabajo.

**Hace (común):** al recibir una solicitud para iniciar un trabajo asíncrono, valida sus datos y permisos, guarda un job `pending` asociado al usuario y al contexto que corresponda, y despacha el worker. Devuelve la aceptación a B1 sin esperar a que el worker termine; este cambia el job a `completed` o `failed` y guarda su resultado o error. Las rutas que no inician un trabajo asíncrono responden directamente y no crean un job. La sesión es un recurso aparte: Coach puede crearla al recibir la pregunta, mientras que en Cliente existente y Cuenta nueva B1 suele crearla o recuperarla antes y enviar su ID junto con la solicitud del job. Por eso B2 no crea una sesión en todos los canales.

**Hace (por canal):**

- **Coach:** valida pregunta y contexto CRM seleccionado. Si no hay sesión, puede crearla; guarda pregunta/contexto en un job `coach` pendiente y despacha `runCoachJob` en segundo plano. Devuelve `202` con `sessionId`, `jobId` y `pollAfterMs`.
- **Cliente existente:** recibe la pregunta, el `accountId`, la sesión seleccionada o creada previamente y opciones como `includePublicResearch`. Crea un job `account_chat` y despacha su procesamiento. La investigación pública incluida en este chat forma parte de ese job; la acción **Agentes especializados** crea otro tipo de job. La ruta dedicada `/external-research/jobs`, si se invoca, crea y despacha por separado un job `external_research`.
- **Cuenta nueva:** recibe el `sessionId` ya creado para el prospecto y la pregunta del chat; valida la sesión, crea un job de chat asociado y despacha su worker. La investigación externa de prospectos es otra operación: crea/reutiliza un run de investigación y despacha su runner con su propio `runId` y `pollAfterMs`.

**Entrega inicial:** cuando acepta un trabajo asíncrono, responde normalmente `202 Accepted` con el ID del job y, cuando corresponde, el intervalo sugerido de sondeo. Un error de autenticación, permisos o validación se responde como error HTTP y no se despacha el worker.

**Entrega de estado y resultado:** las rutas de consulta verifican usuario propietario, tipo de job y asociación con la sesión. Devuelven el estado mientras está pendiente/en curso y, al finalizar, el resultado o mensaje de error persistido. B1 usa esas respuestas para actualizar el estado visible; B2 no compone la respuesta conversacional.

:::

:::details B3 · Servicio del canal

**Recibe:** del flujo de B2, el job aceptado, el usuario autenticado y los datos asociados al canal: pregunta, sesión, contexto CRM o ficha de prospecto. Algunos jobs no parten de una pregunta de chat, sino de una acción explícita como ejecutar **Agentes especializados** o iniciar investigación externa. En esos casos B3 recibe el tipo de trabajo y las referencias guardadas en el job: cuenta/entidades para Cliente existente, o `sessionId`/`runId` para Cuenta nueva. Con ellas valida el alcance, carga el snapshot o la sesión autorizados y ejecuta el servicio específico.

**Hace (común):** toma el job que B2 despachó y carga de la base de datos los datos asociados. Si es un chat, recupera la sesión, el historial y el contexto; si es otro trabajo, usa las referencias guardadas en el job, por ejemplo la cuenta o la sesión de prospecto. Comprueba que el usuario sea dueño de la sesión/job y que las entidades estén dentro del alcance permitido. Con ese contexto validado prepara el snapshot o los datos de trabajo y ejecuta el servicio propio del canal; al terminar, guarda el resultado y el estado para que B2 los entregue a B1. B3 es esta responsabilidad de servicio, implementada por workers de canal; no es el archivo `b3-preclassifier.js`, que solo aporta señales deterministas de intención en Coach.

**Hace (por canal):**

:::details Coach · `agent-gateway.js`

El gateway `agent-gateway.js` implementa B3 y coordina el turno desde el job `pending` hasta su resultado final. `b3-preclassifier.js` es solo un componente interno de ese servicio; no es el bloque B3 completo.

**Decisión y autorización:** construye una instantánea de permisos del usuario. Primero `b3-preclassifier.js` analiza el texto con patrones fijos y devuelve un bucket/señales generales; después, `semantic-intent-classifier.js` llama a la IA con la pregunta, el historial y si hay entidades seleccionadas. Se ejecutan secuencialmente, no en paralelo: la IA no recibe el resultado del preclasificador (su bucket, señales o confianza). Cuando ambos resultados están disponibles, `resolve-final-intent.js` comprueba permisos para la intención semántica; si no está permitida, devuelve aclaración sin herramientas. También detecta un conflicto fuerte entre el bucket `coaching` del preclasificador y una intención de operación de la IA, y pide aclaración si la confianza semántica es menor que `0.7`. En los demás casos normalmente conserva la intención semántica, la mapea a `interactionMode` y `policyProcess`, y deriva las herramientas permitidas. El resultado del preclasificador es una señal de contraste; no tiene el mismo peso que la intención semántica ni autoriza acciones. B4/B5 reciben la decisión final y, si requiere aclaración, responden sin ejecutar lecturas.

**Intenciones permitidas al clasificador semántico:** esta es una lista cerrada distinta del catálogo editable de B6. La respuesta debe usar uno de estos códigos y tener confianza de al menos `0.68`; si no, el clasificador solicita aclaración.

- `seller_coaching`: orientación para priorizar y mejorar el seguimiento del vendedor. El resolver asigna `coaching` / `seller_coaching`.
- `account_performance`: análisis del desempeño, riesgos u oportunidades de mejora. Se enruta a `coaching` / `seller_coaching`.
- `account_query`: consulta puntual del contexto o resumen de una cuenta. Se enruta a `brief_context` / `brief_context`.
- `opportunity_query`: consulta puntual de oportunidades. Se enruta a `brief_context` / `brief_context`.
- `create_opportunity`: solicitud de proponer la creación de una oportunidad por el flujo controlado. Se enruta a `operation` / `operation` y requiere permisos y confirmación.
- `update_opportunity`: solicitud de proponer la actualización de una oportunidad existente. Se enruta a `operation` / `operation` y requiere permisos y confirmación.
- `general_query`: consulta general que no encaja en las categorías específicas. Se enruta a `coaching` / `default`.
- `clarify_needed`: solicitud ambigua, confianza insuficiente o clasificación inválida. Se enruta a `clarification` / `default` y no habilita herramientas.

  **Señales que busca el preclasificador:** analiza solo el texto del mensaje (no usa el parámetro de contexto), lo normaliza y prueba estos grupos en orden; el primer grupo que coincide determina el bucket:
  - **Operación** (`operation`, confianza 0.82): `actualiza/actualizar`, `agendar`, `crear`, `cambiar`, `modificar`, `registra/registrar`, `vincula/vincular`, `envía/enviar`, `confirma/confirmar`, `asocia/asociar`.
  - **Exploración detallada** (`deep_exploration`, 0.78): “historial completo”, “detalle completo”, “explora a fondo”, “resumen completo”, “todos los”, “todo el detalle”, “investiga a fondo”, “lista completa”.
  - **Coaching/análisis** (`coaching`, 0.85): señales como `performance`, `mejorar`, `oportunidad`, `riesgo`, recomendaciones o priorización, y referencias a una cuenta grande.
  - **Consulta puntual de cuenta** (`brief_context`, 0.74): `cuenta/cuentas`, “resumen de la cuenta”, “qué cuenta es” o “datos de la cuenta”.
  - **Sin coincidencia:** devuelve `unknown` y marca que conviene aclarar; un mensaje vacío también devuelve `unknown`, con confianza menor.

  **Límite de los patrones actuales:** el texto se normaliza quitando tildes, pero algunas expresiones configuradas conservan caracteres acentuados; además, fragmentos como `prioriz` o `recomend` están limitados por frontera de palabra y no detectan necesariamente sus formas conjugadas. Por eso estas señales son aproximadas y pueden omitir paráfrasis; la intención semántica con IA es la que interpreta la pregunta completa.

**Mejora propuesta para Administración (no implementada):** añadir una sección independiente para mantener las señales deterministas de B3 por categoría, con frases de ejemplo y una vista de prueba que muestre el bucket resultante antes de guardar. Los cambios deberían quedar validados y auditados; conviene administrar términos/frases controlados, no expresiones regulares libres. Esta configuración ajustaría solo la preclasificación de B3: no modificaría los ejemplos del catálogo semántico usado por el planificador ni añadiría operaciones CRM. El clasificador semántico seguiría interpretando la intención en lenguaje natural y el resolver seguiría siendo responsable de permisos y confirmaciones.

**Preparación y delegación:** marca el job como `running` y, en Coach, carga desde Administración las **Políticas del canal y contexto** correspondientes a `policyProcess` (usa las reglas predeterminadas del canal cuando no hay una configuración específica). Estas políticas delimitan el alcance de datos y las operaciones que se pueden proponer. B3 construye B4 con la política, el usuario, los permisos, el contexto y las herramientas resultantes; la política no sustituye la comprobación independiente de permisos del usuario. Después entrega pregunta, historial, contexto y `jobId` al adaptador, que invoca B5.

**Cierre:** recibe respuesta, contexto activo, lecturas y trazas; registra la decisión y la calidad del turno; persiste las operaciones propuestas, limpia la pregunta pendiente y añade los mensajes del vendedor y de Coach a la sesión. Finalmente guarda el resultado y la observabilidad en el job y lo marca `completed`. Si la ejecución falla, registra la traza de error y marca el job `failed` para que B2 pueda informar a B1.

:::

- **Cliente existente:** el worker del servicio comercial carga el job y valida que la sesión de chat corresponda al usuario y a la cuenta —y a la oportunidad/contacto seleccionados, si existen—. Reconstruye el snapshot autorizado de esa cuenta, valida el contexto conversacional y ejecuta la preparación de datos y agentes. Si la pregunta de chat solicita investigación pública, esa investigación se incorpora al mismo job de chat; **Agentes especializados** y el endpoint dedicado de investigación externa usan jobs separados. El servicio guarda la respuesta, el historial/contexto actualizado, las trazas y el estado final del job.
- **Cuenta nueva:** el worker de prospección carga la sesión y su historial, ejecuta el adaptador de prospectos y guarda la respuesta en el historial de chat y en el job. La investigación externa es otro trabajo del servicio: su runner consulta fuentes públicas, filtra/deduplica evidencia y persiste hallazgos, contactos e hipótesis en la sesión junto con el estado de ese run. Ninguna de estas operaciones crea por sí misma una cuenta CRM; la conversión requiere la acción explícita posterior.

**Entrega y ramas:** B3 no responde directamente a B1; guarda estado y resultado para que B2 los entregue en una consulta posterior.

- **Job conversacional:** si termina bien, B3 persiste respuesta, contexto/historial actualizado y trazas, y marca el job `completed`. Si el worker falla, guarda un error acotado y lo marca `failed`; B2 devuelve ese estado cuando B1 consulta el job.
- **Investigación externa:** el runner persiste el estado del run y los hallazgos (en Cuenta nueva, también contactos e hipótesis) asociados a la sesión. B2 los expone por la ruta de consulta del run para que B1 actualice la ficha. Si el sondeo automático termina antes que la investigación, el run puede seguir activo y consultarse de nuevo.
- **Fallo de validación:** si B2 rechaza permisos o datos antes de aceptar el job, responde un error HTTP y no hay worker que ejecutar. Si la validación falla después de crear el job, el worker registra el fallo para que B1 lo vea al consultarlo.

En síntesis, B3 guarda el estado y el resultado del job; cuando B1 consulta el job, B2 los lee y los devuelve por HTTP.

:::

:::details B4 · Adaptador

**Recibe (común):** de B3 recibe una petición ya autenticada y dentro del alcance del canal, normalizada al contrato del adaptador. Incluye usuario/permisos efectivos, pregunta e historial, contexto validado, reglas/políticas del canal, `jobId` y, cuando hay traza, su contexto de ejecución. No recibe la petición HTTP original ni credenciales para consultar la base de datos.

**Entradas adicionales por canal:**

- **Coach:** decisión final del gateway (`intent`, `interactionMode`, `policyProcess` y su traza), reglas de negocio del proceso, contexto CRM seleccionado y catálogo de herramientas permitidas.
- **Cliente existente:** snapshot CRM ya autorizado para la cuenta seleccionada (y oportunidad/contacto, si aplican), contexto conversacional validado, métricas de consultas al snapshot y resultados de los agentes preparados por B3.
- **Cuenta nueva:** sesión de prospecto, de la que B4 obtiene perfil, outreach, hallazgos públicos, contactos e hipótesis; recibe también las herramientas limitadas a esa sesión. No hay un `accountId` CRM hasta que se realiza una conversión explícita posterior.

**Hace (común):** convierte los datos de B3 en la entrada concreta de B5: pregunta e historial, contexto efectivo, usuario/permisos, reglas comerciales, herramientas permitidas, política de operaciones y `jobId`. Según el canal, recibe la política ya cargada por B3 o la carga desde Administración antes de construir esa entrada. Limita las capacidades visibles para B5 y conecta callbacks como resolver entidades, planificar lecturas, preparar el read model o auditar la respuesta. Después invoca `runConversationEngine` y espera su resultado. B4 no crea la sesión HTTP, no amplía el alcance autorizado ni reemplaza la validación independiente de permisos; tampoco cierra el job.

**Distinción con B5:** B4 adapta la configuración y las dependencias al canal; prepara cómo se conecta ese canal con el motor, pero no conduce por sí mismo el turno conversacional.

**Hace (por canal):**

- **Coach — `coach-adapter.js`:** recibe de B3 la clasificación ya resuelta y las Políticas del canal y contexto cargadas para `policyProcess`, junto con permisos, reglas y contexto. Las traduce a herramientas y límites para B5 y, si está habilitado, conecta los hooks del pipeline: plan B6, lecturas B7/B8, evaluación B9 y auditoría B10. Tras `runConversationEngine`, finaliza la auditoría y adjunta diagnósticos y trazas del pipeline al resultado que devuelve a B3.
- **Cliente existente — `customer-chat-adapter.js`:** recibe el snapshot de la cuenta y el contexto conversacional validado; carga desde Administración las Políticas del canal y contexto para `customer_account` y las combina con los permisos del usuario. Usa el alcance de la política para descartar referencias a oportunidad/contacto fuera de contexto y limitar herramientas/operaciones; después entrega a B5 el snapshot, las reglas efectivas, candidatos de entidades verificados y el callback de planificación estructurada. Devuelve a B3 la respuesta del motor junto con el nuevo contexto, lecturas y datos de calidad.
- **Cuenta nueva — `prospect-chat-adapter.js`:** carga las Políticas del canal y contexto para `prospect`/`prospect_chat`, arma el snapshot con perfil, outreach, hallazgos, contactos e hipótesis de la sesión, y entrega a B5 solo las herramientas permitidas para esa sesión. La política mantiene los datos dentro del prospecto y separa propuestas de conversión de registros CRM confirmados; los permisos del usuario se comprueban aparte. No crea ni selecciona una cuenta CRM. Devuelve la respuesta asociada a la sesión para que B3 actualice su historial y job.

**Entrega y límites:** devuelve a B3 la respuesta normalizada y los datos auxiliares del turno (por ejemplo, contexto activo, lecturas y trazas). B3 es responsable de persistir el resultado y cerrar el job; la validación final del plan y de las herramientas sigue siendo responsabilidad del servidor/motor, no una autorización concedida por el adaptador.

:::

:::details B5 · Motor conversacional

**Recibe:** de B4 recibe la pregunta e historial normalizados, contexto y snapshot autorizados, usuario y permisos, reglas del canal, política de operaciones, herramientas disponibles y `jobId`. En Coach recibe además la decisión final del gateway; en los otros canales recibe las reglas y los datos de routing propios del canal.

**Distinción con B4:** B5 ejecuta y gobierna el turno usando la configuración que B4 preparó: coordina routing, planificación, lecturas, evidencia y generación/validación de respuesta. Devuelve el resultado a B4, que lo entrega a B3.

**Hace (flujo común):**

1. **Aplica el alcance:** construye el conjunto efectivo de herramientas y operaciones usando los permisos, las reglas del canal y el catálogo que recibió de B4. Que el modelo proponga una herramienta no la autoriza; B5 la filtra o rechaza antes de ejecutarla.
2. **Resuelve contexto y referencias:** en Coach, el resolver del servidor contrasta nombres e identificadores explícitos en la pregunta con el snapshot CRM autorizado, el contexto seleccionado y el historial; aplica las coincidencias al contexto activo. Si encuentra referencias incompatibles o ambiguas, prepara una aclaración en lugar de escoger un registro a ciegas. En Cliente existente, valida el routing propuesto contra los candidatos de entidades resueltos por el servidor, el contexto de la cuenta y las herramientas permitidas. En Cuenta nueva, mantiene las referencias limitadas al prospecto de esa sesión. Después entrega el contexto y las lecturas necesarias a B7/B8 o a los componentes de lectura del canal.
3. **Llama al modelo de IA:** “modelo” aquí significa el modelo de lenguaje configurado para Mi Agent (actualmente seleccionado por `config.openai.model` e invocado por `requestMiAgentJson`), no el bloque B5 ni el planificador B6. B5 carga la guía del proceso comercial mediante `loadProcessGuide()` y la incluye en el prompt junto con la pregunta, el historial, el contexto autorizado, las reglas y la evidencia CRM que vuelve de B7/B8. La guía se obtiene por esta ruta; no se consulta con una herramienta CRM de B8. Si la pregunta mezcla cómo funciona el proceso con datos de una cuenta u oportunidad, el prompt combina la guía con los resultados de lectura autorizados. El modelo genera una respuesta estructurada y puede solicitar lecturas; B5 valida cada solicitud contra herramientas y políticas, ejecuta solo las autorizadas, incorpora sus resultados y vuelve a pedir la respuesta cuando corresponde.
4. **Valida la respuesta y la evidencia:** la exigencia de evidencia se aplica a la respuesta factual de negocio que va a entregar el asistente, no a la pregunta del usuario. Cuando las reglas del canal requieren respaldo, B5 comprueba que la respuesta incluya evidencia, hechos o evidencia asociada a una operación. Si falta, sustituye la respuesta por una aclaración de que no puede confirmar el dato y elimina las operaciones propuestas. Las reglas pueden permitir respuestas sin evidencia CRM para información general del proceso; aclaraciones, errores y handoffs tampoco se tratan como afirmaciones factuales sin respaldo. En Coach, B9 puede pedir lecturas adicionales antes de esta validación final.
5. **Devuelve un resultado normalizado:** conserva entidades y contexto activos, filtra operaciones según política y adjunta evidencia, resultados de herramientas y diagnósticos de routing/calidad para que B4 los entregue a B3.

**Carga y consulta de intenciones y enrutamiento:** B5 carga la configuración aplicable al canal y la usa para orientar o validar la ruta del turno. Cargarla no significa que B5 siempre decida la intención final; esa autoridad depende del canal.

- **Coach:** B5 carga el catálogo de Coach con sus ejemplos administrables y lo proporciona al planificador B6 para interpretar la pregunta y proponer lecturas compatibles. La decisión final (`intent`, `interactionMode` y `policyProcess`) ya fue resuelta por B3 mediante el gateway, la clasificación semántica y el control de permisos. B5 aplica esa decisión al limitar herramientas, modo de respuesta y lecturas; los ejemplos del catálogo no la sustituyen ni conceden permisos.
- **Cliente existente:** B5 carga la configuración de intenciones del canal y la entrega al planificador estructurado B6. B6 propone intenciones/consultas, entidades, filtros y herramientas; B5 valida esa propuesta frente al catálogo habilitado, el contexto de la cuenta, las entidades confiables, los permisos y las políticas antes de permitir que B7/B8 lean.
- **Cuenta nueva:** B5 carga la configuración propia del canal y la usa para clasificar/enrutar la solicitud dentro del alcance de la sesión de prospecto. La ruta resultante limita las herramientas disponibles; no habilita consultas CRM ni conversión automática de la sesión.

**Carga y aplicación de Reglas conversacionales de Administración:** son las instrucciones comunes o específicas que orientan las respuestas del asistente. B5 las carga para el canal y proceso vigentes a través del adaptador, conserva solo las reglas activas y las incorpora al contexto/prompt que envía al modelo. Por eso influyen en cómo el modelo interpreta la solicitud y redacta la respuesta; en Coach también se entregan a B9/B10 para orientar la evaluación de evidencia y la auditoría. B5 y los bloques posteriores deben respetarlas al conducir el turno, pero estas instrucciones no conceden permisos ni habilitan herramientas: B5 valida el plan y las operaciones, y B7/B8 siguen limitados por permisos, herramientas y alcance autorizados por el servidor.

**Interacción con B6 (planificador):** B5 usa B6 para traducir una solicitud en un plan estructurado antes de iniciar las lecturas. El plan es una propuesta de trabajo, no una consulta ya ejecutada ni un permiso. La interacción es:

1. **B5 prepara la petición:** proporciona la pregunta, el historial relevante, el canal y su contexto efectivo, junto con el catálogo de intenciones/lecturas aplicable, las herramientas disponibles y las restricciones conocidas. En Cliente existente incluye además las clases de operaciones permitidas y el límite temporal del turno. En Coach incluye las herramientas y filtros que puede usar la intención resuelta; no entrega a B6 la decisión de autorización sobre datos CRM.
2. **B6 propone el plan:** según el canal, puede proponer la intención/ruta, las herramientas de lectura, filtros y referencias de entidad, indicar contexto que falta o pedir aclaración. En Coach propone lecturas y filtros compatibles con la intención y el modo autoritativos; no debe reemplazarlos. En Cliente existente propone la ruta y los datos que permitirían consultar la cuenta seleccionada. B6 no devuelve resultados CRM ni ejecuta lecturas.
3. **B5 valida la propuesta en el servidor:** comprueba que el plan tenga estructura válida, que sus intenciones existan en la configuración, que cada herramienta esté disponible y autorizada, que los filtros y operaciones sean admitidos y que las referencias sean compatibles con el contexto/candidatos confiables del servidor. B5 normaliza el plan y descarta campos, entidades o herramientas inválidos o fuera de alcance; la salida del planificador no puede ampliar permisos ni cambiar la decisión final del gateway.
4. **B5 decide el siguiente paso:** solo un plan válido y dentro de alcance pasa a B7 para convertirlo en lecturas concretas; B8 ejecuta esas lecturas autorizadas. Si el plan es ambiguo, pide datos que faltan, contiene herramientas no permitidas o no se pudo generar/validar, B5 no lo trata como una consulta ejecutada: devuelve aclaración o error y evita leer el CRM cuando no hay una ruta válida.

**Diferencia por canal:** en **Coach**, el pipeline puede pedir a B6 que proponga lecturas CRM con filtros permitidos; la intención final ya resuelta por el gateway prevalece, B6 no devuelve IDs CRM y un modo de exploración profunda se deriva al espacio especializado en vez de abrir lecturas desde Coach. En **Cliente existente**, B5 invoca el planificador estructurado con catálogo, contexto, herramientas y límites del canal, y valida routing, entidades, filtros y operaciones antes de consultar. En **Cuenta nueva**, B5 clasifica la ruta con la configuración del canal y limita las herramientas a la sesión del prospecto; no utiliza la ruta de plan estructurado de Cliente existente ni puede convertir el prospecto en una cuenta.

**Variaciones por canal:**

- **Coach:** usa la intención y el modo ya resueltos por el gateway para limitar herramientas y respuesta; la planificación de lecturas no vuelve a decidir la intención final. Cuando está habilitado el pipeline, B5 coordina sus etapas de plan, lectura, evaluación de evidencia y auditoría. Si la consulta es de proceso general, puede responder desde la guía/política sin evidencia CRM; una solicitud de detalle fuera del espacio de Coach puede terminar en handoff.
- **Cliente existente:** ejecuta la ruta descrita arriba y respeta además el límite de tiempo y las rondas de evidencia configuradas para este canal.
- **Cuenta nueva:** enruta la consulta únicamente hacia las herramientas disponibles para la sesión de prospecto y mantiene la respuesta asociada a ese contexto; no convierte el prospecto ni crea una cuenta CRM.

**Mejora propuesta para B5 (no implementada): B12 · Recuperador de conocimiento documental.** Como se espera que haya muchas guías extensas de productos y soluciones, no conviene cargarlas completas en cada prompt ni hacer que B8 las trate como datos CRM. Un nuevo bloque B12 podría mantener un índice de documentos aprobados y, según la pregunta/ruta identificada por B5, recuperar solo los fragmentos pertinentes con su título, versión y referencia de origen. B5 agregaría esos fragmentos al contexto del mismo modelo, separados de la guía actual del proceso y de los resultados CRM de B7/B8; si la pregunta mezcla proceso, producto y una cuenta concreta, cada fuente conservaría su procedencia. B12 no ejecutaría consultas CRM ni redactaría la respuesta. La recuperación debería respetar vigencia y permisos, y devolver “sin material pertinente” o una alerta ante contenido vencido/contradictorio, en vez de presentar una afirmación sin respaldo. Esta es una propuesta futura: el flujo actual solo carga la guía del proceso mediante `loadProcessGuide()` y no incluye B12 ni cambios al diagrama B1–B11.

**Ramas de salida:** puede responder directamente, devolver aclaración/handoff/error antes de leer, completar una o más llamadas autorizadas a herramientas y continuar la generación, o cerrar con evidencia insuficiente cuando no es seguro afirmar una respuesta. Un plan inválido, una referencia ambigua, un fallo de lectura o el agotamiento de límites no se presentan como una consulta exitosa sin resultados.

**Entrega y límites:** devuelve a B4 la respuesta normalizada, contexto activo, entidades, evidencia, operaciones filtradas, resultados de herramientas y traza de calidad. No responde directamente a B1, no persiste el historial ni decide el estado final del job: B3 guarda el resultado y B2 lo expone cuando B1 consulta el job.

:::

:::details B6 · Planificador

**Propósito:** convertir el lenguaje de la pregunta en una propuesta estructurada que B5 pueda validar y que B7 pueda convertir en lecturas acotadas. B6 reduce la ambigüedad del trabajo que sigue; no es el ejecutor de consultas ni la autoridad de permisos.

**Recibe:** B5 le proporciona, según el canal, la pregunta, historial pertinente, contexto efectivo, catálogo de intenciones/rutas, herramientas disponibles y restricciones aplicables. Puede incluir filtros permitidos, operaciones habilitadas, candidatos de entidades preparados por el servidor y un límite de tiempo. Solo debe usar ese contexto autorizado; el historial ayuda a interpretar referencias, pero no es evidencia de hechos CRM.

**Hace por canal:**

- **Coach:** interpreta la solicitud con el catálogo de intenciones y herramientas de Coach y propone una ruta (`intent`, `mode`, confianza) junto con lecturas (`toolName` y filtros como texto, etapa, estado o año). No devuelve IDs CRM: el servidor resuelve entidades y añade el contexto autorizado a las lecturas. Si el gateway ya determinó una intención/modo final, esa decisión es autoritativa; B6 solo puede proponer lecturas compatibles. Para `deep_exploration` no propone lecturas desde Coach porque corresponde derivar al espacio especializado.
- **Cliente existente:** produce un plan de consulta, no una respuesta para el vendedor. Puede identificar dominios/intenciones consultados (`queries`), ruta, filtros, tipo y cardinalidad de la entidad objetivo, origen de la referencia, candidatos mediante claves opacas, herramientas propuestas y contexto faltante o ambiguo. Cuando la solicitud implica una operación, puede indicar `operationKind` y completar los campos de `activityDraft` pertinentes; no ejecuta ni confirma esa operación. No inventa datos ni IDs CRM. El servidor adjunta los candidatos autorizados y resuelve las claves a registros reales después de validar la propuesta.
- **Cuenta nueva:** en el flujo actual no usa el plan estructurado de Cliente existente; B5 aplica el routing del canal y mantiene las herramientas restringidas a la sesión del prospecto.

**Formato y calidad del plan:** las propuestas deben usar códigos del catálogo habilitado y filtros con tipos y valores permitidos. Una entidad se expresa como referencia/candidate key del conjunto autorizado, no como un ID inventado. Si hay varios objetivos plausibles, una referencia no resuelta, falta de contexto esencial o una solicitud fuera del alcance del canal, B6 debe marcar la ambigüedad o pedir aclaración, no escoger un registro a la fuerza ni ampliar la consulta.

**Entrega a B5:** devuelve únicamente el plan estructurado y, cuando corresponda, los campos de aclaración. B5 valida esquema, catálogo, herramientas, filtros, permisos, política de operaciones, contexto y referencias confiables; elimina o rechaza elementos no permitidos. Solo un plan válido continúa a B7 para preparar lecturas y a B8 para ejecutarlas. Si el plan falla o requiere aclaración, B5 detiene las lecturas pertinentes.

**Límites:** B6 no ejecuta consultas CRM, no observa resultados como si ya fueran evidencia, no autoriza herramientas, no cambia permisos ni reemplaza la decisión final del gateway. Tampoco redacta la respuesta conversacional final: después de las lecturas, B5 y los componentes de evidencia/answering determinan si la evidencia basta y qué respuesta se devuelve.

:::

:::details B7 · Read model

**Propósito:** construir, a partir del plan validado por B5, una vista de datos efectiva y limitada que permita contestar la pregunta sin exponer todo el snapshot ni consultar entidades fuera de alcance. B7 adapta el trabajo de lectura al canal y entrega al motor evidencia de lectura, no una respuesta conversacional.

**Recibe:** de B5 recibe la pregunta, el historial/contexto efectivo, el snapshot autorizado, reglas y filtros del canal, entidades ya resueltas o candidatos confiables, la ruta validada y la lista de herramientas autorizadas. Si B9 solicita otra ronda, B7 recibe las lecturas adicionales que faltaron y el límite disponible.

**Hace (común):**

1. Determina la selección efectiva de cuenta, oportunidad, contacto, lead o sesión a partir del contexto validado y las referencias que resolvió el servidor. Conserva solo los registros visibles para ese canal y aplica permisos, reglas comerciales y filtros explícitos o heredados del turno conversacional.
2. Prepara un read model: el contexto ya resuelto, los datos del snapshot que sí se pueden usar y la lista de herramientas autorizadas. No incluye registros fuera de alcance ni trata una referencia ambigua como una selección confirmada.
3. Para cada lectura necesaria, arma una solicitud concreta para B8: herramienta, filtros/argumentos y snapshot autorizado. Por ejemplo, `searchOpportunities` con filtro de etapa/año o `getOpportunityActivities` para una oportunidad seleccionada. No envía herramientas ni filtros que la política del canal no permita.
4. B8 ejecuta la solicitud y devuelve el resultado a B7. B7 lo agrega al read model e identifica si fue exitoso, vacío, fallido, truncado o no ejecutado por un límite. Después devuelve a B5 el read model actualizado. Si falta contexto o hay ambigüedad, devuelve una aclaración en vez de presentar una lectura como válida. Un error, truncamiento o consulta omitida no equivale a “sin coincidencias”.

**Preparación por canal:**

- **Coach:** resuelve las entidades explícitas frente al snapshot CRM del vendedor y combina la pregunta con el contexto seleccionado. Si cambia la entidad activa, evita reutilizar historial incompatible. Construye un snapshot limitado al contexto y las reglas de Coach; puede seleccionar datos de una oportunidad, actividades, cotización, readiness, cartera o leads solo si la ruta y las herramientas lo permiten. Si una solicitud requiere una oportunidad concreta y no hay una selección válida, devuelve una aclaración con opciones autorizadas.
- **Cliente existente:** mantiene todas las lecturas dentro de la cuenta seleccionada por el servidor. Resuelve `candidateKey`/referencias validadas a registros de esa cuenta, aplica filtros del plan y, cuando la referencia viene del historial o contexto activo, conserva únicamente los filtros conversacionales confiables. Respeta el máximo de consultas por turno; las herramientas que no caben en el límite se reportan como omitidas, no como búsquedas vacías.
- **Cuenta nueva:** arma el read model desde la sesión de prospecto (perfil y, cuando la ruta lo permite, hallazgos, contactos e hipótesis). No busca cuentas, oportunidades ni contactos en el CRM y no transforma el prospecto en una cuenta.

**Aclaraciones y ramas:** si faltan permisos/herramientas, la ruta no autoriza lecturas, la referencia está en conflicto o no hay el contexto obligatorio, B7 entrega una aclaración y no ejecuta la lectura afectada. Puede preparar una lectura inicial o una ronda adicional pedida por B9. Un límite agotado, una fuente truncada o un error se conservan como estado de calidad: no significan “sin coincidencias”.

**Qué pasa después:** B5 usa el read model que devolvió B7 para continuar la respuesta. En Coach, B5 entrega a B9 la pregunta, el plan, el contexto y los resultados de B8; **B9 decide si la evidencia basta**. Si B9 detecta que falta una lectura autorizada y quedan herramientas/límites, solicita otra ronda: `B9→B7` prepara la solicitud, `B8` la ejecuta y devuelve el resultado a `B9` para reevaluarlo.

**Nota de implementación:** algunos adaptadores agrupan la preparación de B7 y la ejecución de lecturas iniciales de B8 en una misma llamada de código. En el diagrama se mantienen separados para mostrar el intercambio: B7 arma y organiza la lectura; B8 la ejecuta.

:::

:::details B8 · Herramientas de lectura

**Propósito:** convertir la solicitud de lectura de B7 en datos concretos para el turno. B8 toma una herramienta ya elegida (por ejemplo, `searchOpportunities`), aplica sus filtros al snapshot autorizado y devuelve a B7 los registros que coinciden o el estado que impidió obtenerlos. B7 incorpora ese resultado al read model y se lo entrega a B5 para continuar la respuesta. Así, B8 aporta datos verificables al flujo sin decidir qué buscar: no interpreta la intención del usuario, no cambia los filtros del plan ni busca fuera del alcance recibido. B8 consulta datos CRM o de la sesión de prospecto; no carga la guía del proceso comercial, que B5 incorpora al prompt por separado.

**Recibe:** de B7 recibe el nombre de una herramienta permitida, sus argumentos/filtros ya acotados y el snapshot/contexto autorizado contra el que debe operar. Cada llamada corresponde a una lectura específica, por ejemplo buscar oportunidades con filtros o recuperar actividades de una oportunidad seleccionada.

**Hace:**

1. Comprueba que la herramienta solicitada exista para el canal y que no esté bloqueada por el alcance o las reglas aplicables. Rechaza una herramienta no soportada o no permitida.
2. Ejecuta la función de lectura correspondiente sobre los datos autorizados que recibió: snapshot CRM de Coach/Cliente existente o snapshot de la sesión de Cuenta nueva. Aplica los argumentos y filtros permitidos; no busca registros fuera de ese conjunto ni acepta instrucciones del modelo como autorización.
3. Devuelve el resultado asociado a la herramienta sin modificar CRM, historial, cuenta ni sesión. La ejecución es read-only; B8 no redacta la respuesta al usuario ni determina si la evidencia contesta suficientemente la pregunta.

**Variación por canal:** en **Coach** y **Cliente existente**, las herramientas leen del snapshot CRM acotado por permisos, cuenta y contexto; en **Cuenta nueva**, las herramientas solo consultan los datos de la sesión de prospecto, como perfil, hallazgos, contactos o hipótesis. B8 no convierte un prospecto ni crea registros CRM.

**Entrega y errores:** devuelve a B7 el nombre de la herramienta, el resultado y, cuando corresponda, error/código de error, timeout, truncamiento u otra métrica de calidad. Una lista vacía solo significa que una lectura terminó correctamente y no encontró coincidencias; si hubo error, timeout, truncamiento o la consulta se omitió por límites, esos estados se conservan y no se presentan como “sin resultados”.

**Límites de seguridad:** el modelo no recibe credenciales SQL ni puede enviar SQL arbitrario. B8 solo ejecuta las herramientas conocidas del catálogo sobre el snapshot o servicio de lectura que le entrega el servidor; las operaciones de escritura y conversión pertenecen a otros flujos y requieren sus propias reglas/confirmaciones.

:::

:::details B9 · Verificador de evidencia

**Propósito:** comprobar, antes de redactar la respuesta, si los resultados obtenidos realmente respaldan lo que preguntó el usuario. B9 verifica evidencia; no vuelve a planificar libremente, no consulta por su cuenta y no redacta la respuesta final.

**Recibe:** la pregunta completa, el plan/routing validado, el contexto y alcance efectivos, la lista de herramientas autorizadas y los resultados de B8, incluidos errores, truncamientos y consultas omitidas. En Coach también recibe la guía/reglas comerciales permitidas; en Cliente existente, la evaluación equivalente puede incluir evidencia CRM y resultados de investigación pública. El historial sirve para resolver a qué se refiere el usuario, pero por sí solo no prueba hechos CRM.

**Qué comprueba:** descompone la solicitud en los hechos que deben respaldarse y contrasta cada uno con resultados de lecturas que terminaron correctamente. Distingue una búsqueda válida sin coincidencias de una consulta fallida, truncada o no ejecutada. No exige registros CRM para explicar una guía de proceso autorizada; tampoco convierte campos futuros aún no proporcionados (por ejemplo, fecha/hora de una actividad propuesta) en hechos que deban aparecer en CRM.

**Resultados posibles:**

- `sufficient`: la evidencia permitida cubre todos los hechos solicitados y no quedan lecturas relevantes pendientes.
- `no_results`: las lecturas necesarias sí se ejecutaron sin errores, pero no encontraron registros. Esto permite explicar la ausencia dentro del alcance consultado; no se usa para ocultar un fallo.
- `incomplete`: falta evidencia factual, pero una lectura autorizada que aún no se hizo podría aportarla.
- `clarification`: hay una referencia ambigua o falta un dato esencial que ninguna lectura segura puede resolver; se formula una pregunta aclaratoria.
- **Error o límite:** si falla el verificador o una fuente, se agota el tiempo/límite de consultas/rondas, o una fuente queda truncada, el turno termina como error o evidencia insuficiente. No se afirma que no existan datos.

**Lecturas adicionales:** cuando falta una herramienta concreta, B9 devuelve a B5/B7 solo herramientas ya autorizadas y aún no consultadas. El flujo las prepara en B7, las ejecuta en B8 y vuelve a evaluar los resultados (`B9→B7→B8→B9`). En Coach y Cliente existente el límite es de hasta 2 rondas adicionales, 8 lecturas por turno y 45 segundos; al agotarlo, se detiene y se devuelve una salida segura.

**Entrega y diferencias por canal:** con `sufficient` o `no_results` verificado, permite que B10 redacte una respuesta respaldada. Con ambigüedad pide aclaración; ante fallos o evidencia incompleta sin lecturas restantes, devuelve aclaración/error en vez de permitir una afirmación no sustentada. En Coach este ciclo forma parte explícita del pipeline B6–B10 y puede usar guía/reglas como respaldo para preguntas de proceso. Cliente existente aplica la misma responsabilidad con su verificador y ciclo de evidencia del canal, que considera lecturas CRM y evidencia pública; no es exactamente la misma implementación del pipeline de Coach.

:::

:::details B10 · Respuesta

**Propósito:** convertir la evidencia que B9 consideró suficiente (o una ausencia de resultados correctamente verificada) en una respuesta clara para el usuario, sin añadir hechos que las fuentes no sostienen. B10 redacta y comprueba la respuesta; no consulta CRM ni ejecuta operaciones.

**Recibe:** la pregunta, el contexto y la intención ya validados, los resultados autorizados de B8, el estado de verificación de B9 y las guías/reglas permitidas. Para cada fuente conserva su tipo: CRM, investigación pública o guía/regla de negocio; una guía puede respaldar cómo se aplica el proceso, pero no demostrar un dato actual de una cuenta.

**Forma la respuesta:** produce una salida estructurada para que B5 la normalice, que puede incluir respuesta, hechos/evidencia, inferencias, recomendaciones, datos pendientes, entidades y operaciones propuestas. Debe distinguir:

- **Hechos:** afirmaciones respaldadas por una lectura autorizada o por una fuente documental adecuada a ese tipo de afirmación.
- **Orientación e inferencias:** recomendaciones comerciales identificadas como tales; no se presentan como hechos CRM.
- **Pendientes:** información que el usuario todavía debe proporcionar, por ejemplo fecha u hora para una actividad futura.
- **Operaciones:** propuestas editables sujetas a validación y confirmación en su flujo correspondiente. B10 nunca afirma que una operación se guardó o ejecutó solo porque aparece en la respuesta.

**Auditoría y ramas por canal:**

- **Coach:** después de generar la respuesta, B10 devuelve sus afirmaciones a B9 para una auditoría final contra la evidencia autorizada (`B10→B9`). La guía y las reglas pueden respaldar orientación de proceso/coaching, pero no hechos de clientes. B9 marca la respuesta `supported`, `unsupported` o `inconclusive`; solo `supported`, sin afirmaciones rechazadas, permite conservarla y aplicar la política a las operaciones propuestas.
- **Cliente existente:** el adaptador realiza una auditoría equivalente contra evidencia CRM/pública autorizada y resultados vacíos verificados. Si una afirmación excede la fuente, mezcla evidencia pública con un hecho CRM o la auditoría no está disponible, la respuesta generada se descarta y se devuelve una salida segura.
- **Cuenta nueva:** la respuesta se construye únicamente con el snapshot y la evidencia de la sesión de prospecto. Distingue hallazgos públicos de inferencias y no presenta el prospecto como cuenta CRM confirmada; las acciones de conversión requieren confirmación explícita.

**Entrega y límites:** B10 devuelve la respuesta y, cuando aplica, el resultado de auditoría a B5. B5 normaliza el contrato, vuelve a aplicar las restricciones del canal y entrega el resultado a B4. Si la evidencia no alcanza, una afirmación no está respaldada o la auditoría falla/no puede completarse, B5 devuelve aclaración o error seguro y no conserva operaciones propuestas como acciones ejecutadas.

:::

:::details B11 · Persistencia

**Propósito:** dejar guardado el resultado del turno para que sobreviva al worker asíncrono y pueda recuperarse después mediante el job/sesión. B11 es la tarea de persistencia que B3 realiza al cerrar el procesamiento; no es otro motor conversacional ni un servicio que responda por HTTP.

**Recibe de B3:** el `jobId`, canal y sesión asociados; el resultado final ya normalizado por B5/B4 (respuesta, entidades/contexto, evidencia y estado); los mensajes que deben añadirse al historial; las trazas/diagnósticos permitidos; y, si aplica, propuestas de operación que deban quedar guardadas como borradores.

**Qué persiste:**

- **Job:** cambia su estado final a `completed` y guarda el resultado serializado; o lo marca `failed` con un mensaje de error acotado si el procesamiento/cierre falla. En los canales que lo usan, también actualiza `finished_at` y metadatos de diagnóstico.
- **Conversación:** agrega la pregunta del usuario y la respuesta del asistente al historial de la sesión, y guarda el contexto actualizado para que el siguiente turno pueda continuar con referencias/filtros vigentes.
- **Trazabilidad:** conserva la traza de calidad y los diagnósticos asociados al canal/job, como routing, entidades, herramientas usadas, evidencia, auditoría, errores y latencia, según las reglas de cada canal.
- **Coach:** puede guardar las operaciones propuestas como registros pendientes/editables asociados al job y a la sesión. Guardar una propuesta no significa ejecutarla ni escribir el cambio en CRM; eso requiere el flujo posterior de confirmación/operación.

**Variación por canal:** Coach actualiza el job y los turnos de la sesión, además de enlazar trazas y propuestas; Cliente existente guarda el resultado junto con el historial y contexto de la sesión de chat de la cuenta; Cuenta nueva guarda el resultado del job y añade los mensajes al historial de la sesión de prospecto. Cada canal persiste solo sus datos de sesión y alcance autorizados.

**Cierre y entrega:** tras persistir, B3 devuelve el control al worker/job. B1 no recibe la respuesta desde B11: consulta a B2 con el `jobId`, y B2 lee el estado/resultado persistido y lo entrega. Si el job falla, B2 puede devolver ese estado/error en lugar de una respuesta comercial. No se reinicia el flujo B1–B10 ni se repiten lecturas por guardar el resultado.

**Límites:** B11 no decide el contenido, no valida evidencia, no ejecuta lecturas ni modifica directamente cuentas/oportunidades CRM. Su trabajo es guardar de forma asociada y recuperable el resultado, la sesión y la observabilidad del turno.

:::

:::

:::details Ejemplo de recorrido con ramas

Pregunta: “¿Qué oportunidad tengo de mejorar mi performance en la cuenta más grande este año?” El ejemplo supone una pregunta en Coach; qué cuenta es “la más grande” y qué datos están disponibles dependen del snapshot autorizado. El flujo muestra una ruta normal y sus posibles salidas anticipadas; no todos los turnos recorren cada bloque.

1. **La interfaz inicia el job (`B1 → B2`).** B1 envía la pregunta y el contexto seleccionado. B2 valida la solicitud, crea el job y devuelve `202` con su `jobId`. En paralelo, B1 consulta el estado del job; todavía no hay respuesta comercial.
2. **El servicio valida y prepara el canal (`B2 → B3 → B4`).** B3 valida usuario, sesión, permisos y alcance. En Coach, el clasificador/resolver de B3 fija la intención y la ruta (`coaching` / `seller_coaching`); con `policyProcess` carga las políticas aplicables. B3 prepara el contexto/snapshot y delega a B4. B4 adapta reglas, permisos y herramientas para B5.
3. **B5 solicita y valida un plan (`B5 → B6 → B5`).** B6 propone lecturas y filtros para investigar el desempeño y el periodo. La intención ya resuelta en Coach es autoritativa: B6 no puede cambiarla ni autorizar sus propuestas. B5 valida el plan antes de continuar.
4. **B7 prepara la lectura y B8 la consulta (`B5 → B7 → B8 → B7 → B5`).** B7 determina el contexto/snapshot y arma solicitudes concretas con herramientas y filtros permitidos. B8 aplica cada herramienta read-only sobre los datos autorizados y devuelve a B7 los resultados o estados de error/truncamiento. B7 incorpora esos resultados al read model y se lo entrega a B5.
5. **B9 evalúa la evidencia (`B5 → B9`).** B5 presenta a B9 la pregunta, el plan, el contexto y los resultados. Si la evidencia es suficiente, B9 permite seguir a B10. Si falta una lectura autorizada y quedan límites, solicita otra ronda (`B9 → B7 → B8 → B9`). Si hay ambigüedad, error o límites agotados, el turno pide aclaración o termina de forma segura; un fallo no se interpreta como “sin coincidencias”.
6. **B10 redacta y audita en Coach (`B9 → B10 → B9 → B5`).** Con evidencia suficiente, B10 redacta hechos y recomendaciones distinguidos. En Coach, B9 audita las afirmaciones de B10 contra las fuentes autorizadas; si no se respaldan, se devuelve una salida segura. Si se valida, el resultado vuelve a B5 para normalización y aplicación final de políticas.
7. **El resultado se adapta, persiste y se entrega (`B5 → B4 → B3 → B11`; luego `B1 → B2 → B1`).** B4 devuelve el resultado a B3. B3 ejecuta B11 para guardar resultado, historial/contexto y trazas, y marca el job `completed` (o `failed` si el cierre falla). Cuando B1 vuelve a consultar el job, B2 lee el estado y resultado persistidos y los devuelve a la interfaz.

:::details Recorrido bloque por bloque en una tabla

| Bloque                            | Qué ocurre en este ejemplo                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 · Interfaz**                 | Envía la pregunta/contexto a B2 y sondea el `jobId` en paralelo al procesamiento. Al recibir el resultado de B2, lo muestra en el chat.                                                                                                            |
| **B2 · Rutas y jobs**             | Valida la solicitud, acepta el job asíncrono y despacha B3. En los sondeos posteriores devuelve el estado/resultado persistido; no redacta la respuesta.                                                                                           |
| **B3 · Servicio del canal**       | Valida propiedad de job/sesión, permisos y contexto. En Coach resuelve la intención final, carga políticas según `policyProcess`, prepara el snapshot y coordina B4. Al final ejecuta B11 para persistir.                                          |
| **B4 · Adaptador**                | Prepara para B5 las reglas, permisos, contexto y herramientas propias de Coach. Al terminar, devuelve el resultado normalizado a B3.                                                                                                               |
| **B5 · Motor conversacional**     | Coordina el turno: solicita y valida el plan B6, gestiona B7/B8, presenta resultados a B9, recibe la respuesta/auditoría de B10 y aplica normalización/políticas antes de devolverla a B4.                                                         |
| **B6 · Planificador**             | Propone las lecturas/filtros para analizar cuenta, oportunidad y periodo. Respeta la intención final resuelta por B3 y no concede permisos ni ejecuta consultas.                                                                                   |
| **B7 · Read model**               | Resuelve el contexto de lectura permitido y prepara para B8 la herramienta, argumentos/filtros y snapshot autorizado. Incorpora la respuesta de B8 al read model y lo devuelve a B5.                                                               |
| **B8 · Herramientas de lectura**  | Aplica las herramientas read-only al snapshot autorizado y devuelve registros o estados de error/calidad a B7. No modifica CRM.                                                                                                                    |
| **B9 · Verificador de evidencia** | Decide si los resultados respaldan el análisis. Puede solicitar otra lectura autorizada; ante ambigüedad, fallos o límites agotados, provoca aclaración/error en vez de afirmar datos no verificados. En Coach también audita la respuesta de B10. |
| **B10 · Respuesta**               | Redacta el análisis con evidencia suficiente y recomendaciones identificadas. En Coach devuelve sus afirmaciones a B9 para auditoría; tras validarse, retorna el resultado a B5.                                                                   |
| **B11 · Persistencia**            | Es la tarea que B3 ejecuta al cerrar: guarda job/result, historial/contexto y trazas. B1 recupera después el resultado consultando B2.                                                                                                             |

:::

En forma compacta: `B1→B2` acepta el job; B2 despacha `B3→B4→B5`; dentro de B5, `B5→B6→B5` prepara y valida el plan, y `B5→B7→B8→B7→B5` prepara, ejecuta e incorpora lecturas. B5 entrega resultados a B9; si faltan datos, `B9→B7→B8→B9` repite una lectura autorizada. Si basta la evidencia, `B9→B10`; en Coach, la auditoría vuelve `B10→B9` y la respuesta validada regresa a B5. Finalmente `B5→B4→B3`, B3 ejecuta B11 y B1 obtiene el resultado sondeando B2. Aclaraciones, errores o rutas sin contexto pueden terminar antes de B8 o B10.

:::
