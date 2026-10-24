# Diseño: consultas de Cliente existente con expediente y analista con citas

**Estado:** diseño aprobado (COR-010), con las decisiones de la sección 11
resueltas. Sin implementación.

**Alcance:** solo las **consultas y análisis** del chat de Cliente existente.
Las **acciones** (crear, actualizar, programar, registrar notas, respuestas de
etapa, cambios de estado) siguen por el recorrido actual con contratos
estrictos, permisos y confirmaciones, sin cambios.

## 1. Por qué cambia el enfoque

El recorrido actual clasifica cada pregunta en una de 46 categorías. Cada
categoría ejecuta una receta que decide de antemano qué datos lee y, en
muchos casos, qué texto se responde. El análisis de la sesión 61 (jobs
198-201) mostró que:

| Hallazgo comprobado | Consecuencia |
| --- | --- |
| El chat solo carga respuestas de la **etapa actual**; las de etapas anteriores no llegan. La consulta convierte un error de base de datos en lista vacía. | No conoce la necesidad, el presupuesto, el proceso de aprobación ni la fecha objetivo registrados. |
| `query.account_summary` no lee cotizaciones, notas ni fecha de cierre. | Un resumen omite datos que sí existen y declara “no especificado”. |
| Prompt de interpretación de ~72 700 caracteres con 305 prohibiciones, ejecutado por `gpt-4.1-mini`. | Las reglas puntuales no se cumplen de forma fiable (la regla de COR-007 estaba y se ignoró). |
| El revisor usa el mismo modelo y catálogo. | Aprueba los mismos errores. |
| Las auditorías verifican coherencia con lo leído, no con lo que existe. | Respuestas incompletas pasan como correctas. |
| Hasta cuatro capas distintas producen el texto final. | Respuestas técnicas o “duras” y dobles auditorías. |
| No existe aceptación de conversaciones reales de varios turnos. | Los fallos se descubren en el uso real. |

## 2. Principios

1. **La evidencia no depende de una clasificación.** Para una oportunidad se
   carga su expediente completo y acotado; la pregunta decide qué usar, no qué
   existe.
2. **El significado viaja con el dato.** Cada registro incluye qué es y qué no
   acredita (por ejemplo, “estado guardado: pendiente”, “fecha de cierre
   registrada, no confirmada con el cliente”). No se depende de reglas en el
   prompt para recordarlo.
3. **Toda afirmación factual cita su evidencia.** El código comprueba las
   citas; no otra IA con los mismos puntos ciegos.
4. **Ausencia solo si se buscó.** “No hay” solo es válido si la sección del
   expediente se cargó correctamente y está vacía.
5. **Nada silencioso.** Una lectura fallida, restringida o truncada se declara.
6. **Una sola capa redacta.** El analista escribe; el código verifica; la
   interfaz presenta.
7. **Se acepta con conversaciones reales.** Ninguna fase se da por terminada
   solo con pruebas simuladas.

## 3. Recorrido nuevo

```text
PREGUNTA + foco (oportunidad seleccionada o "toda la cuenta")
   │
   ▼
1. ENRUTADOR (modelo económico, prompt breve)
   ├─ modo: consulta | acción | aclaración | fuera de alcance
   ├─ foco: cuenta | una oportunidad | varias oportunidades (IDs reales)
   ├─ obligaciones: qué debe responderse y en qué forma
   └─ filtros explícitos sobre registros, con la cita literal del usuario
   │
   ├── acción ──────────────► recorrido actual de acciones (sin cambios)
   ├── aclaración ──────────► pregunta concreta con opciones
   │
   ▼
2. EXPEDIENTE (código, sin IA, con permisos actuales)
   │
   ▼
3. ANALISTA (modelo más capaz, una llamada)
   ├─ responde cada obligación
   ├─ cada afirmación: tipo + IDs de evidencia + valores estructurados
   └─ puede usar calculadoras existentes como herramientas
   │
   ▼
4. VERIFICACIÓN POR CÓDIGO
   ├─ éxito ───────────────► respuesta
   └─ fallos concretos ────► una reparación del analista
                              └─ si persiste: respuesta con partes marcadas
   │
   ▼
5. PRESENTACIÓN + evidencia enlazada + traza de lo leído
```

## 4. Foco y selector de oportunidad

