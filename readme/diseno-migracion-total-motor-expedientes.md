# Diseño: migración completa del chat de Cliente existente al motor de expedientes

Estado: **aprobado**; fases A, A1, B y C implementadas. Fecha: 2026-10-25.

Documentos relacionados:
[diseño de consultas con expediente](./diseno-consultas-expediente-cliente-existente.md),
[registro de correcciones](./registro-de-correcciones.md) (COR-010 a COR-013) y
[preguntas de validación](./preguntas-validacion-chat-cliente-existente.md).

## 1. Objetivo

Que **todos** los turnos del chat de Cliente existente pasen por el motor nuevo:
una sola interpretación (el enrutador), un solo conjunto de datos autorizados
(el expediente) y una verificación por código antes de responder. El recorrido
anterior (B3 a B10) se retira al final.

Lo que **no** cambia:

- Permisos, alcance por cuenta y gobernanza del canal.
- Los ejecutores que preparan escrituras en el CRM y sus validaciones.
- La confirmación del vendedor antes de guardar cualquier cambio.
- Ninguna escritura se ejecuta desde el chat sin esa confirmación.

## 2. Situación actual

### 2.1 Dos recorridos

| Tipo de turno | Recorrido actual |
| --- | --- |
| Consultas y análisis sobre registros del CRM | Motor nuevo (enrutador → expediente → analista → verificador) |
| Redacción (correos, mensajes, agendas, preguntas, resúmenes, reescrituras, traducciones) | Recorrido anterior (B3 → B9/B10) |
| Documentos, cotizaciones, adjuntos, biblioteca y manuales | Recorrido anterior |
| Acciones (crear, actualizar, programar, reprogramar, vincular, notas, resultados, etapa) | Recorrido anterior |
| Respuestas a una aclaración de actividad pendiente | Resolución determinista nueva (COR-011) + ejecutor anterior |

El enrutador nuevo ya decide en cada turno si el mensaje es consulta, acción,
redacción o documento. Cuando no es consulta, el turno **se interpreta otra
vez** en B3, que lo divide en «componentes» de 46 categorías y lo somete a un
revisor.

### 2.2 Por qué conviene migrar todo

En la corrida completa de la pestaña Pruebas (212 casos, COR-013), casi todos
los fallos restantes nacen en la doble interpretación de B3:

| Síntoma | Casos | Causa |
| --- | --- | --- |
| «No pude conciliar la interpretación» | A09-01 (corregido), MIX09, SEQ15 paso 2 | Revisor de B3 rechaza su propia reinterpretación |
| Pierde cantidades o exclusiones al reescribir la tarea | SEQ15 paso 2, MIX07 (corregido) | B3 reescribe el texto del componente |
| Clasificación variable entre ejecuciones | Q09-01, Q11-02, A10-01 | B3 elige categoría o fuente distinta |
| Aclaraciones innecesarias | C01-02, L09 (corregidos) | Heurísticas por palabra clave dentro del recorrido anterior |
| Reglas pegadas con expresiones regulares | Exclusión de biblioteca, exclusión de costos, propósito del correo | Falta un campo estructurado para esas restricciones |

El motor nuevo ya resolvió estos patrones en las consultas: el enrutador con
`gpt-6.1-sol` aplicó correctamente las reglas que B3 falla (15 de 15 preguntas
de prueba), y el verificador por código impide afirmar datos sin respaldo.

Otros costos del doble recorrido:

- **Latencia:** antes del motor nuevo se construye el snapshot y se llama a la
  IA de selección (4-7 s) aunque el motor responda la consulta.
- **Mantenimiento:** ~18.000 líneas en `service.js`, `customer-chat-adapter.js`
  y `turn-contract*.js`, con reglas duplicadas en prompts y expresiones regulares.
- **Evaluación:** el evaluador depende de categorías de B3 (componentes,
  `stageReadiness`, `activityHistory`), lo que obliga a mantener dos juegos de
  verificaciones.

## 3. Principios del diseño

1. **Una sola interpretación.** El enrutador entiende el mensaje con el
   historial, el estado pendiente y las oportunidades visibles. Ningún
   componente posterior vuelve a interpretar el texto del vendedor.
2. **Restricciones como datos, no como expresiones regulares.** Cantidades,
   longitud, fuentes excluidas («sin biblioteca», «sin datos del cliente»),
   campos excluidos («sin costos») y negaciones («no lo envíes», «no guardes»)
   son campos estructurados del plan del turno.
3. **Todo hecho del CRM viene del expediente o de una herramienta autorizada**
   y se cita; el verificador lo comprueba por código.
4. **Las escrituras siguen siendo deterministas.** La IA propone; los
   ejecutores existentes validan y preparan borradores; el vendedor confirma.
