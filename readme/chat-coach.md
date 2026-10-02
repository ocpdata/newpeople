# Mi Coach

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

Este documento describe exclusivamente el Chat del Coach. No cubre el Análisis de situación comercial, Cliente existente, Cuenta nueva, investigación pública, biblioteca, reportes ni administración de gobierno, excepto cuando una dependencia del chat exige mencionarlos.

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

La conversación mantiene un contexto activo tipado de cuenta, oportunidad, contacto o lead. El selector inicia ese contexto, pero no tiene prioridad permanente: una entidad mencionada de forma clara y única en la pregunta actual reemplaza la selección anterior. Una respuesta del Coach también puede establecer otra entidad para el siguiente turno, pero solo con IDs estructurados presentes en el snapshot autorizado o con un nombre estructurado inequívoco. La nueva combinación debe ser relacionalmente compatible; por ejemplo, una oportunidad determina su cuenta y un contacto debe corresponder a la misma cuenta. Si las entidades mencionadas se contradicen o son ambiguas, el Coach solicita aclaración en vez de elegir una en silencio.

Las preguntas de seguimiento como «esa oportunidad», «el contacto», «¿y sus cotizaciones?» o «¿en qué etapa está?» usan los IDs activos persistidos en la sesión. Términos genéricos de consulta —como etapa, estado, cotizaciones o productos— no identifican por sí solos otra entidad, aunque aparezcan dentro del título de un registro distinto. El historial anterior no se vuelve a analizar como una bolsa de nombres: cada turno está asociado a su contexto y solo se reutiliza el historial compatible. Si no hay entidad activa, el Coach intenta resolver nombres inequívocos de la pregunta; las referencias deícticas usan el último contexto activo compatible. Un cambio explícito de entidad inicia un tramo contextual nuevo sin borrar los mensajes visibles de la conversación.

Una respuesta del Coach puede cambiar el contexto activo para el turno siguiente si identifica una entidad accesible con IDs estructurados y relaciones válidas. El frontend actualiza los selectores, pero conserva la conversación. Los nombres mencionados en prosa sin ID verificable no cambian el contexto.

Al cambiar la cuenta, el vendedor confirma antes de continuar. La confirmación cierra la sesión anterior, limpia el chat visible y sus borradores, y establece un contexto nuevo; cancelar conserva el contexto actual. Las operaciones pendientes deben completarse o descartarse antes de cambiar de cuenta. Las sesiones cerradas no se pueden recuperar desde la interfaz. La opción **Sin cuenta · conversación general** aplica el mismo reinicio sin seleccionar una cuenta. Una nueva pregunta crea una sesión para el contexto elegido.

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

El estado de activación y el estado comercial son dimensiones distintas. Una oportunidad puede estar **Activada** en el sistema y tener estado comercial **Ganada**; en ese caso es un registro accesible e incluido en el historial configurado, pero no es una oportunidad abierta. Del mismo modo, una oportunidad **En proceso** que está **Desactivada** no cuenta como abierta ni como activa para el pipeline.

Las oportunidades terminales se mantienen separadas del pipeline abierto:

- `wonOpportunities`: historial de oportunidades ganadas.
- `lostOpportunities`: historial de oportunidades perdidas.
- `cancelledOpportunities`: historial de oportunidades anuladas.

Estas colecciones pueden aportar antecedentes, cotizaciones y propuestas, pero no participan en forecast, cobertura, riesgos del pipeline ni preparación de etapa. Solo se incluyen si su switch correspondiente está habilitado en **Administración > Gobierno de Mi Coach** y el usuario tiene permisos para verlas. La ausencia de un registro en el contexto autorizado no debe presentarse como prueba de que no existe en el CRM.

Las oportunidades no terminales desactivadas o pendientes de activación se exponen por separado en `inactivePipelineOpportunities`. No cuentan como oportunidades abiertas ni en el forecast.