- La interfaz añade un selector con **“Toda la cuenta”** (predeterminado) y
  las oportunidades de la cuenta. Puede cambiarse en cualquier momento de la
  conversación.
- El foco se envía **en cada pregunta** (`focusOpportunityId` opcional). No se
  fija al crear la sesión, para permitir cambiarlo sin abrir otra
  conversación. El backend ya admite `opportunityId` en la sesión; el foco por
  turno es un campo nuevo.
- **Con oportunidad seleccionada:** es el foco del turno. Si el usuario nombra
  explícitamente otra oportunidad, se responde sobre la nombrada y la
  respuesta indica el cambio de foco.
- **Sin oportunidad seleccionada:** el enrutador recibe la lista de
  oportunidades (ID, nombre, etapa, estado) y elige por ID: una, varias o la
  cuenta completa. Si es ambiguo, pregunta ofreciendo las opciones. El código
  verifica que los IDs pertenezcan a la cuenta.
- “Esta oportunidad” o “con esa evidencia” se resuelve con el foco del turno
  anterior guardado en memoria.

## 5. Enrutador

Modelo económico, prompt objetivo de menos de 2 000 tokens. No conoce las 46
categorías. Salida:

| Campo | Contenido |
| --- | --- |
| `mode` | `consult`, `action`, `clarify`, `out_of_scope` |
| `focus` | `{ level: account \| opportunity \| opportunities, opportunityIds[] }` |
| `obligations[]` | `{ id, ask, form }`; `form` indica la forma pedida: dato, lista, `N` puntos ordenados, comparación, recomendación |
| `recordFilters[]` | Restricción explícita sobre registros (por ejemplo, actividades que vencen en un período) con `quote`: fragmento literal del mensaje que la justifica |
| `clarification` | Pregunta y opciones, solo en `clarify` |

Controles por código:
- Los IDs de foco deben existir y estar autorizados.
- Cada `quote` de un filtro debe aparecer literalmente en el mensaje. Es una
  comprobación de existencia, no una interpretación por palabras clave. Un
  filtro sin respaldo literal se descarta y se informa en la traza.
- Si el turno incluye cualquier acción, se envía completo al recorrido actual
  (decisión 11.1).

## 6. Expediente

Se construye por código con los permisos y el alcance actuales. Cada sección
tiene un estado: `loaded`, `empty`, `failed`, `restricted` o `truncated`, con
conteos. Nunca se convierte un error en lista vacía.

### 6.1 Expediente de oportunidad

| Sección | Contenido | Significado que acompaña al dato |
| --- | --- | --- |
| Ficha | Importe y moneda, etapa, estado comercial, fecha de cierre, vendedor, preventa, línea de negocio, fechas de creación y actualización | “Fecha de cierre registrada; no acredita compromiso del cliente” |
| Respuestas de etapas | **Todas las etapas**, agrupadas y ordenadas, con fecha, autor y versión; la última respuesta por pregunta y las anteriores marcadas como sustituidas | “Respuesta registrada en la etapa X; su vigencia puede requerir confirmación” |
| Requisitos de la etapa actual | Preguntas obligatorias, criterios y faltantes | “Pendiente de validar en esta fuente” |
| Contactos | Contacto asociado, cargo y otros contactos de la cuenta | “El cargo no acredita autoridad de compra” |
| Actividades | Todas, con estado, vencimiento, fecha de realización y notas | “Estado guardado” separado de “lo que describe la nota” |
| Notas de oportunidad | Texto, autor y fecha | Distintas de las notas de actividades |
| Cotizaciones | Versiones, estado, importes y fechas | “Estado interno del CRM; no acredita aceptación del cliente” |
| Documentos | Metadatos; el contenido se lee bajo demanda con las herramientas actuales | Fuente y fecha |
| Historial | Cambios de etapa y estado | Fecha del cambio |

Cada elemento tiene un ID estable y legible para citar, por ejemplo
`opp121.etapa2.aprobacion`, `opp121.actividad51`, `opp121.cotizacion78.v1`.

### 6.2 Expediente de cuenta

Ficha de la cuenta, lista de oportunidades con su ficha resumida y conteos
por sección. El analista puede **abrir el expediente** de una oportunidad
concreta mediante una herramienta con límite de usos por turno.