5. **Fallos explícitos.** Una fuente fallida, restringida o truncada nunca se
   convierte en ausencia; un fallo técnico se dice como tal y se registra su
   causa (`dossierFailure`).
6. **Cada fase se mide** con el banco de aceptación y la pestaña Pruebas antes
   de pasar a la siguiente; ninguna fase retira código hasta medirla.

## 4. Arquitectura objetivo

```
Mensaje + historial + estado de la conversación
        │
        ▼
 ┌──────────────┐   plan del turno: tareas tipadas, foco, restricciones
 │  Enrutador   │──────────────────────────────────────────────┐
 └──────────────┘                                              │
        │ por cada tarea (en orden, con presupuesto propio)     │
        ▼                                                      │
 ┌──────────────────────────────────────────────┐              │
 │ Fuentes autorizadas                          │              │
 │  • Expediente de cuenta / oportunidad        │              │
 │  • Contenido de cotización (partidas)        │              │
 │  • Adjunto del turno                         │              │
 │  • Documentos del CRM                        │              │
 │  • Biblioteca documental (fragmentos)        │              │
 │  • Calculadoras (prioridad, comparación,     │              │
 │    tendencias, escenarios, preparación)      │              │
 └──────────────────────────────────────────────┘              │
        │                                                      │
        ├── consulta ──► Analista ──► Verificador ─┐           │
        ├── redacción ─► Redactor ──► Verificador ─┤           │
        ├── acción ────► Proponente ─► Ejecutor existente      │
        │                              (borrador + confirmación)│
        └── límite ────► Mensaje de límite fijo ───┤           │
                                                   ▼           │
                                     Presentación (una respuesta
                                     con una sección por tarea)◄┘
                                                   │
                                                   ▼
                                  Estado de la conversación actualizado
```

### 4.1 Enrutador (v2)

Evoluciona el enrutador actual. Devuelve un **plan del turno**:

| Campo | Contenido |
| --- | --- |
| `tasks[]` | Lista ordenada de tareas. Cada una con `type` (`consult`, `compose`, `document`, `action`, `limit`), `kind` (subtipo; ver §5), `ask` (lo pedido, con las palabras del vendedor), `focus` (nivel e IDs de oportunidad), `dependsOn` y restricciones |
| `constraints` por tarea | `count` (número exacto), `length` (`brief`/`standard`/`detailed`), `excludedSources` (`library`, `crm`, `quotation`, `attachment`), `excludedFields` (`costs`, `margins`, `internal_notes`), `noWrite`, `noSend`, `format` (lista, tabla, correo) |
| `continuation` | Si el mensaje responde una aclaración o completa una tarea pendiente, y cuál |
| `clarification` | Solo si una tarea no puede ejecutarse sin un dato; con opciones cuando hay candidatos |

Reglas que hoy están dispersas en B3 y en expresiones regulares pasan a ser
instrucciones del enrutador con validación por código:

- Una acción mencionada dentro de un texto a redactar no es una acción.
- «No guardes», «solo redacta», «no lo envíes» se reflejan en `noWrite`/`noSend`.
- Una petición de manual o configuración del CRM es `limit` (ayuda del sistema).
- Eliminar o enviar son `limit` con su mensaje fijo, no aclaraciones.
- Los principios comerciales se responden sin pedir oportunidad.

Validación por código del plan: IDs de oportunidad visibles, dependencias que
apuntan a tareas anteriores, `count` coherente con el tipo de tarea,
restricciones literales en el mensaje (cada exclusión debe aparecer citada).
Un plan inválido recibe **un** reintento con los problemas concretos (igual
que hoy).

### 4.2 Estado de la conversación unificado

Hoy conviven `dossierMemory`, `turnMemory` de B3, `pendingActivity`,
`pendingActivityIntent`, `pendingAmountSelection`, memorias de documentos,
listas, comparaciones, reprogramaciones, etc. Se reemplazan por un único
estado validado:

| Parte | Contenido |
| --- | --- |
| `focus` | Nivel y oportunidades en foco |
| `lastTasks` | Tareas del turno anterior (tipo, `ask`, restricciones, estado) |
| `pendingAction` | Borrador de acción abierto: tipo, campos completos y faltantes, ID del borrador persistido |
| `pendingClarification` | Qué se preguntó y qué opciones se ofrecieron |
| `lastDocument` | Fuente documental usada (cotización y versión, adjunto, documento CRM) |
| `citedEvidenceIds` | Evidencias citadas, para continuidad (nunca como prueba) |

El enrutador recibe este estado; las respuestas cortas («a sealpath», «a las
10», «la otra») se resuelven contra él. La resolución determinista de COR-011
se conserva como **validación**: el enrutador propone, el código comprueba que
la oportunidad, fecha y hora existen y son válidas.

### 4.3 Fuentes autorizadas