Al responder **“¿Qué oportunidades abiertas tiene esta cuenta?”**, el Coach debe separar con claridad:

- Oportunidades abiertas y activadas, si existen.
- Oportunidades no terminales en proceso, pero desactivadas o pendientes de activación, indicándolas como no activas y fuera del pipeline.
- Oportunidades ganadas, perdidas o anuladas habilitadas por Administración, identificándolas como historial terminal y fuera del pipeline abierto.

Si no hay oportunidades abiertas, no debe concluir que no existen oportunidades en la cuenta cuando haya registros en las otras categorías. Debe decir que no hay oportunidades abiertas y resumir por separado los registros activados terminales y los no activados. Por ejemplo: **“No hay oportunidades abiertas activas. Existe una oportunidad activada y ganada, y otra en proceso pero desactivada; ninguna de las dos se cuenta como pipeline abierto.”**

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

La transferencia se realiza mediante un `coachDraft` opaco en la URL. El token:

- pertenece al usuario autenticado y a un único módulo destino;
- vence 24 horas después de emitirse;
- puede reutilizarse mientras siga vigente y la operación continúe abierta;
- no autoriza escrituras directas ni sustituye los permisos del módulo;
- se completa solo después de que el formulario oficial guarda correctamente;
- se conserva si el usuario cierra el formulario sin guardar;
- puede descartarse explícitamente desde el aviso del Coach en el módulo destino.

Los módulos de cuentas, contactos, oportunidades, desarrollo comercial, interacciones, mapeo de contactos, cotizaciones y propuestas consumen este contrato. Cada uno aplica una lista blanca de campos precargables y conserva sus catálogos, valores predeterminados, validaciones, controles de duplicados y aprobaciones.

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

## Contexto comercial

La cuenta es el contexto principal de selección. Las oportunidades y contactos disponibles dependen de ella y se limitan a registros activos y accesibles.

El contexto del chat puede incluir:

- Cuenta, oportunidad y contacto seleccionados.
- Oportunidades activas y abiertas del vendedor.
- Historial autorizado de oportunidades ganadas, perdidas y anuladas, conforme a la configuración de gobierno.
- Etapa, importe, fecha de cierre y estado comercial.
- Preguntas y respuestas de etapa.
- Actividades y próximos pasos de la oportunidad.
- Contactos relacionados y su mapeo.
- Leads accesibles.
- Cuota, avance y datos agregados del periodo cuando la consulta es general.
- Historial reciente de la conversación.
- Guía del proceso comercial.

Cuando existe una oportunidad seleccionada, sus datos son la fuente principal para preguntas sobre nombre, importe, fecha o etapa. Los totales del pipeline no deben sustituir los datos de esa oportunidad.

### Herramientas de lectura

Coach consulta el CRM mediante herramientas de solo lectura filtradas por los permisos efectivos del usuario: cuentas, oportunidades, detalle de oportunidad, actividades, contactos, leads, pipeline y readiness de etapa. `getOpportunityQuotation` permite consultar la ultima version accesible de una cotizacion seleccionada cuando el usuario tiene `oportunidades.read` y al menos un permiso `cotizaciones.*`.

La respuesta puede describir secciones, productos o servicios, cantidades, precios y descuentos comerciales. No debe exponer costos internos, margenes ni notas internas. Si no puede resolver una oportunidad unica y accesible o no encuentra una cotizacion accesible, Coach debe pedir seleccion o aclararlo; no debe inferir su contenido.

Cliente existente utiliza el mismo catalogo de lectura dentro de la cuenta fija autorizada, mas busqueda de interacciones propia del canal. Sus consultas nunca amplian el snapshot a otras cuentas. La matriz completa por canal esta en [Integraciones Mi Coach](./integraciones-mi-coach.md).