### 6.3 Tamaño

Objetivo inicial: el expediente de una oportunidad cabe en ~12 000-15 000
tokens. Si una sección supera su límite, se marca `truncated` con el total y
se indica en la respuesta. Los límites se fijan midiendo oportunidades reales
en la fase 1.

### 6.4 Implementación (fase 1)

| Elemento | Ubicación |
| --- | --- |
| Constructor de expedientes de oportunidad y de cuenta | [opportunity-dossier.js](../apps/api/src/commercial-intelligence/dossier/opportunity-dossier.js) |
| Permisos por fuente | [access.js](../apps/api/src/commercial-intelligence/dossier/access.js) |
| Significado de cada dato | [semantics.js](../apps/api/src/commercial-intelligence/dossier/semantics.js) |
| Cobertura de los hechos del banco | [dossier-coverage.js](../apps/api/src/customer-chat-acceptance/dossier-coverage.js) |
| Pruebas | [customer-dossier.test.js](../apps/api/test/customer-dossier.test.js) |

El expediente aún **no está conectado al chat**: se usa solo desde el banco
de aceptación. La conexión llega en la fase 2.

**Lectura.** Todas las consultas se ejecutan dentro de una transacción de
solo lectura. Si la oportunidad o la cuenta no son accesibles, se rechaza la
solicitud sin revelar si existen.

**Permisos por sección.** Replican las reglas actuales del chat:

| Sección | Permiso requerido |
| --- | --- |
| Ficha, respuestas de etapas y preguntas de la etapa actual | `cuentas` y `oportunidades`, con el mismo alcance por propietario, creador o vendedor, y la política de oportunidades ganadas, perdidas y anuladas |
| Contactos | `contactos` |
| Actividades de oportunidad | `oportunidades` y `desarrollo_comercial` |
| Actividades de calendario | `calendario_comercial` y `oportunidades`; sin lectura global, solo las propias |
| Notas, documentos e historial | `cuentas` y `oportunidades` |
| Cotizaciones y orden de compra | `oportunidades` y algún permiso de lectura de cotizaciones |
| Interacciones | `interacciones`; sin lectura global, más restrictivo que el chat actual |

**Hallazgos durante la implementación:**

- **Estados de cotización.** El significado se tomó del flujo del código:
  `aprobar → aprobada` es una aprobación interna, `enviar → enviada` y
  `aceptar → aceptada`. Por eso *Aprobada* se describe como aprobación
  interna, sin envío ni aceptación registrados.
- **Orden de compra del cliente.** Se registra como documento de rol
  `purchase_order` de la cotización (`quotation_won_documents`). La tabla
  `quotation_processing_purchase_orders` corresponde a órdenes a
  proveedores. Se corrigió el hecho del banco que usaba esa tabla; el
  recuento en ambas era cero, así que la línea base no cambia.
- **Historial.** La tabla de control del historial comercial no está
  instalada. El expediente usa los eventos de auditoría y conserva solo los
  cambios de importe, cierre, etapa, estado y contacto, con nombres legibles
  y sin duplicados. Un evento ilegible se marca como tal.
- **Respuestas sustituidas.** Por pregunta, la respuesta más reciente es la
  vigente; las anteriores indican cuál las sustituye.

**Resultados con datos reales:**

| Expediente | Tamaño aproximado |
| --- | --- |
| Sealpath (121) | 7 500 tokens |
| Seguridad de Correo (117) | 12 000 tokens |
| Bigip de Raloy (27) | 11 400 tokens |
| Cuentas Grupo Diestra y Raloy | 550-700 tokens |

**Criterio de la fase 1 cumplido:** el expediente contiene los 51 hechos del
banco, incluidos los 40 hechos críticos distintos. Un recuento solo se acepta
como ausencia si la sección se leyó completa.

**Pendiente para la fase 2:**

- Aplicar las reglas de gobierno del canal, como deshabilitar fuentes o
  intenciones.
- Los importes de las cotizaciones no se incluyen porque no están
  almacenados por versión.
- El contenido de los documentos se leerá bajo demanda con las herramientas
  actuales.

Comandos, desde `apps/api`:

```bash
npm run test:customer-chat:bank -- --check-dossier --user <id>
npm run test:customer-chat:bank -- --check-dossier --user <id> --dump-dossiers --out acceptance-runs/expedientes
```