El expediente actual se amplía con fuentes que hoy solo usa el recorrido
anterior. Todas devuelven estado (`loaded`, `empty`, `restricted`,
`truncated`, `failed`) y evidencias con ID estable:

| Fuente | Origen actual que se reutiliza | Evidencia |
| --- | --- | --- |
| Partidas de cotización (secciones, ítems, cantidades, inclusiones, condiciones) | `getAuthorizedCoachQuotationContent` | `qitem{versión}-{sección}-{ítem}` |
| Adjunto del turno | Extracción actual de `request.attachment` | `att{n}` por fragmento |
| Documentos del CRM asociados | `customer-crm-documents.js` | `doc{id}-{fragmento}` |
| Biblioteca documental | `retrieveCustomerChatDocumentKnowledge` (B12) | `lib{n}`; marcada como conocimiento general, nunca hecho del cliente |
| Preparación de etapa | `customer-stage.js` / readiness | Preguntas, respuestas y criterios con su ID |
| Relaciones contacto-oportunidad | `customer-relationships.js` | IDs de contacto y oportunidad |
| Calculadoras | `customer-prioritization.js`, `customer-comparison.js`, `customer-trends.js`, `customer-scenarios.js` | Resultado calculado con los IDs de entrada |

#### Brechas del expediente actual (revisión del 2026-10-25)

El expediente de consultas no lee todo el CRM. Estas brechas se completan en
la **fase A1** (§8), antes de migrar el resto:

| Área | Falta hoy | Tablas |
| --- | --- | --- |
| Perfil de la cuenta | Tipo, sector, sitio web, ciudad, estado, país, descripción y responsables (solo hay nombre e ID) | `accounts`, `account_types`, `account_owners` |
| Espacio de trabajo de la oportunidad | Actores clave, debilidades, evaluación de criterios, entregables, estrategia recomendada y temas | `opportunity_workspace_stakeholders`, `opportunity_workspace_weaknesses`, `opportunity_workspace_criterion_assessments`, `opportunity_workspace_deliverables`, `opportunity_workspace_recommended_strategy`, `opportunity_workspace_theme_entries` |
| Interacciones de cuenta, campañas y leads | Solo se leen interacciones ligadas a una oportunidad | `interactions` (sin oportunidad), `account_interactions`, `campaign_account_interactions`, `interaction_contact_links` |
| Calendario de la cuenta | Actividades de calendario no ligadas a una oportunidad | `commercial_calendar_activities` |
| Registros de fabricante y renovaciones | Registros de la oportunidad ante el fabricante y sus renovaciones | `opportunity_manufacturer_registrations`, `opportunity_manufacturer_registration_renewals` |
| Propuestas comerciales | Propuestas generadas en el CRM y sus versiones | `proposals`, `proposal_documents`, `proposal_revisions` |
| Contenido de cotizaciones | Partidas, cantidades, precios comerciales y condiciones (pago, garantía, entrega, vigencia) | `quotation_sections`, `quotation_section_items` y catálogos de condiciones (fase D) |
| Contenido de documentos y biblioteca | Texto de documentos y fragmentos de la biblioteca | Fase D |

Se mantienen: solo registros activados, estados comerciales según la
gobernanza, permisos del usuario, herramientas habilitadas del canal y topes
por sección con estado `truncated`. Las señales comerciales y la planeación
(metas, periodos) quedan fuera del chat de Cliente existente salvo decisión
posterior.

Las fuentes se cargan **solo si una tarea las necesita** y respetan
`excludedSources` y `excludedFields` del plan (por ejemplo, la cotización sin
costos internos). Las calculadoras se ejecutan por código; la IA solo las
explica.

### 4.4 Analista (consultas)

Es el actual, con dos cambios:

- Recibe las fuentes nuevas y las salidas de calculadoras como evidencia.
- Cuando la calculadora produce una tabla (comparación, tendencia, escenario),
  la tabla se presenta tal como la calcula el código; el analista no la reescribe.

### 4.5 Redactor (redacción)

Nuevo modo del mismo motor para `compose`:

| Tipo | Reglas verificadas por código |
| --- | --- |
| Correo | Línea `Asunto:` y saludo; destinatario existente; sin compromisos, reuniones ni envíos inventados; marcadores `[por definir]` si falta el propósito |
| Mensaje breve | Longitud máxima |
| Agenda | Suma de minutos igual a la pedida; puntos ligados a la oportunidad citada |
| Preguntas de descubrimiento | Cantidad exacta; sin respuestas del cliente; procedencia declarada (CRM, biblioteca o general) |
| Resumen, reescritura, traducción de material aportado | Solo el material aportado; sin datos del CRM añadidos |
| Argumento de valor | Hechos del cliente citados; capacidades de producto marcadas como generales |

Cada afirmación sobre el cliente cita evidencia, igual que en el analista. El
propósito faltante de un correo nunca bloquea otras tareas del turno.

