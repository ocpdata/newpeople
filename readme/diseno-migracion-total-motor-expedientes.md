# Diseño: migración completa del chat de Cliente existente al motor de expedientes

Estado: **aprobado** (sin implementar). Fecha: 2026-10-25.

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

### Fase C — Redactor en el motor nuevo

- Modo `compose` con las reglas de §4.5 y verificación por código.
- **Casos objetivo:** C01-C09, L09, L10, MIX04/05.
- **Retira:** generación de contenido del recorrido anterior (B9) y su auditor.

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
  sombra (decisión 10.1.5).

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

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Romper escrituras al cambiar la interpretación de acciones | Ejecutores intactos; fase E al final; confirmación obligatoria; revisión manual |
| Regresiones en casos que hoy pasan | Corrida completa de la pestaña Pruebas en cada fase; comparar contra la corrida anterior |
| Variabilidad del modelo | Restricciones estructuradas validadas por código; una reparación con fallos concretos |
| Latencia de varias tareas | Fuentes compartidas por turno; presupuesto por tarea; tareas independientes en paralelo cuando no dependen entre sí |
| Instancia en la nube con código anterior sobre la misma base | Desplegar cada fase o desactivar su worker de evaluaciones durante las corridas |
| Costo de evaluación | Corridas dirigidas por fase y una completa al cierre de cada fase |

## 10. Decisiones

### 10.1 Tomadas (2026-10-25)

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