## 7. Analista

Modelo más capaz, una llamada por turno (más usos de herramientas acotados).
Recibe: pregunta, obligaciones, expediente, conversación reciente marcada como
**no evidencia** y la fecha actual.

Prompt breve, basado en principios generales y no en casos: responder lo
pedido, citar, separar lo registrado de lo inferido, no convertir ausencia
de carga en inexistencia y respetar el significado que acompaña a cada dato.

### 7.1 Salida

```text
blocks[]: por cada obligación
  obligationId
  status: answered | partial | cannot_answer
  items[]: puntos, cuando la forma pide una lista o N elementos
  claims[]:
    text
    kind: registered | inference | recommendation | to_confirm | absence
    evidenceIds[]
    values[]: { type: date | amount | person | status, value normalizado }
  reason: obligatorio si status no es answered
answerText: redacción final para el vendedor
```

### 7.2 Herramientas disponibles

Se reutilizan como herramientas, no como categorías que desvían el turno:
ranking entre oportunidades, comparación, tendencias, escenarios, contenido de
documentos y conocimiento documental (B12).

## 8. Verificación por código

| Control | Regla |
| --- | --- |
| Citas | Todo `evidenceId` existe en el expediente del turno. |
| Respaldo | Un `registered` o `absence` sin cita falla. |
| Valores | Cada valor estructurado (fecha, importe, persona, estado) coincide con un campo de la evidencia citada. Se compara el valor normalizado, no el texto redactado. |
| Ausencia | Un `absence` solo es válido si cita una sección en estado `loaded` o `empty`. |
| Cobertura | Cada obligación tiene su bloque; `partial` y `cannot_answer` explican el motivo. |
| Forma | Si se pidieron N puntos, hay exactamente N elementos. |
| Límites | Las secciones `failed`, `restricted` o `truncated` pertinentes se mencionan. |

Si falla algún control: **una** reparación del analista con la lista concreta
de fallos. Si persiste, se muestra la respuesta marcando las partes no
verificadas, nunca como si estuviera completa. No hay revisor IA adicional en
la primera versión; solo se añadiría si el banco de aceptación demuestra un
tipo de error que el código no puede detectar.

## 9. Memoria, presentación y trazas

- **Memoria del turno:** foco, obligaciones, IDs citados y versión del
  expediente. No se guardan categorías. El turno siguiente reconstruye el
  expediente actualizado con el mismo foco.
- **Respuestas anteriores:** visibles como conversación, pero el analista solo
  puede citar el expediente; el código impide citarlas como evidencia.
- **Presentación:** el texto del analista, con cada cita enlazada al registro
  y la evidencia desplegable. Un solo formato para todas las consultas.
- **Traza por job:** estado y conteo de cada sección, IDs citados, resultados
  de verificación, reparación, modelo, tokens y duración por llamada.

## 10. Modelos

- **Enrutador:** modelo económico (inicialmente el actual `gpt-4.1-mini`).
- **Analista:** modelo más capaz, configurable por separado. Se elige
  **midiendo en el banco de aceptación** entre dos o tres candidatos
  disponibles en la cuenta de OpenAI, comparando exactitud, cobertura,
  latencia y coste. No se elige por suposición.
- El registro de consumo **no** obtiene por sí solo la tarifa de un modelo
  nuevo: si el modelo no tiene tarifa vigente en `ai_pricing_rates`, la
  llamada se realiza y después falla al registrar el consumo. Cada modelo
  nuevo requiere registrar antes su tarifa desde la administración de IA.
- **Presupuesto objetivo por turno:** 2-3 llamadas (hoy 5-7) y hasta ~25 s,
  priorizando la calidad (hoy 18-28 s). Se confirma con mediciones.

### 10.1 Implementación (fase 2)