### 4.6 Acciones

El motor nuevo **interpreta y propone**; los ejecutores existentes **validan,
preparan el borrador y piden confirmación**. Se elimina la interpretación de
B3 y el planificador de B4, no los ejecutores.

| Acción | Proponente (IA) entrega | Ejecutor que se conserva |
| --- | --- | --- |
| Programar o registrar actividad | Tipo, oportunidad, contacto, fecha, hora, objetivo, si ya ocurrió | `activity-draft.js` + `activity-draft-persistence.js` |
| Reprogramar actividad | Actividad, nueva fecha y hora | `customer-reschedule.js` |
| Actualizar campos (importe, cierre, etc.) | Registro, campo, valor nuevo con evidencia literal | `customer-updates.js` |
| Vincular contacto | Oportunidad, contacto, sustitución o adición | `customer-links.js` |
| Resultado de llamada de lead | Lead, resultado, fecha | `customer-outcomes.js` |
| Crear contacto u oportunidad | Campos propuestos | `customer-creation.js` |
| Nota de oportunidad | Oportunidad, texto literal | Operación `opportunity_note` |
| Respuesta de etapa / reporte del vendedor | Oportunidad, pregunta, texto con atribución e incertidumbre | `turn-contract-runtime` (prefill de respuesta de etapa) |
| Avance de etapa | Oportunidad; requiere lectura previa de preparación | `customer-stage.js` |
| Eliminar o enviar | — | Mensaje de límite fijo (no hay ejecutor) |

Reglas que se mantienen sin cambios: confirmación explícita, validación de
permisos y de gobernanza por tipo de operación, no ejecutar con datos
faltantes, auditoría de cada borrador.

### 4.7 Tareas múltiples

Un turno con varias tareas (por ejemplo MIX04: resumen, pendientes, correo y
agenda) se ejecuta tarea por tarea con **presupuesto propio** (tiempo y
lecturas). Una tarea que falla o pide aclaración no bloquea las demás. La
presentación muestra una sección por tarea con su estado, como hoy.

### 4.8 Presentación y verificación

- Una respuesta por turno, con secciones por tarea y evidencia citada.
- El verificador actual se extiende a redacción (reglas de §4.5) y a
  propuestas de acción (campos obligatorios, IDs existentes).
- Una reparación por tarea con los fallos concretos; si persisten, aviso
  visible en esa sección.
- Se retira B10 (redacción conversacional auditada): la verificación ocurre
  sobre la salida estructurada.

## 5. Destino de las 46 categorías de B3

| Categorías actuales | Destino |
| --- | --- |
| `query.account_summary`, `record_detail`, `field_value`, `record_list`, `record_search`, `opportunity_notes`, `history`, `pending_items`, `relationships`, `stage_readiness` | `consult` (analista + expediente; ya cubierto en su mayoría) |
| `guidance.situation_assessment`, `risks_and_gaps`, `next_steps`, `strategy` | `consult` |
| `guidance.prioritization`, `comparison`, `trend_analysis`, `scenario_analysis` | `consult` con calculadora determinista como fuente |
| `query.document_content` (cotización, adjunto, documento CRM, biblioteca) | `document`: fuente correspondiente + analista |
| `query.system_help` | `limit` (ayuda del sistema; sin manual inventado) |
| `content.email_draft`, `message_draft`, `meeting_preparation`, `discovery_questions`, `summary`, `explanation`, `rewrite`, `translation`, `value_argument` | `compose` (redactor) |
| `report.client_statement`, `seller_observation`, `interaction_outcome`, `commitment`, `document_evidence`, `hypothesis` | `action` (respuesta de etapa o nota, con atribución) o `consult` si solo se comenta |
| `action.create_record`, `update_fields`, `update_stage_answer`, `link_records`, `schedule_activity`, `reschedule_activity`, `record_outcome`, `record_note`, `change_status` | `action` (proponente + ejecutor existente) |
| `action.remove_record`, `send_communication` | `limit` con mensaje fijo |

## 6. Gobernanza, permisos y observabilidad

- **Gobernanza del canal:** cada tipo de tarea se mapea a las intenciones y
  herramientas configurables actuales (`mi_channel_intent_configurations`).
  Una herramienta deshabilitada deja la fuente como `restricted` o la tarea
  como deshabilitada, con mensaje explícito (ya implementado para el
  expediente en la fase 2).
- **Permisos:** las fuentes y los ejecutores usan los mismos chequeos que hoy.
- **Trazas:** el panel de diagnóstico pasa de bloques B1-B12 a etapas del
  motor: plan, fuentes (estado por sección), tarea, verificación, propuesta,
  presentación. Se conserva `dossierFailure` y la causa de cada fallo.
- **Calidad:** `coach_turn_quality_traces` registra el plan, el estado de
  cada tarea y los fallos de verificación.