Una entidad inequívoca en la pregunta actual prevalece sobre el contexto activo; una referencia deíctica conserva la entidad activa. Si hay varias coincidencias explícitas, la selección anterior no las desambigua automáticamente y el Coach debe pedir aclaración. Las entidades que el Coach identifica en una respuesta solo se convierten en el contexto del siguiente turno después de validar sus IDs y relaciones contra el snapshot autorizado. Si una respuesta enumera varias entidades del mismo tipo, no se selecciona una de ellas arbitrariamente.

## Tipos de interacción

### Consulta de contexto

Responde preguntas sobre datos ya registrados, por ejemplo:

- "¿Cuál es el importe de esta oportunidad?"
- "¿Qué contactos tiene esta cuenta?"
- "¿Cuál fue la última actividad?"

Una consulta informativa no debe generar cambios por sí sola.

### Preparación de etapa

Evalúa qué tan preparada está una oportunidad para avanzar. La respuesta debe considerar:

- Etapa y objetivo actuales.
- Criterios ya cubiertos.
- Preguntas sin respuesta o con evidencia débil.
- Riesgos y bloqueos.
- Siguiente paso recomendado.
- Recomendación de avanzar, avanzar con cautela o permanecer en la etapa.

### Diagnóstico y recomendación

Explica riesgos, impacto y mitigación para una oportunidad concreta, o recomienda una acción con motivo, resultado esperado y criterio de éxito. Esto no equivale al Análisis de situación comercial, que evalúa cuota y pipeline en conjunto.

### Preparación de interacción

Puede preparar el objetivo, participantes, preguntas, mensajes clave, riesgos, evidencia necesaria y compromiso esperado para una llamada, reunión, demostración, negociación o seguimiento.

### Creación guiada

Puede proponer la creación de:

- Cuenta.
- Contacto.
- Oportunidad.
- Cotización.
- Propuesta.
- Actividad comercial.

La propuesta se muestra en un modal editable. Al confirmar, la interfaz persiste
la operación mediante el API de Coach, emite un handoff y abre el formulario
oficial. Solo ese módulo ejecuta el guardado final y conserva sus validaciones,
permisos y reglas de duplicados.

### Actualización guiada

Puede proponer:

- Cambiar nombre, importe o fecha de cierre de una oportunidad.
- Cambiar campos permitidos de una cuenta o contacto.
- Crear o actualizar una actividad de una oportunidad.
- Registrar o completar una respuesta de etapa.
- Registrar el resultado de llamada o resolver un lead.

La respuesta debe mostrar el cambio antes de aplicarlo. En respuestas de etapa existentes, el vendedor puede reemplazar el contenido o agregar texto al valor anterior.

### Aclaración

El chat debe pedir únicamente la información necesaria cuando falte una entidad, haya varias coincidencias, falten campos obligatorios o exista riesgo de operar sobre el registro incorrecto.

## Respuesta del Coach

El resultado normalizado contiene:

- `intent`: intención comercial detectada.
- `responseType`: `informational`, `recommendation` o `change_request`.
- `answer`: respuesta principal.
- `evidence`: evidencia utilizada.
- `recommendation`: siguiente paso sugerido.
- `confidence`: `high`, `medium` o `low`.
- `entities`: IDs y nombres de entidades identificadas.
- `operations`: hasta seis operaciones editables y validadas.
- `clarification`: solicitud de selección cuando el contexto es ambiguo.
- `action`: siguiente paso recomendado que puede convertirse en actividad.

Antes de mostrar una operación, el backend normaliza el resultado de IA y descarta referencias a oportunidades, cuentas, contactos, leads, preguntas de etapa o actividades que no estén en el contexto autorizado.

## Operaciones admitidas

El contrato actual acepta los siguientes tipos:

| Tipo                     | Resultado                                              |
| ------------------------ | ------------------------------------------------------ |
| `activity`               | Abre la actividad en Desarrollo comercial.             |
| `stage_answer`           | Reemplaza o agrega una respuesta de etapa.             |
| `opportunity_field`      | Actualiza un campo permitido de oportunidad.           |
| `account_field`          | Actualiza un campo permitido de cuenta.                |
| `contact_field`          | Actualiza un campo permitido de contacto.              |
| `lead_call_outcome`      | Registra el resultado de una llamada de lead.          |
| `lead_resolve`           | Ejecuta el flujo oficial de resolución de lead.        |
| `create_account`         | Abre el formulario oficial de cuentas.                 |
| `create_contact`         | Abre el formulario oficial de contactos.               |
| `create_opportunity`     | Abre el formulario oficial de oportunidades.           |
| `create_lead`            | Abre el formulario oficial de leads.                   |
| `create_contact_mapping` | Abre el formulario oficial de mapeo de contactos.      |
| `create_quotation`       | Abre el formulario oficial de cotizaciones.            |
| `create_proposal`        | Abre el flujo oficial desde una versión de cotización. |

Los campos editables desde operaciones de campo son:

- Oportunidad: `name`, `amountUsd`, `closeDate`.
- Cuenta: `name`, `phone`, `website`, `city`, `stateRegion`, `companyDescription`.
- Contacto: `firstName`, `lastName`, `email`, `mobile`, `phone`, `positionTitle`, `department`, `city`, `stateRegion`, `hierarchyLevelId`, `relationshipTypeId`, `influenceLevelId`, `managerContactId`, `influencesContactId`.

Una solicitud explícita de actividad tiene prioridad sobre la inferencia de una respuesta de etapa. Una actividad existente solo puede actualizarse si su `activityId` pertenece a la oportunidad indicada.

## Confirmación, cancelación y reversión

El flujo esperado es:

```text
pregunta -> respuesta -> propuesta -> revisión editable -> confirmar o cancelar -> resultado
```

- **Confirmar una operación delegada:** emite el token y abre el formulario oficial; el módulo ejecuta el guardado y después marca la operación como completada.
- **Cerrar el formulario:** conserva el token y la operación para continuar después.
- **Descartar borrador:** cancela la operación desde el módulo destino y elimina `coachDraft` de la URL.
- **Descartar en el Coach:** cancela la operación pendiente con confirmación y conserva el evento para las métricas.
- **Error:** conserva el borrador y muestra el mensaje devuelto por el dominio; en creaciones también puede mostrar advertencias de duplicados.
- **Revertir:** está disponible para cambios compatibles de campos de oportunidad, cuenta o contacto y para el último resultado de lead. No todas las operaciones son reversibles.

## Sesiones y continuidad

La interfaz conserva el identificador de sesión en `localStorage` bajo `mi-agent-coach-session`. Al regresar, solicita la sesión al API y restaura su contexto y mensajes. La preferencia para mostrar el fundamento de las respuestas se guarda de forma independiente bajo `mi-agent-coach-show-foundation`.

El backend:

- Crea una sesión si el cliente no envía una válida.
- Solo permite recuperar sesiones pertenecientes al usuario autenticado.
- Conserva contexto de cuenta, contacto, oportunidad, cotización, propuesta y lead.
- Guarda turnos de vendedor y Coach después de completar el job.
- Limita el historial persistido a los 40 turnos más recientes.
- Envía al modelo como máximo los ocho mensajes recientes.

Las operaciones no se almacenan en el campo singular `draft_operation`. Cada
propuesta normalizada se persiste como un registro independiente en
`coach_session_operations`, con un máximo de seis operaciones por respuesta.
Cada registro conserva la intención original, entidades identificadas, campos
recopilados y faltantes, evidencia, módulo destino, borrador editable, resultado
y motivo de cancelación.

Los estados persistentes son:

- `proposed`: propuesta creada.
- `collecting`: todavía tiene campos faltantes.
- `ready`: está completa y puede confirmarse.
- `handed_off`: fue enviada al módulo responsable.
- `executing`: el dominio está aplicando la operación.
- `completed`: terminó correctamente.
- `failed`: falló y conserva sus datos para reintento.
- `cancelled`: el vendedor la descartó.
- `superseded`: otra propuesta la reemplazó.