| Elemento | Ubicación |
| --- | --- |
| Enrutador | [router.js](../apps/api/src/commercial-intelligence/dossier/router.js) |
| Analista | [analyst.js](../apps/api/src/commercial-intelligence/dossier/analyst.js) |
| Verificación por código | [verifier.js](../apps/api/src/commercial-intelligence/dossier/verifier.js) |
| Orquestación, citas, memoria y traza | [engine.js](../apps/api/src/commercial-intelligence/dossier/engine.js) |
| Integración en el turno del chat | `processCustomerAccountChatJob` en [service.js](../apps/api/src/commercial-intelligence/service.js) |
| Selector de oportunidad y evidencia citada | [MiAgentPage.jsx](../apps/web/src/MiAgentPage.jsx) |
| Pruebas | [customer-dossier-engine.test.js](../apps/api/test/customer-dossier-engine.test.js) y una prueba de navegador en [mi-agent-governance.spec.js](../apps/web/e2e/mi-agent-governance.spec.js) |

**Configuración** (variables de entorno de la API):

| Variable | Uso | Valor por defecto |
| --- | --- | --- |
| `CUSTOMER_DOSSIER_ENGINE_MODE` | `off`, `pilot` u `on` | `off` |
| `CUSTOMER_DOSSIER_ENGINE_PILOT_USER_IDS` | Usuarios del modo `pilot`, separados por comas | vacío |
| `OPENAI_ROUTER_MODEL` | Modelo del enrutador | `OPENAI_MODEL` |
| `OPENAI_ANALYST_MODEL` | Modelo del analista; obligatorio con el motor activo | vacío |
| `OPENAI_ANALYST_REASONING_EFFORT` | Esfuerzo de razonamiento opcional | vacío |

Con el motor desactivado, el chat funciona exactamente como antes. Cada
modelo usado necesita una tarifa vigente.

**Recorrido de un turno con el motor activo:**

1. Si hay una actividad pendiente de confirmar o un adjunto, el turno pasa
   al recorrido actual.
2. Se construye el expediente de cuenta. Si la lista de oportunidades no se
   leyó completa, el turno falla de forma explícita en lugar de suponer el
   foco. Una oportunidad seleccionada que no pertenece a la cuenta se rechaza.
3. El enrutador decide el modo, el foco y las obligaciones. Acciones,
   redacción de textos, contenido de documentos y temas fuera de alcance
   pasan al recorrido actual. Los identificadores de obligación los asigna
   el código; un enrutamiento inválido recibe un único reintento con los
   problemas concretos.
4. Se construyen hasta tres expedientes de oportunidad en una transacción
   de solo lectura.
5. El analista responde. La verificación por código revisa citas, valores,
   ausencias, cobertura y cantidad de puntos. Si falla, hay **una**
   reparación con los fallos concretos; si persisten, la respuesta se
   muestra marcada como no verificada por completo.
6. Ante un error 5xx o 429 del proveedor, el analista se reintenta una sola
   vez si quedan al menos 20 s.

**Errores.** Los errores propios del motor y los de saldo o permisos llegan
al usuario con su mensaje. Los fallos técnicos se muestran como «No pude
completar la consulta con los registros del CRM» y se registran en el log
del servidor con su detalle.

**Memoria y continuidad.** Cada turno guarda en `dossierMemory` el nivel y
las oportunidades en foco, las obligaciones y las evidencias citadas,
validadas contra las oportunidades visibles. Si el foco es una sola
oportunidad, también se actualiza la oportunidad del contexto para que las
acciones posteriores del recorrido actual usen la misma. La memoria de turno
del recorrido actual se descarta para no arrastrar categorías antiguas.

**Interfaz.** Con el motor activo para el usuario, el chat muestra el
selector «Oportunidad» con «Toda la cuenta» y las oportunidades visibles,
obtenidas con `GET /api/commercial-intelligence/account-chat/focus-options`.
El foco viaja en cada pregunta como `focusOpportunityId`. Cada respuesta
incluye la evidencia del CRM citada, desplegable, y un aviso propio cuando
parte de la respuesta no se pudo verificar.

**Trazas.** La traza de calidad incluye `dossierEngine`: decisión del
enrutador, secciones y tamaño de cada expediente, duración de cada llamada,
fallos de verificación y reintentos.

**Pendiente:** aplicar las reglas de gobierno del canal, usar las
calculadoras existentes como herramientas del analista, omitir la
preparación heredada cuando responde el motor nuevo y cubrir en el banco
permisos restringidos y fallos de lectura. La medición está en la sección
12.5.

## 11. Decisiones resueltas

Decididas por el usuario el 2026-10-23:

1. **Turnos mixtos** (consulta + acción en el mismo mensaje): en la primera
   versión se envían completos al recorrido actual de acciones.
2. **Modelo del analista:** se prioriza la calidad aunque cueste más. La
   latencia aceptable llega hasta ~25 s por respuesta. Entre los candidatos
   medidos se elige el de mayor exactitud y cobertura dentro de ese límite.
3. **Conocimiento documental y búsqueda pública:** disponibles solo como
   herramientas del analista cuando la pregunta lo requiera; no forman parte
   del expediente.

## 12. Banco de aceptación

Se construye **antes** que el nuevo recorrido y se usa para medir primero el
sistema actual.

### 12.1 Implementación (fase 0)

| Elemento | Ubicación |
| --- | --- |
| Banco: conversaciones, hechos y comprobaciones | [bank.json](../apps/api/src/customer-chat-acceptance/bank.json) |
| Validación del banco | [bank.js](../apps/api/src/customer-chat-acceptance/bank.js) |
| Verificación de hechos contra la base (solo lectura, tablas y campos en lista blanca) | [facts.js](../apps/api/src/customer-chat-acceptance/facts.js) |
| Ejecución de conversaciones con el chat real | [runner.js](../apps/api/src/customer-chat-acceptance/runner.js) |
| Evaluación con citas verificadas | [judge.js](../apps/api/src/customer-chat-acceptance/judge.js) |
| Reportes | [report.js](../apps/api/src/customer-chat-acceptance/report.js) |
| Comando | [runCustomerChatAcceptance.js](../apps/api/scripts/runCustomerChatAcceptance.js) |
| Pruebas | [customer-chat-acceptance.test.js](../apps/api/test/customer-chat-acceptance.test.js) |

**Contenido:** 5 conversaciones, 17 turnos y 51 hechos del CRM.

| Conversación | Qué mide |
| --- | --- |
| `SEALPATH-ORIGINAL` | Las cuatro preguntas reales de la sesión 61 |
| `SEALPATH-VARIANTS` | Las mismas necesidades con otra redacción |
| `DIESTRA-ACCOUNT` | Vista de cuenta, cambio de foco por nombre, respuestas sustituidas por versiones posteriores y ausencia real de registros |
| `RALOY-BIGIP` | Otra cuenta: oportunidad ganada, varias cotizaciones y versiones, ninguna actividad pendiente |
| `FOCUS-SEALPATH` | Oportunidad seleccionada sin nombrarla en el texto |

**Cómo se califica cada turno:**

- **Hechos obligatorios** con su evidencia en el CRM; los críticos deciden el
  resultado.
- **Afirmaciones prohibidas**, por ejemplo “la orden de compra fue recibida” o
  “Daniel autoriza la compra”.
- **Forma exigida**, por ejemplo exactamente tres puntos, cada uno con su
  confirmación.
- **Bloqueos:** error del chat o aclaración no permitida.

El evaluador es un modelo de IA, pero cada veredicto debe ir acompañado de
fragmentos literales de la respuesta, que el código comprueba. Un veredicto
positivo sin cita verificable queda como **no verificado** y no aprueba; una
afirmación prohibida sin cita verificable se reporta para revisión humana.

**Datos:** se usa la base actual, no una copia congelada. Antes de cada
corrida se comprueba que los 51 hechos siguen coincidiendo y la corrida se
detiene si hay diferencias. La copia congelada queda para la fase 1, cuando
el expediente pueda construirse desde datos de prueba.

**Pendiente de cubrir:** permisos restringidos, fallos de lectura y foco
seleccionado con otra oportunidad nombrada en el texto. Requieren preparación
controlada o el selector de la fase 2.

### 12.2 Ejecución

Desde `apps/api`:

```bash
# Solo verifica los hechos contra la base, sin IA
npm run test:customer-chat:bank -- --check-facts

# Ejecuta y evalúa (llamadas de IA con coste)
npm run test:customer-chat:bank -- --live --user <id> --judge-model gpt-6-astra

# Mide el motor nuevo con un analista concreto (activa el motor solo en este proceso)
npm run test:customer-chat:bank -- --live --user <id> --engine dossier --analyst-model gpt-6.1-sol --analyst-effort low --judge-model gpt-6-astra

# Vuelve a evaluar un reporte sin ejecutar el chat
npm run test:customer-chat:bank -- --regrade <reporte.json> --user <id> --judge-model gpt-6-astra
```