## 7. Evaluación

- **Banco de aceptación** (17 preguntas multiturno): se mantiene como control
  de consultas.
- **Pestaña Pruebas** (212 casos): sus verificaciones dejan de depender de
  categorías de B3. Cada caso declara qué tareas espera (tipo y restricciones)
  y se verifica contra el **plan del turno** y el contenido, no contra
  componentes internos.
- **Pruebas de acciones:** cada ejecutor conserva sus pruebas; se añaden
  pruebas del proponente (campos, IDs, negaciones `noWrite`/`noSend`).
- Criterio general por fase: ningún caso que hoy pasa deja de pasar, y los
  casos objetivo de la fase pasan en dos corridas seguidas.

## 8. Fases

### Fase A — Preparación (sin cambio visible)

- Evaluador de la pestaña Pruebas basado en tareas esperadas y contenido.
- Contrato del plan del turno (§4.1) y del estado unificado (§4.2), con pruebas.
- Inventario de pruebas existentes por capacidad.
- **Criterio:** la corrida completa con el sistema actual da el mismo
  resultado con el evaluador nuevo que con el actual (salvo los casos que hoy
  fallan por formato).

### Fase A1 — Expediente completo para consultas

- Agregar al expediente las brechas de §4.3 que no dependen de documentos:
  perfil y responsables de la cuenta, espacio de trabajo de la oportunidad,
  interacciones de cuenta, campañas y leads, calendario de la cuenta,
  registros de fabricante y renovaciones, y propuestas.
- Cada sección con estado, significado, permisos y herramienta de gobernanza
  correspondiente; evidencias con ID estable y citas legibles.
- Ampliar el banco de aceptación con preguntas sobre estas áreas (por
  ejemplo, «¿quiénes son los actores clave de Hardware Refresh?», «¿qué
  estrategia está recomendada?», «¿a qué sector pertenece la cuenta?»).
- **Criterio:** los hechos nuevos del banco aparecen en el expediente (como
  en la fase 1) y las preguntas nuevas pasan sin afirmar ausencias falsas.

#### Estado de la fase A1 (2026-10-25)

Implementada en `dossier/extended-sections.js`:

- Expediente de cuenta: `accountProfile` (tipo, sector, sitio, ubicación,
  descripción y responsables), `accountInteractions`, `leads`
  (interacciones sin oportunidad), `campaignInteractions` y `accountCalendar`.
- Expediente de oportunidad: `stakeholders`, `weaknesses`,
  `criterionAssessments`, `deliverables`, `recommendedStrategy`,
  `themeEntries`, `manufacturerRegistrations` (con renovaciones),
  `proposals` y `proposalDocuments`.
- Permisos: espacio de trabajo con oportunidades + desarrollo comercial;
  `registros_fabricantes`, `propuestas`, `campanas`, `interacciones` y
  `calendario_comercial` para sus fuentes. Cada sección respeta la
  herramienta del canal correspondiente.
- Las fechas de registros ante el fabricante se leen como el día guardado
  por la aplicación (medianoche UTC del día elegido); formatearlas en la base
  daba un día menos.
- Banco ampliado a 23 turnos (conversaciones TOTALPLAY-A1 y DIESTRA-A1) y 62
  hechos; los 62 están en el expediente (50/50 críticos).
- **Resultado:** banco completo con el motor nuevo 22/23 turnos, 48/49 hechos
  críticos y 0 afirmaciones prohibidas; las 6 preguntas nuevas pasan. El
  único fallo es R3, el caso ya conocido que exige además nombrar las
  actividades realizadas. Dos criterios nuevos (X3 y Y1) se ajustaron a lo
  que preguntaban después de la primera evaluación: pedían el título de los
  leads y el folio del registro, que las preguntas no solicitaban.
- Hoy están vacías en la base las tablas de actores, debilidades, criterios,
  entregables y temas; el expediente las lee y lo indicará cuando tengan datos.

### Fase B — Enrutador v2 como única puerta

- El enrutador produce el plan para **todos** los turnos.
- Las tareas de redacción, documento y acción se ejecutan, de momento, con
  las funciones del recorrido anterior **invocadas directamente por tarea**,
  sin pasar por B3 ni su revisor (adaptador de tareas).
- Tareas múltiples con presupuesto por tarea.
- **Elimina:** reinterpretación de B3 y aclaraciones de «no pude conciliar».
- **Casos objetivo:** MIX04, MIX07, MIX09, SEQ15, Q09-01, Q11-02, A09-01,
  A10-01/03 y todas las secuencias SEQ.
- **Riesgo:** las funciones de ejecución esperan componentes de B3; el
  adaptador traduce tarea → componente y se cubre con pruebas.

#### Estado de la fase B (2026-10-25)