La interfaz recupera las operaciones activas junto con la sesión, muestra una
bandeja de pendientes y guarda las ediciones del modal con control de versión.
Completar o cancelar una propuesta no elimina las demás operaciones de la misma
respuesta.

Si la selección de contexto cambia mientras se procesa una pregunta, la interfaz descarta el resultado y solicita repetir la consulta para evitar mezclar entidades.

## Procesamiento asíncrono

1. `POST /api/mi-agent/coach` valida pregunta y contexto.
2. El API crea o recupera la sesión.
3. Se crea un registro `coach` con estado `pending` en `mi_agent_analysis_jobs`.
4. El worker en proceso cambia el job a `running` y carga contexto enriquecido.
5. Se resuelven entidades y se reduce el snapshot al contexto seleccionado.
6. OpenAI genera una respuesta JSON usando el proceso comercial.
7. El backend normaliza entidades y operaciones y marca el job como `completed` o `failed`.
8. La web consulta el job cada segundo, con un límite de espera de 180 segundos.

Cada solicitud al proveedor tiene un timeout de 120 segundos. El modelo predeterminado es `gpt-4.1-mini` y la temperatura del chat es `0.2`.

## API

Todas las rutas requieren autenticación y se montan bajo `/api/mi-agent`.

### Cargar contexto

```http
GET /api/mi-agent/context
```

Devuelve el contexto comercial autorizado del usuario.

### Enviar pregunta

```http
POST /api/mi-agent/coach
Content-Type: application/json

{
  "question": "¿Qué me falta para avanzar esta oportunidad?",
  "sessionId": 42,
  "history": [
    { "role": "seller", "text": "Revisemos la oportunidad Andina" },
    { "role": "coach", "text": "¿Qué aspecto quieres revisar?" }
  ],
  "context": {
    "accountId": 10,
    "opportunityId": 25,
    "contactId": 31
  }
}
```

Respuesta `202 Accepted`:

```json
{
  "sessionId": 42,
  "job": { "id": 108, "status": "pending", "pollAfterMs": 1000 }
}
```

`question` es obligatorio. `sessionId`, `history` y `context` son opcionales. El API acepta hasta ocho elementos recientes de `history` y recorta cada texto recibido a 2000 caracteres.

### Consultar job

```http
GET /api/mi-agent/coach/jobs/:jobId
```

Solo devuelve jobs de tipo `coach` creados por el usuario autenticado. Incluye estado, pregunta, contexto, error y resultado normalizado.

### Recuperar sesión

```http
GET /api/mi-agent/coach/sessions/:sessionId
```

Devuelve contexto, mensajes y operaciones activas de una sesión perteneciente
al usuario.

```http
GET /api/mi-agent/coach/sessions/active
```

Recupera la sesión activa más reciente y sus operaciones pendientes incluso si
el navegador ya no conserva el identificador en `localStorage`.

### Actualizar una operación pendiente

```http
PATCH /api/mi-agent/coach/operations/:operationId
```

Guarda `pendingOperation`, `collectedFields`, `missingFields` y `version`. Una
versión obsoleta responde `409` para impedir que otra pestaña sobrescriba el
borrador más reciente.

```http
POST /api/mi-agent/coach/operations
```

Persiste una operación delegada iniciada desde una recomendación determinista
de la interfaz. Exige contrato válido, `mi_coach.execute`, permiso del módulo y
una sesión propia. No crea registros de dominio; la operación todavía debe
convertirse en handoff y completarse en el formulario oficial.

```http
POST /api/mi-agent/coach/operations/:operationId/status
```

Registra transiciones de estado, resultado, error o motivo de cancelación. La
operación siempre se limita al usuario autenticado. Desde el paso 6 el cliente
solo puede usar esta ruta para cancelar; los estados de ejecución y cierre son
propiedad de los comandos backend.

### Revisar y ejecutar una actualización controlada