Los reportes, en JSON y Markdown, se guardan en `apps/api/acceptance-runs/`,
excluido de Git porque contienen datos del CRM. Cada corrida crea una
conversación de chat por caso en el historial del usuario indicado; no
modifica datos comerciales. El modelo evaluador requiere tarifa vigente: el
comando se detiene antes de llamar a la IA si no la tiene.

### 12.3 Línea base del sistema actual (2026-10-23)

Medición del chat tal como está en el commit `5d85a71`, después de descartar
COR-002 a COR-009. Chat con `gpt-4.1-mini`; evaluador `gpt-6-astra`; 51/51
hechos verificados antes de ejecutar.

| Métrica | Resultado |
| --- | --- |
| Turnos aprobados | **0/17** |
| Hechos críticos presentes | **7/42 (17 %)**: 8 parciales, 16 ausentes y **11 contradichos** |
| Afirmaciones prohibidas | 5 |
| Aclaraciones innecesarias | 7 turnos |
| Presentación degradada a texto técnico (`CUSTOMER_B10_UNSUPPORTED_NUMBER`) | 5 turnos |
| Veredictos sin cita verificable | 0 |
| Duración mediana / máxima | 19 s / 32 s |
| Llamadas de IA del chat | 90 (5,3 por turno) |
| Tokens de entrada del chat | 756 106 (~44 000 por turno) |
| Coste del chat / del evaluador | 0,24 USD / 0,55 USD |

**Patrones observados:**

1. **Ausencia falsa (11 hechos contradichos).** El chat afirma que no hay
   información cuando sí existe: el resumen inicial de Sealpath, las notas de
   las actividades, el proceso de aprobación y el decisor de Raloy.
2. **Aclaraciones innecesarias (7 turnos).** Pide elegir importe o fecha para
   priorizar, pide nombrar una oportunidad ya identificada o no concilia la
   interpretación al cambiar de foco.
3. **Respuestas técnicas (5 turnos).** La presentación se degrada y muestra
   filtros, zonas horarias y coberturas en lugar de la respuesta.
4. **Respuestas de etapas anteriores invisibles.** El proceso de aprobación de
   Sealpath, la necesidad y el competidor de la oportunidad de correo y el
   resultado de la prueba de concepto de Raloy nunca se recuperan.
5. **La oportunidad seleccionada no basta.** Con Sealpath fijada en la sesión,
   el siguiente paso documentado se busca en requisitos de etapa y no en las
   actividades.

Revisión humana de la calificación: los veredictos coinciden con la lectura
de las respuestas. Tres son exigentes (R3, F2 y A1 piden un detalle
adicional), pero no cambian el resultado. Los reportes completos están en
`apps/api/acceptance-runs/`.

### 12.4 Diseño original del banco

- **Conversaciones de varios turnos**, empezando por las cuatro preguntas de
  Sealpath (sesión 61) y variantes de redacción.
- **Casos adicionales:** pregunta sin foco; foco seleccionado y otra
  oportunidad nombrada en el texto; oportunidad sin respuestas de etapa;
  permisos restringidos; sección con fallo de lectura; seguimiento “con esa
  evidencia”; preguntas a nivel de cuenta.
- **Por cada pregunta:** hechos que deben aparecer (con su ID de evidencia),
  afirmaciones prohibidas y forma exigida.
- **Evaluación:** por código lo verificable y revisión humana para la calidad
  comercial.

### 12.5 Medición del motor nuevo (2026-10-24)

Mismo banco, mismos 51 hechos verificados y mismo evaluador (`gpt-6-astra`).
Enrutador `gpt-4.1-mini` en todas las corridas.