Implementada con un ajuste respecto del plan original: los ejecutores del
recorrido anterior dependen de especificaciones por categoría (documento,
lista, historial, acción), así que B3 **sigue rellenando esas
especificaciones**, pero ya no interpreta el turno.

- El enrutador produce el plan de `dossier/turn-plan.js` para todos los
  turnos (tareas, restricciones con cita literal, filtros, continuación y
  aclaración). La ruta del analista (modo, foco y obligaciones) se deriva del
  plan por código.
- Consultas: el motor nuevo. Límites (eliminar, enviar, ayuda del sistema,
  fuera de alcance): respuestas fijas del motor nuevo, también cuando vienen
  mezclados con consultas. La ayuda del sistema enlaza la documentación si se
  configura `SYSTEM_DOCUMENTATION_URL`; si no, pide la documentación al
  administrador.
- Redacción, documentos y acciones: el plan viaja al recorrido anterior. B3
  recibe las tareas (`plannedTasks`) con las categorías permitidas por tarea
  y devuelve un componente por tarea. **Sin revisor de IA**: el código
  compara contrato y plan (`dossier/plan-alignment.js`: tarea faltante,
  componente no planificado, restricción literal perdida y material aportado
  sustituido por una descripción), pide una sola corrección y después alinea
  por código (quita lo no planificado, repone citas y material, crea tareas
  sin especificación adicional como límites y redacciones simples).
- Tras el reintento, los problemas de cita literal del enrutador quedan
  registrados (`softIssues`) pero no hacen fallar el turno.
- **Resultado:** banco de consultas 21/23 en la corrida completa; las dos
  conversaciones fallidas pasan al repetirlas tras ajustar «qué cotización
  tiene» como consulta (no documento). Pestaña Pruebas, 70 casos dirigidos
  (acciones, redacción, límites, secuencias y mezclas): 58 en revisión humana
  en la primera corrida; tras las correcciones, 4 de los 6 fallos no
  relacionados con la biblioteca pasan al repetirlos. Pendientes:
  - Q09-01 (inestable conocido: depende del aspecto que elige B3) → fase D.
  - C05-01/C05-03: el auditor de contenido anterior rechaza resúmenes de
    material aportado → fase C.
  - «No hay un único borrador vigente» en transformaciones encadenadas
    (SEQ06), ya presente antes → fase C.
  - MIX09, SEQ11, SEQ13 y SEQ15 no pudieron validarse: la biblioteca
    (Pinecone Assistant) agotó su límite mensual de 500.000 tokens de
    contexto. El error ahora se registra con su mensaje real en lugar de
    `SyntaxError`.

### Fase C — Redactor en el motor nuevo

- Modo `compose` con las reglas de §4.5 y verificación por código.
- **Casos objetivo:** C01-C09, L09, L10, MIX04/05.
- **Retira:** generación de contenido del recorrido anterior (B9) y su auditor.

#### Estado de la fase C (2026-10-25)

Implementada en `dossier/composer.js`:

- El plan indica por tarea su `material`: `none`, `message_text` (texto
  pegado en el mensaje), `previous_answer` (respuesta anterior del
  asistente), `attachment` o `library`. El motor nuevo redacta cuando las
  tareas son consultas, redacciones y límites, y ninguna redacción usa
  adjunto ni biblioteca (eso sigue en el recorrido anterior hasta la fase D).
- El redactor devuelve entregables estructurados (asunto, cuerpo, puntos con
  minutos, notas y afirmaciones con evidencia); el **código arma el texto
  final**. En turnos mixtos, el analista responde primero y el redactor
  recibe su respuesta.
- Verificación por código (§4.5): asunto y saludo en correos; longitud de
  mensajes; agenda que suma la duración pedida; cantidad exacta de puntos o
  preguntas, que terminan en «?»; al transformar texto aportado, sin
  registros del CRM ni cifras ausentes del texto fuente; incertidumbre
  conservada («quizá», «no está confirmado»); sin importes si se excluyeron
  precios o costos; sin afirmar envíos, guardados ni agendas; afirmaciones
  del cliente verificadas como en el analista. Una reparación con los fallos
  concretos.
- Transformaciones encadenadas («más breve», «tradúcelo») trabajan sobre la
  respuesta anterior; si no la hay, se pide el texto.
- Las redacciones que excluyen el CRM o solo transforman texto aportado no
  reciben registros del CRM.
- Se corrigió el enrutador: preparar el contenido de una reunión es
  redacción, no agendar una actividad.
- **Streaming del proveedor de IA:** el gateway `OPENAI_BASE_URL` corta a
  los ~30 s las peticiones sin respuesta. Las llamadas se piden en streaming
  (`OPENAI_STREAM_RESPONSES`, activo por defecto); turnos grandes como MIX05
  ya no fallan con 504. Un flujo que deja de enviar datos 60 s
  (`OPENAI_STREAM_IDLE_TIMEOUT_MS`) se aborta como fallo transitorio y se
  reintenta una vez; el enrutador también tiene ese reintento.