```http
POST /api/mi-agent/coach/operations/:operationId/review
POST /api/mi-agent/coach/operations/:operationId/execute
```

`review` relee el valor actual del registro, lo incorpora al borrador y aumenta
su versión. `execute` exige esa versión revisada y una `idempotencyKey`; bloquea
la operación, comprueba permisos y alcance, compara nuevamente el valor actual,
realiza la mutación, crea la auditoría de dominio y marca la operación como
`completed` dentro de una sola transacción. Un cambio concurrente responde
`409` sin sobrescribirlo.

### Transferir una operación a su módulo

```http
POST /api/mi-agent/coach/operations/:operationId/handoff
GET /api/mi-agent/coach/handoffs/:token?module=accounts
POST /api/mi-agent/coach/handoffs/:token/complete
POST /api/mi-agent/coach/handoffs/:token/cancel
```

La emisión es idempotente mientras el token siga vigente. La carga valida
usuario, expiración y módulo destino. `complete` recibe `module`, `entityType`,
`entityId` y un resultado opcional; `cancel` recibe `module` y un motivo. Un
token completado, cancelado, vencido o perteneciente a otro usuario no permite
volver a operar.

### Consultar métricas

```http
GET /api/mi-agent/coach/metrics
```

Devuelve métricas de los últimos 30 días: consultas, tokens, costo, propuestas,
aprobadas, rechazadas, completadas, fallidas, revertidas, canceladas,
reemplazadas, pendientes y decididas. Las tasas de aprobación y finalización se
calculan respectivamente como `approved / (approved + rejected)` y
`completed / approved`.

### Registrar rechazo

```http
POST /api/mi-agent/coach/operations/:operationId/reject
```

Marca una operación persistida como `rejected` y agrega el evento inmutable
correspondiente. Una recomendación visual sin operación persistida no altera
estas métricas.

### Revertir

```http
POST /api/mi-agent/coach/operations/:operationId/revert
```

La reversión usa la operación persistida, vuelve a comprobar permisos y alcance
y solo restaura el valor anterior si el registro todavía contiene exactamente
el valor escrito por esa operación. Los endpoints anteriores por auditoría y
por lead se mantienen temporalmente por compatibilidad, pero la interfaz ya no
los utiliza.

## Permisos y seguridad

La pestaña **Administración > Gobierno de Mi Coach** permite habilitar por separado la consulta de oportunidades ganadas, perdidas y anuladas. Estos switches controlan si cada categoría terminal entra al contexto histórico del Coach; no cambian el estado comercial, no reactivan la oportunidad y no la agregan al pipeline. Los valores predeterminados incluyen ganadas y perdidas, y excluyen anuladas. Cambiar estos controles requiere `mi_coach.admin` y queda registrado en auditoría.

- `mi_coach.use` permite abrir el espacio, cargar contexto y métricas, enviar preguntas, recuperar sesiones y registrar rechazos.
- La lectura de contexto depende además de los permisos `read` o `read_all` de cuentas, contactos, oportunidades y leads.
- La ruta y el menú de Mi Coach dependen directamente de `mi_coach.use`, no de lectura de oportunidades.
- La interfaz habilita cada operación mediante una matriz explícita de permisos; no existe un permiso genérico de respaldo para tipos desconocidos.
- Confirmar una actualización o iniciar un handoff exige `mi_coach.execute` y el permiso de mutación del dominio.
- El backend vuelve a comprobar el permiso y el alcance vigente sobre la entidad. Los datos enviados por el cliente no pueden cambiar el tipo, entidad, campo ni permiso de la operación persistida.
- Revertir exige los mismos permisos vigentes que ejecutar y nunca sobrescribe un cambio posterior.

## Persistencia y auditoría

El chat usa estas tablas:

- `coach_conversation_sessions`: contexto, mensajes, borrador, estado y fechas de la sesión.
- `coach_session_operations`: hasta seis operaciones independientes por
  respuesta, sus borradores editables, estado, evidencia, clave idempotente,
  auditoría de dominio y fechas de revisión, aprobación, ejecución, fallo,
  rechazo, finalización, cancelación y reversión. Es la fuente del estado actual.
- `coach_operation_events`: historial inmutable e idempotente de propuestas,
  captura de campos, preparación, aprobación, handoff, ejecución, finalización,
  fallo, rechazo, cancelación, reemplazo y reversión. Es la fuente de métricas
  del ciclo de vida.
- `mi_agent_analysis_jobs`: pregunta, snapshot, estado, resultado y error del procesamiento asíncrono.
- `coach_operation_audits`: tabla heredada, conservada sin nuevas escrituras.
- `audit_log`: auditoría autoritativa de las mutaciones de dominio. Cada cambio
  controlado guarda `coach_operation_id`; el evento de finalización o reversión
  guarda el `domain_audit_id` correspondiente.
- `ai_usage_ledger`: solicitudes, tokens y costo del chat atribuidos a
  `mi_coach.chat`; los análisis ajenos al Coach conservan `mi_agent.analysis`.

Las métricas no inspeccionan notas, títulos ni nombres de acciones de auditoría.
Los conteos de ciclo de vida salen exclusivamente de IDs y tipos de evento; los
pendientes salen del estado actual de `coach_session_operations`.

## Interfaz operativa

La respuesta del Coach separa explícitamente cuatro tipos de contenido:

- **Hechos:** datos confirmados, con módulo e identificador de origen cuando
  están disponibles.
- **Evidencia:** elementos que respaldan el diagnóstico.
- **Inferencias:** interpretaciones no confirmadas que requieren criterio del
  vendedor.
- **Recomendaciones:** sugerencias que todavía no modifican el CRM.

Estos cuatro bloques forman el **fundamento** de la respuesta. El switch
**Mostrar fundamento**, situado en el extremo derecho del encabezado
**Conversación**, los oculta inicialmente para mantener el hilo compacto y
permite mostrarlos en todas las respuestas de la sesión. La preferencia se
conserva al recargar. El switch solo aparece cuando al menos una respuesta tiene
fundamento disponible y no oculta la respuesta principal, el diagnóstico de
etapa ni las operaciones propuestas.

El diagnóstico de etapa muestra etapa y objetivo actuales, nivel general de
preparación, dimensiones confirmadas, principal punto de atención, avances,
pendientes, riesgos con evidencia, siguiente paso y recomendación de avance.

Las operaciones activas se restauran desde el servidor al abrir o recargar el
Coach. Cada una presenta su estado textual, módulo destino, vigencia del handoff,
campos faltantes y solo las acciones válidas:

- `Completar datos` abre una operación que todavía tiene campos obligatorios pendientes.
- `Abrir en <módulo>` retoma un handoff vigente en su formulario oficial.
- `Revisar` abre una operación lista, fallida o con handoff vencido.
- `Descartar` cancela una operación activa con confirmación.

El handoff permanece bloqueado mientras existan campos obligatorios sin valor.
El editor muestra los errores junto al campo y anuncia el guardado automático,
la validación y los conflictos de versión. Ante un conflicto se recuperan la
versión y los valores autoritativos del servidor.

Las operaciones terminales recientes se muestran separadas de las pendientes.
Las estadísticas autoritativas y las preguntas rápidas permanecen disponibles;
estas últimas se deshabilitan mientras hay una consulta en curso.

## Configuración

Variables necesarias o relevantes:

- `OPENAI_API_KEY`: habilita las consultas del Coach.
- `OPENAI_MODEL`: modelo utilizado; valor predeterminado `gpt-4.1-mini`.
- `OPENAI_BASE_URL`: endpoint compatible con OpenAI Responses API.

Si no existe `OPENAI_API_KEY`, el envío responde `503` con el mensaje de que la configuración IA no está habilitada.

## Errores esperados