| Métrica | Línea base | `gpt-6.1-sol` | `gpt-6.1-sol` esfuerzo bajo | `gpt-5.6-sol` | `gpt-6-astra` |
| --- | --- | --- | --- | --- | --- |
| Turnos aprobados | 0/17 | **16/17** | 15/17 | 13/17 | 8/17 |
| Hechos críticos presentes | 7/42 | **41/42** | 40/42 | 37/42 | 22/25 evaluados |
| Afirmaciones prohibidas | 5 | **0** | 0 | 0 | 0 |
| Aclaraciones innecesarias o errores | 7 | **0** | 0 | 0 | 6 errores del proveedor |
| Duración mediana / máxima | 19 / 32 s | 25 / 51 s | **21 / 43 s** | 26 / 70 s | 37 / 113 s |
| Llamadas de IA por turno | 5,3 | 3 | 3 | 3 | — |
| Tokens de entrada por turno | ~44 000 | ~10 300 | ~10 800 | ~10 300 | — |
| Coste del chat por corrida | 0,24 USD | 0,48 USD | 0,47 USD | 1,04 USD | 1,47 USD (incompleta) |

**Decisión: `gpt-6.1-sol` como analista.** Es el de mejor calidad, el más
económico de los candidatos y el más rápido. `gpt-6-astra` se descartó por
falta de fiabilidad: hubo errores 504 incluso tras el reintento, conexiones
interrumpidas y tiempos agotados, además de ser el más lento. El esfuerzo de
razonamiento bajo reduce la mediana de 25 a 21 s y el máximo de 51 a 43 s,
con una calidad equivalente dentro de la variación entre corridas. Se
recomienda `OPENAI_ANALYST_MODEL=gpt-6.1-sol` y
`OPENAI_ANALYST_REASONING_EFFORT=low`.

**Revisión humana.** Leí las respuestas que antes fallaban. T3 entrega
exactamente tres verificaciones ordenadas, cada una con su confirmación
concreta. T4 distingue contacto, recomendador y autorizador sin atribuir
autoridad a Daniel. Ninguna respuesta da la orden de compra por recibida ni
la cotización por aceptada. En las 17 preguntas de `gpt-6.1-sol` la
verificación por código aprobó el primer análisis, sin reparaciones.

**Fallos restantes:**

- **R3** («¿Hay alguna actividad pendiente?»): tras añadir las actividades
  pendientes al expediente de cuenta, la respuesta es correcta («no hay
  actividades pendientes»). El banco la marca parcial porque exige mencionar
  además las dos actividades realizadas; ese criterio ya se había señalado
  como exigente en la fase 0. No se recalibró para no cambiar la meta
  después de ver los resultados.
- **V4**: no aclara que tampoco consta que Daniel sea quien recomienda.
- **Foco en seguimientos:** el enrutador económico tiende a cambiar a la
  vista de cuenta en preguntas de seguimiento sin nombre, pese a la regla de
  continuidad. Con la oportunidad seleccionada en la interfaz no ocurre.

**Latencia.** El analista ocupa la mayor parte del tiempo, entre 7 y 38 s
según la extensión de la respuesta; el enrutador ~2,5 s. La preparación
heredada que se ejecuta antes del motor (snapshot y una llamada de IA de
selección) añade 4-7 s y es la siguiente optimización.

Durante la medición se detectaron y corrigieron, con pruebas, tres fallos:
identificadores de obligación demasiado largos generados por el enrutador,
el aviso de saldo agotado oculto bajo un mensaje genérico y la falta de
reintento ante errores 504 del proveedor.

## 13. Fases

| Fase | Entregable | Criterio para avanzar |
| --- | --- | --- |
| 0. Banco | Banco de aceptación y medición del sistema actual | Línea base documentada (**completada**, sección 12.3) |
| 1. Expediente | Constructor con todas las secciones, estados y significados | Contiene el 100 % de los hechos obligatorios del banco; sin errores silenciosos (**completada**, sección 6.4) |
| 2. Enrutador, analista y verificación | Recorrido nuevo detrás de un interruptor, solo para consultas; selector de oportunidad | Supera la línea base sin errores factuales críticos; latencia y coste medidos (**completada**, secciones 10.1 y 12.5) |
| 3. Modo sombra | Ambos recorridos en paralelo; el vendedor ve el actual | Mejora sostenida en preguntas reales |
| 4. Retiro gradual | Sustituir las ramas de consulta por categoría | Banco y pruebas de acciones en verde |

## 14. Qué se conserva

Autenticación, permisos, alcance por cuenta, contratos y confirmaciones de
acciones, herramientas de lectura, calculadoras de ranking, comparación,
tendencias y escenarios, B12, persistencia, trazas y la evidencia visible en
la interfaz.