- **Resultado:** 34 casos (C01-C09, L09, L10, MIX04, MIX05, SEQ06, A10-03):
  todos en revisión humana tras repetir MIX05 con streaming. SEQ06
  (redactar, acortar, traducir y pedir envío) funciona completo por primera
  vez. Banco de consultas 22/23. Acciones, límites, secuencias y mezclas del
  recorrido anterior (29 casos) en revisión humana con streaming.
- Retiro pendiente: la generación de contenido del recorrido anterior (B9) y
  su auditor siguen en uso para redacciones con biblioteca o adjunto; se
  retiran con la fase D.

### Fase D — Documentos, biblioteca y calculadoras como fuentes

- Fuentes de §4.3 en el expediente; analista y redactor las usan.
- Calculadoras deterministas con presentación de tablas.
- **Casos objetivo:** Q09, Q11, R01-R06, G01-G08, K, L.
- **Retira:** lectores documentales y de calculadoras del adaptador anterior.

### Fase E — Acciones

- Proponente por tipo de acción → ejecutor existente → confirmación.
- Estado unificado para borradores y aclaraciones (sustituye COR-011 como
  lógica principal; COR-011 queda como validación).
- **Casos objetivo:** A01-A11, SEQ01-SEQ10, K08 y los escenarios del banco.
- **Criterio adicional:** ninguna escritura sin confirmación en pruebas
  automáticas y revisión manual de 20 acciones reales en desarrollo. Sin modo
  sombra (decisión 11.1.5).

### Fase F — Retiro del recorrido anterior

- Se eliminan B3 (`turn-contract*.js`), el planificador de B4, la
  clasificación previa del snapshot, B10 y las ramas sin uso de
  `customer-chat-adapter.js` y `service.js`.
- **Ganancia esperada:** 4-7 s menos por turno y una sola base de reglas.
- **Criterio:** dos corridas completas consecutivas sin regresiones.

### Estimación orientativa

| Fase | Esfuerzo relativo | Costo de IA de verificación |
| --- | --- | --- |
| A | Medio | Bajo (una corrida completa ~4 USD) |
| A1 | Medio | Bajo (banco ampliado ~1-2 USD) |
| B | Alto | ~4-8 USD |
| C | Medio | ~2-4 USD |
| D | Alto | ~4-8 USD |
| E | Alto | ~4-8 USD |
| F | Medio | ~8 USD (dos corridas completas) |

Costo por turno en producción: enrutador `gpt-6.1-sol` (~0,005 USD) más
analista o redactor (~0,02-0,04 USD). Las acciones agregan un proponente
(~0,01 USD) y ya no pagan B3 ni su revisor.

### Estado de la fase A (2026-10-25)

Implementada:

- Contrato del plan del turno en `dossier/turn-plan.js`: tipos y subtipos
  de tarea, restricciones con cita literal, continuación y aclaración. La
  validación por código revisa IDs visibles, dependencias, coherencia de
  tipo y subtipo, negaciones (`noWrite`, `noSend`) y duración de agendas.
- Estado unificado en `dossier/conversation-state.js`, con validación contra
  las oportunidades visibles y conversión desde las memorias actuales.
- Tareas observadas en `dossier/observed-tasks.js`: traduce las 46
  categorías del recorrido anterior y las tareas del motor nuevo
  (`turnTasks`) a la misma forma.
- El evaluador de la pestaña Pruebas lee tareas observadas, no categorías
  del recorrido anterior.
- **Criterio cumplido:** al re-evaluar sin costo las respuestas guardadas de
  tres corridas (471 pasos), el evaluador nuevo da exactamente los mismos
  veredictos que el anterior.

Ninguno de estos contratos se usa todavía para decidir el turno; la fase B
los conecta.

## 9. Inventario de pruebas por capacidad