- `400`: pregunta vacía, operación inválida o identificador inválido.
- `403`: falta un permiso requerido.
- `404`: entidad, sesión, job o cambio reversible inexistente o fuera de alcance.
- `409`: no hay un estado anterior reversible o no existe resultado de lead para revertir.
- `503`: IA no configurada.
- Job `failed`: timeout, error del proveedor o respuesta sin JSON válido.

La web también muestra un error si el job excede 180 segundos o si el usuario cambió el contexto antes de recibir la respuesta.

## Pruebas

La matriz focalizada de API valida contratos, ambigüedad, readiness de las siete
etapas, permisos, propiedad, expiración, idempotencia, rechazo, confirmación,
reversión, métricas y ausencia de escrituras directas desde el chat:

```bash
npm run test:coach --prefix apps/api
```

El ciclo HTTP real con MySQL está cubierto dentro de
`apps/api/test/api.integration.test.js`. Verifica sesiones y jobs propios y
ajenos, propuesta persistida, handoff, expiración, cancelación, rechazo,
actualización controlada, auditoría, reversión y restauración terminal.

La matriz E2E cubre cuenta, contacto, oportunidad, lead, mapeo, actividad,
cotización y propuesta. Cada recorrido abre el módulo destino, completa el
handoff, vuelve al chat y recupera el resultado después de recargar. También
verifica que el fundamento esté oculto inicialmente, que el switch lo muestre y
oculte sin afectar el diagnóstico, que la preferencia sobreviva a una recarga y
que la interfaz no se desborde en móvil:

```bash
npm run test:e2e:coach --prefix apps/web
```

El control conjunto se ejecuta con `npm run test:coach`. CI ejecuta además la
suite API completa, build, lint y la matriz E2E de Coach.

## Límites actuales

- El chat depende de la calidad y actualidad de los datos del CRM.
- El contexto conversacional incluye oportunidades activas y accesibles de las siete etapas, desde Contacto Inicial hasta Waiting. Los cálculos agregados de pipeline calificado conservan el subconjunto desde Desarrollo hasta Waiting.
- La resolución por texto adopta entidades únicamente cuando encuentra una coincidencia única.
- Se muestran como máximo seis operaciones por respuesta.
- La sesión conserva 40 turnos y cada consulta utiliza hasta ocho mensajes anteriores.
- Los jobs se ejecutan dentro del proceso de la API mediante `setImmediate`; no existe una cola externa independiente.
- Los registros heredados se migran solo a partir de fechas de ciclo confiables;
  no se inventan aprobaciones ni estados históricos sin evidencia.
- No todas las operaciones propuestas tienen reversión automática.

## Archivos principales

- `apps/web/src/MiAgentPage.jsx`: interfaz del chat, selección de contexto, polling, confirmaciones y ejecución.
- `apps/web/src/mi-agent-coach.css`: presentación general del panel.
- `apps/web/src/mi-agent-coach-thread.css`: presentación del hilo conversacional.
- `apps/api/src/routes.mi-agent.js`: contexto, prompt, jobs, normalización, métricas y reversión.
- `apps/api/src/coach/contract.js`: esquemas del contexto, turnos y operaciones.
- `apps/api/src/coach/entity-resolver.js`: resolución de entidades mencionadas.
- `apps/api/src/coach/service.js`: persistencia y recuperación de sesiones.
- `apps/api/src/coach/metrics.js`: agregación autoritativa de métricas.
- `apps/api/src/coach/schema.js`: tablas del chat y auditoría de operaciones.
- `apps/api/test/mi-agent-coach-operations.test.js`: pruebas focalizadas.

## Documentación relacionada

- [Especificación funcional del Chat Coach](./especificacion-chat-coach.md)
- [Proceso Comercial](./proceso-comercial.md)
- [Preguntas por etapa](./preguntas-etapas-proceso-comercial.md)
- [Desarrollo Comercial](./desarrollo-comercial.md)
- [Pruebas](./pruebas.md)