| Capacidad (catálogo) | Destino y fase | Pruebas automáticas actuales |
| --- | --- | --- |
| Resumen, detalle, campo, lista, búsqueda (Q01-Q05) | Consulta; ya en el motor nuevo; A1 completa el expediente | `customer-dossier`, `customer-dossier-engine`, `customer-record-list`, `customer-record-search`, `customer-chat-acceptance` |
| Historial (Q06) | Consulta (A1: interacciones y calendario de cuenta) | `customer-history`, `customer-history-snapshot` |
| Pendientes (Q07) | Consulta | `customer-pending`, `customer-pending-activity` |
| Relaciones (Q08) | Consulta | `customer-relationships` |
| Cotización y material (Q09) | Documento, fase D | `customer-documents`, `customer-crm-documents`, `customer-document-reports`, `customer-chat-document-knowledge` |
| Preparación de etapa (Q10) | Consulta (fuente de preparación, fase D) | `customer-stage`, `customer-stage-routes` |
| Ayuda del sistema (Q11) | Límite, fase B (enlace a documentación cuando exista) | `customer-turn-contract` |
| Notas (Q12) | Consulta | `customer-dossier`, `customer-chat-adapter` |
| Diagnóstico, riesgos, siguientes pasos, estrategia (G01-G03, G08) | Consulta | `customer-dossier-engine`, `customer-account-chat-evaluation` |
| Priorización, comparación, tendencias, escenarios (G04-G07) | Consulta con calculadora, fase D | `customer-prioritization`, `customer-comparison`, `customer-trends`, `customer-scenarios` |
| Correo, mensaje, reunión, preguntas, resumen, explicación, reescritura, traducción, argumento de valor (C01-C09) | Redacción, fase C | `customer-content-validation`, `customer-turn-contract`, `customer-turn-pipeline`, `customer-conversational-response` |
| Reportes del vendedor (R01-R06) | Acción como propuesta revisable, fase E | `customer-document-reports`, `customer-turn-contract` |
| Crear registro (A01) | Acción, fase E | `customer-creation`, `customer-creation-access`, `customer-creation-routes` |
| Actualizar campos (A02) | Acción, fase E | `customer-updates`, `customer-update-access`, `customer-update-routes` |
| Respuesta de etapa (A03) | Acción, fase E | `customer-stage-validator-preservation`, `customer-chat-adapter` |
| Vínculo (A04) | Acción, fase E | `customer-links`, `customer-link-access`, `customer-link-routes` |
| Actividad (A05) | Acción, fase E | `customer-activity-draft`, `customer-pending-activity` |
| Reprogramar (A06) | Acción, fase E | `customer-reschedule`, `customer-reschedule-routes` |
| Resultado de lead (A07) | Acción, fase E | `customer-outcomes`, `customer-outcomes-routes` |
| Estado o etapa (A08) | Acción, fase E | `customer-stage`, `customer-stage-routes` |
| Eliminar, enviar (A09-A10) | Límite, fase B | `customer-turn-contract` |
| Nota (A11) | Acción, fase E | `customer-note-proposal-route` |
| Transversal | — | `customer-turn-plan` (nuevo), `customer-chat-evaluations`, `customer-chat-diagnostics`, `customer-server-policy-runtime`, `customer-server-rules`, `customer-conversation-context`, `customer-presentation`, `customer-chat-evidence` |
| Recorrido anterior que se retira (fase F) | — | `customer-turn-review`, `customer-interpretation-context`, `customer-turn-config`, partes de `customer-chat-adapter` y `customer-turn-pipeline` |

Las variantes `*.mysql.test.js` requieren la base de pruebas y se ejecutan
aparte.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Romper escrituras al cambiar la interpretación de acciones | Ejecutores intactos; fase E al final; confirmación obligatoria; revisión manual |
| Regresiones en casos que hoy pasan | Corrida completa de la pestaña Pruebas en cada fase; comparar contra la corrida anterior |
| Variabilidad del modelo | Restricciones estructuradas validadas por código; una reparación con fallos concretos |
| Latencia de varias tareas | Fuentes compartidas por turno; presupuesto por tarea; tareas independientes en paralelo cuando no dependen entre sí |
| Instancia en la nube con código anterior sobre la misma base | Desplegar cada fase o desactivar su worker de evaluaciones durante las corridas |
| Costo de evaluación | Corridas dirigidas por fase y una completa al cierre de cada fase |

## 11. Decisiones

### 11.1 Tomadas (2026-10-25)

1. **Orden de fases confirmado:** A → B → C → D → E → F, con la fase **A1**
   (expediente completo para consultas) agregada después de A a pedido del
   usuario.
2. **Instancia en la nube:** se deja como está; el usuario la actualizará
   después de hacer commit y push. Mientras tanto, las corridas de la pestaña
   Pruebas se ejecutan con un proceso local que retiene el bloqueo.
3. **Ayuda del sistema:** responde con el límite y queda **preparada para
   enlazar** a la documentación de la aplicación. La URL se configurará
   cuando exista esa documentación; mientras no esté configurada, la
   respuesta no muestra enlace ni inventa contenido del manual.

4. **Reportes del vendedor** (`report.*`): siempre como **propuesta
   revisable**. El chat prepara el borrador (respuesta de etapa o nota, con
   atribución e incertidumbre) y solo se guarda cuando el vendedor lo
   confirma. Nunca se escriben directamente.
5. **Sin modo sombra en acciones.** La fase E se valida con pruebas
   automáticas de cada proponente y ejecutor y con la revisión manual de 20
   acciones reales en desarrollo.

No quedan decisiones pendientes para iniciar la fase A.
