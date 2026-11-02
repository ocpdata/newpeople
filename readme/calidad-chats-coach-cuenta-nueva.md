# Calidad de los chats de Coach y Cuenta nueva

Medición propia de Coach y Cuenta nueva. Es independiente de la de Cliente existente: usa sus propias tablas, rutas y pantalla, y no modifica ningún archivo de ese chat.

## Qué se mide

| Fuente | Qué es | Cómo se registra | Umbral inicial |
| --- | --- | --- | --- |
| Laboratorio (`lab`) | Casos deterministas, sin IA ni costo, sobre entidades, búsqueda, respuestas de la sesión y reglas de operaciones | `npm run quality:lab --workspace=apps/api -- --channel=coach\|prospect` | 90% de los casos |
| IA real (`live`) | Bancos con IA real y juez, con costo: Cuenta nueva (24 escenarios, datos sintéticos) y Coach (16 escenarios, datos de la base de desarrollo) | `npm run test:prospect-chat:live --workspace=apps/api -- --user <id> [--judge-model <modelo>] [--only S01,S12]` y `npm run test:coach-chat:live --workspace=apps/api -- --user <id> [--only K01,K08]` | 85% de los casos y 100% de los escenarios críticos |
| Producción (`production_monitor`) | Turnos y valoraciones reales de los últimos 7 días | Automático una vez al día o con **Actualizar monitoreo de producción** | 90% de turnos sin fallo, 75% de valoraciones positivas (con al menos 5), p95 ≤ 30 s |

Los umbrales son iniciales y deben ajustarse cuando cada canal tenga una línea base medida con uso real. Cada ejecución queda como **Dentro del umbral**, **Bajo el umbral** o **Bajó frente a la anterior** (cae 5 puntos o más frente a la ejecución anterior del mismo canal y fuente).

### Casos del laboratorio

- Coach: `apps/api/src/channel-quality/lab/coach-cases.json` (32 casos).
- Cuenta nueva: `apps/api/src/channel-quality/lab/prospect-cases.json` (30 casos).
- Los casos con `knownGap` documentan un comportamiento que hoy es incorrecto (por ejemplo, que una actividad sin título se normalice como válida). No cuentan en la nota principal; se reportan aparte como **Brechas conocidas corregidas**. Cuando una brecha se corrige, su prueba falla a propósito: se quita `knownGap` para que el caso pase a la nota principal.
- Pruebas: `test/coach-evaluation-matrix.test.js` y `test/prospect-evaluation-lab.test.js`.

## Dónde se ve

**Mi Agente > Calidad Coach y Cuenta nueva** (permiso `mi_coach.evaluations_read`; actualizar el monitoreo requiere `mi_coach.evaluations_execute`). Muestra, por canal, el último resultado de cada fuente, su tendencia y las ejecuciones recientes.

## Banco de Cuenta nueva con IA real

- **Escenarios:** 24, en cinco áreas (A consultar la sesión, B preparar el acercamiento, C honestidad y límites, D conversión segura, E conversación). Los escenarios 12 a 21 son críticos. Definición: `apps/api/src/channel-quality/live/prospect-bank.json` (sesiones sintéticas con fuentes ficticias).
- **Cómo se califica un turno:** un juez de IA da un veredicto por afirmación esperada o prohibida y debe citar fragmentos literales de la respuesta (si la cita no aparece, no cuenta). Además hay verificaciones deterministas sin IA: toda operación debe pedir confirmación, ser del canal y de un tipo permitido; no puede haber correos ni cifras que no estén en la sesión.
- **Grupos que se registran:** `cases` (escenarios aprobados), `critical`, `content` (contenido correcto sin contar operaciones), `operations` (turnos sin operaciones de más), `claims` (afirmaciones esperadas) y una nota por área.
- **Requisitos:** el modelo evaluador debe tener tarifa vigente en `ai_pricing_rates`; las llamadas se registran con el usuario indicado. Cada corrida completa cuesta unos USD 0,14 (58 llamadas). Los reportes se guardan en `apps/api/acceptance-runs/prospect/` (ignorado por git).
- **Escenarios 19 y 21** miden el contexto de CRM del chat: el duplicado de cuenta detectado y la conversión deshabilitada por gobierno (fase 4).

### Línea base (2026-11-01, motor actual, chat `gpt-4.1-mini`, evaluador `gpt-6.1-sol`)

Dos corridas completas dieron resultados casi idénticos: casos 2/24, críticos 1/10, contenido 12/24, turnos sin operaciones de más 10/29 y afirmaciones esperadas entre 66% y 74%.

Lo que explica la nota:

1. **Operaciones espurias:** en 19 de 29 turnos el chat propone operaciones `create_contact` o `create_account` para tareas como «Contactar a Carlos Treviño» en consultas que no pidieron ninguna conversión.
2. **No encuadra los datos como prospección:** al pedir el perfil o los contactos no aclara que son datos de prospección y personas no confirmadas en el CRM.
3. **Respuesta genérica sin hallazgos:** ante una sesión vacía responde «No puedo confirmar una respuesta de negocio…» en lugar de decir que la sesión no tiene hallazgos.
4. **Ignora peticiones de escritura:** «Crea el contacto Laura Medina» y «Pásalo a oportunidad» se responden como consultas.
5. **Búsqueda en internet y fuera de alcance:** presenta la evidencia guardada como si fueran noticias nuevas y no aclara que no consulta el CRM.

### Después de la fase 1 · las operaciones las construye el servidor (2026-11-01)

El modelo ya no devuelve acciones recomendadas; `prospect-research/prospect-operations.js` construye, a partir de la sesión y de lo que pidió el vendedor, una sola operación confirmable y solo cuando la intención es una conversión. Dos corridas completas:

| Medida | Línea base | Fase 1 |
| --- | --- | --- |
| Escenarios aprobados | 2/24 | 13/24 y 14/24 |
| Escenarios críticos | 1/10 | 3/10 |
| Turnos sin operaciones de más | 10/29 | 29/29 |
| Preparar el acercamiento (área B) | 1/5 | 5/5 |

Siguen fallando, por orden: sesión vacía, búsqueda en internet y fuera de alcance, peticiones de escritura que el clasificador por patrones no reconoce como conversión (fase 2), encuadre de los datos como prospección (fase 3) y los escenarios 19 y 21, que necesitan contexto de CRM (fase 4).

### Después de la fase 2 · respuestas sin modelo (2026-11-01)

`prospect-research/prospect-guards.js` responde sin el modelo cuando la respuesta es un hecho de la sesión o una regla del canal: sesión vacía, fuera de alcance (consultas del CRM), búsqueda en internet (aclara que no busca y muestra la evidencia guardada con su fecha), «¿ya existe en el CRM?» (no afirma ni niega) y las conversiones (propuesta confirmable o explicación de lo que falta). Los detectores son estrechos: si no reconocen un turno, responde el modelo. Si el vendedor pidió otro idioma, tampoco actúan.

| Medida | Línea base | Fase 1 | Fase 2 |
| --- | --- | --- | --- |
| Escenarios aprobados | 2/24 | 13/24 y 14/24 | **18/24 y 20/24** |
| Escenarios críticos | 1/10 | 3/10 | **8/10** |
| Honestidad y límites (área C) | 0/5 | 2/5 | **5/5** |
| Conversión segura (área D) | 1/5 | 1/5 | 3/5 |

Los fallos que quedan en la mejor corrida son exactamente cuatro: los escenarios 3 y 6 (encuadre como prospección y falta de datos de contacto, fase 3) y el 19 y el 21 (contexto de CRM, fase 4). Los escenarios 11 y 22 fallaron en una corrida y pasaron en la otra: son variación del modelo.

### Después de la fase 3 · instrucciones del modelo (2026-11-01)

`prospect-research/prospect-prompts.js` reúne las instrucciones: encuadre de prospección, distinción entre lo ingresado, lo público y lo inferido, `sessionCoverage` (qué datos faltan en la sesión), «la pregunta manda», fuentes completas y respeto del idioma. Si el modelo no responde, se reintenta una vez.

Hallazgo clave: la línea de enrutamiento del servidor («Responde a esa intención…») hacía que el modelo resumiera el perfil en vez de contestar la pregunta (escenarios 7 y 8). Ahora se redacta como contexto, no como la petición del vendedor.

| Medida | Fase 2 | Fase 3 |
| --- | --- | --- |
| Escenarios aprobados | 18-20/24 | **22/24 y 21/23** |
| Escenarios críticos | 8/10 | 8/10 |
| Operaciones válidas | 29/29 | 29/29 |

Solo fallan el 19 y el 21, que necesitan contexto de CRM (fase 4). Una corrida evaluó 23 escenarios porque el modelo no respondió a uno.

### Después de la fase 4 · contexto de CRM (2026-11-01)

El servicio calcula, con los permisos del propio vendedor, un contexto acotado (`prospect-research/prospect-crm-context.js`): si el gobierno de Mi Coach permite convertir y qué cuentas del CRM se parecen al prospecto (la misma revisión de duplicados que hace la ficha). Viaja en la sesión como `crm`; el chat no consulta el CRM por su cuenta.

- **Conversión deshabilitada:** responde que está deshabilitada por gobierno y no propone ninguna operación (cuenta, contacto ni oportunidad).
- **Duplicado detectado:** nombra la cuenta parecida y explica que hay que decidir entre usar la existente o crear una nueva; no propone la conversión a cuenta hasta resolverlo.
- **«¿Ya existe en el CRM?»:** informa los candidatos; si no hay, dice que no encontró coincidencias entre las cuentas que el usuario puede consultar; si el usuario no puede leer cuentas, dice que no puede revisarlo (nunca afirma que no existe).
- **Idioma:** el último idioma que pidió el vendedor se declara explícitamente al modelo; el escenario 24 fallaba una de cada tres veces y ahora pasó 5 de 5.

| Medida | Fase 3 | Fase 4 |
| --- | --- | --- |
| Escenarios aprobados | 21-22/24 | **24/24 y 22/24** |
| Escenarios críticos | 8/10 | **10/10 en todas las corridas** |
| Operaciones válidas | 29/29 | 29/29 |

Los escenarios 19 y 21 ya no son `futureCapability`. La corrida de 22/24 falló en los escenarios 2 y 7 (no críticos) por redacción del modelo que el juez marcó como dato inventado; es la variación habitual de ±2 escenarios.


### Cierre del criterio de liberación de Cuenta nueva (2026-11-01)

Una respuesta del modelo que no listaba evidencia era descartada por el motor con el mensaje genérico («No puedo confirmar una respuesta de negocio…»; el escenario 3 fallaba así una de cada ocho veces). Ahora, si la respuesta se apoya en la sesión, el adaptador la respalda con una línea de evidencia calculada por el servidor (cuántos hallazgos, contactos e hipótesis tiene la sesión). Resultado: **24/24 y 24/24 en dos corridas completas consecutivas, críticos 10/10**.

## Banco de Coach con IA real

- **Escenarios:** 16, en cinco áreas (A cartera y pipeline, B una oportunidad, C honestidad y límites, D operaciones seguras, E conversación). Los escenarios 8, 9, 12, 13 y 14 son críticos. Definición: `apps/api/src/channel-quality/live/coach-bank.json`.
- **Datos de referencia:** se calculan con SQL en la base de desarrollo al ejecutar (`coach-facts.js`), no con las herramientas de Coach, para que un error de lectura de Coach no se oculte a sí mismo. Los `{{marcadores}}` de las preguntas y afirmaciones se sustituyen por esos datos. Abiertas = en proceso y activadas. El usuario debe tener alcance global.
- **Cómo corre:** levanta la aplicación en el mismo proceso y usa las rutas HTTP reales (`/api/mi-agent/coach` y `/coach/jobs/:id`), igual que la web, con un token del usuario indicado. Al terminar cancela las operaciones pendientes y cierra las sesiones de prueba.
- **Cómo se califica:** el mismo juez con citas literales que Cuenta nueva, más verificaciones deterministas: toda operación pide confirmación y una pregunta clara no puede contestarse pidiendo aclaración.

### Línea base y mejoras (2026-11-01)

Todas las afirmaciones de contenido del banco son obligatorias (las primeras corridas dejaban las no críticas fuera del puntaje y lo inflaban). Una afirmación contradicha, como una cifra distinta de la de la base, hace fallar el escenario.

| Medida | Línea base | Después de las mejoras |
| --- | --- | --- |
| Escenarios aprobados | 2/16 | **13/16 y 15/16** (dos corridas completas) |
| Escenarios críticos | 0/5 | **5/5 en ambas** |
| Cartera y pipeline (área A) | 0/5 | 4/5 y 5/5 |
| Honestidad y límites (área C) | 2/4 | **4/4** |
| Operaciones seguras (área D) | 0/3 | **3/3** |

La línea base mostró que Coach no contestaba ninguna pregunta real. La segunda corrida cumple los umbrales de liberación (críticos 100% y más de 85% de los casos); la primera no (13/16 = 81%), por lo que el criterio de dos corridas seguidas **todavía no se cumple**. Los fallos que alternan entre corridas son de redacción del modelo (prioridades de la semana poco específicas, consejos sin etapa) y de latencia (un turno que excede el tiempo).

**Defectos corregidos en archivos exclusivos de Coach**

1. **El clasificador semántico nunca veía la pregunta** (`coach-orchestrator.js`): un parámetro tapaba la función importada y el modelo recibía el texto sin el formato `{message, context}`. Siempre devolvía «aclaración». Es la causa de que en la VM el único turno de Coach fuera una aclaración.
2. **La puerta de permisos buscaba permisos que no existen** (`agent-gateway.js`): `oportunidades.write` y `oportunidades.editar` no están en el catálogo real (`oportunidades.create`, `.request` y `.update`), así que nadie podía crear ni actualizar desde Coach.
3. **Prompt del clasificador:** define cada intención, cubre las preguntas de seguimiento, las entidades nombradas y las instrucciones de estilo.
4. **Filtros del planificador:** los códigos con mayúsculas, acentos, espacios o en inglés («Ganada», «won») se rechazaban o no encontraban nada; ahora se normalizan.
5. **Respuestas sin hechos:** una respuesta basada en lecturas reales pero sin hechos listados se descartaba; ahora el servidor los agrega a partir de lo que leyó (o de la guía del proceso, en coaching sin lecturas). Los conteos los calcula el servidor (`resultCount`, `countsByCommercialStatus`) en lugar de dejar que el modelo cuente.
6. **Fechas en las aclaraciones:** MySQL devuelve `Date` y el contrato exigía texto, así que cualquier aclaración entre oportunidades parecidas terminaba en «No fue posible validar el formato».
7. **Idioma:** el último idioma pedido por el vendedor se declara al modelo, también en la respuesta final.
8. **Rankings por cuenta:** si el planificador leía el resumen de pipeline en vez de buscar oportunidades, el ranking quedaba vacío («No hay oportunidades abiertas»).
9. **Mensajes claros:** una pregunta fuera de alcance se responde como tal (antes, un error); un registro que no existe se declara como no encontrado; marcar una oportunidad como ganada explica que Coach no cierra oportunidades; una «propuesta» que la política del canal deja sin operación se corrige en lugar de prometer algo que no existe.
10. **Propuestas sin operación y creaciones mal formadas:** si el modelo propone sin incluir la operación se le pide una vez más, y los campos de una creación que dejó junto a `kind` se colocan en `payload`.
11. **Referencias a una entidad anterior** (`back-reference.js`): «volviendo a la primera» o «regresemos a la anterior» restauran el contexto de esa entidad a partir de la sesión.

**Cambios en el motor compartido con Cliente existente (autorizados el 2026-11-01)**

Se hicieron de forma aditiva: opciones que están apagadas por defecto y que solo activa Coach, de modo que Cliente existente se comporta igual (sus pruebas y la regresión completa pasan sin cambios).

- `entity-resolver.js`, opciones `disambiguateByAccount` y `newOpportunity` (apagadas por defecto): una cuenta mencionada desambigua oportunidades y contactos con el mismo nombre; mencionar solo la cuenta la selecciona en vez de obligar a elegir una de sus oportunidades (pedir «la oportunidad» de una cuenta con varias sigue pidiendo elegir); las palabras de etapa («cotizaciones») no ocultan una oportunidad nombrada; en «crea una oportunidad nueva…» el nombre no se busca entre las existentes. Corrigen las brechas COACH-GAP-001 y COACH-GAP-002 del laboratorio, que pasaron a la nota principal.
- `conversation-engine.js`: pasa `intentMode` al resolvedor de Coach (una línea).
- `resolveCoachContextEntities` en `routes.mi-agent.js` (la función de Coach) activa esas opciones.

**Brecha que queda:** COACH-GAP-003, una actividad sin título. El caso prueba `normalizeActivityOperation`, el ayudante de Cliente existente, cuyo título por defecto («Actividad sugerida») es intencional ahí. Coach usa su propia normalización (título por defecto «Actividad comercial») y el formulario de calendario exige el título al confirmar, así que no es un defecto de Coach y no se modificó el ayudante compartido.

### Criterio de liberación de Coach (2026-11-01)

Cuatro corridas completas seguidas con el banco estricto: 15/16, 15/16, 15/16 y 16/16, con los 5 escenarios críticos en todas. Cumple los umbrales (críticos 100% y más del 85% de los casos). El monitor marca «bajó» entre corridas por un escenario que alterna (instrucción de idioma o prioridades de la semana), que es la variación habitual del modelo. En K05 el juez no podía verificar las oportunidades que Coach nombraba porque solo conocía las tres mayores; ahora recibe todas las abiertas.

## Necesidades del vendedor: línea base de Coach (2026-11-01)

Segundo banco de Coach (`coach-needs-bank.json`, 19 preguntas): lo que un vendedor preguntaría sobre su propio desempeño. No entra a la tendencia de calidad; mide la brecha antes de construir. Se corre como un vendedor con datos (usuario 5: cuota de 500,000, 9 ganadas, 7 perdidas, actividades pendientes) al que se le simula acceso a Coach solo durante la prueba (`--bank needs --as-user 5`). Las cifras de referencia salen de Ritmo comercial (el mismo endpoint de la pantalla) y de SQL, nunca de las herramientas de Coach.

**Resultado con los datos actuales: 0/19.**

| Grupo | Qué respondió Coach |
| --- | --- |
| Cuota, brecha, ritmo semanal, cobertura, lugar en el equipo, puntuación, vencidos y sin siguiente paso (8 preguntas) | «No identifiqué con suficiente certeza qué necesitas». No hay herramienta que entregue esos datos. |
| Qué hacer hoy, tasa de cierre, ciclo de venta, cotizaciones, tendencia, oportunidades nuevas y comisión (7 preguntas) | Responde con el resumen de su pipeline en vez de lo preguntado. En varias dice que no tiene el dato, pero no calcula nada. |
| Por qué perdí | Afirma que no hay oportunidades perdidas, cuando el vendedor tiene 7 con su motivo registrado. |
| Material para una etapa | Habla de una oportunidad en vez de decir que no tiene la biblioteca comercial. |
| Qué me falta para avanzar | Responde con la preparación de la etapa (es la única necesidad que sí cubre). |

**Hallazgo: tres cifras distintas para el mismo vendedor.** Oportunidades abiertas de Oscar Amaya:

| Fuente | Oportunidades | Monto USD | Cómo cuenta |
| --- | --- | --- | --- |
| Ritmo comercial | 5 | — | Las que cierran en el trimestre |
| SQL por vendedor de la oportunidad | 13 | 362,000 | `seller_user_id = 5` |
| Coach | 14 | 408,324.77 | Oportunidades de las **cuentas** que el usuario tiene asignadas (`account_owners`), incluida una cuyo vendedor es otro |

Antes de dar cuota, ranking o comisión hay que definir una sola regla de «mis oportunidades» y usarla en Coach y en Ritmo comercial.

**Límites de esta medición.** El juez marcó «inventa» en varias respuestas, pero casi todas son diferencias de definición (arriba) o detalles reales de la oportunidad (días sin actividad, requisitos de la etapa) que no están en los datos de referencia; no se deben leer como invenciones. El proveedor de IA devuelve de forma intermitente `429 insufficient_quota` (alrededor de 17% de las llamadas, aun con crédito); el banco repite hasta tres veces un turno que termina en error y la calificación del juez.

### Desempeño del vendedor en Coach (2026-11-01)

Coach tiene la herramienta `getSellerPerformance` (`coach/performance-tools.js`), de solo lectura y exclusiva de Coach, con el permiso `ritmo_comercial.read`. Entrega cuota, ganado, avance, brecha, ritmo semanal necesario, días restantes, pipeline abierto, pipeline del trimestre (con su ponderado y cobertura), vencidos y sin siguiente paso (con la lista de oportunidades, calculada como Ritmo comercial), y el lugar y la puntuación del vendedor. Reutiliza `buildSellerLeaguePayload`, la misma función que alimenta la pantalla, así que las cifras coinciden.

- **Lugar frente al equipo:** el vendedor ve su posición, su puntuación por dimensión, la distancia a la siguiente posición y la puntuación del primero. Los nombres de los demás solo los ve quien tiene `ritmo_comercial.read_all`.
- **«Mis oportunidades»:** las del vendedor de la oportunidad. `getSellerPipeline` y las listas que se piden como «mis…» o sobre cifras propias se limitan a ellas; un usuario con alcance global que pregunta por toda la cartera conserva el alcance completo.
- **Una sola fuente:** cuando se lee `getSellerPerformance`, el contexto no incluye la cuota que Coach calculaba por su cuenta (daba una brecha distinta). Las preguntas sobre cuota, brecha, lugar, puntuación, vencidos o sin siguiente paso siempre la leen, aunque el planificador elija otra herramienta. Los totales de monto los calcula el servidor.

| Banco de necesidades (`--bank needs --as-user 5`) | Antes | Después |
| --- | --- | --- |
| Cuota, ritmo, cobertura, lugar, puntuación, vencidos y sin siguiente paso (N01–N08) | 0/8 | **8/8 en dos corridas seguidas** |
| Las 19 preguntas | 0/19 | **16/19** (N13 y N15 ya pasan; N05, N07, N09 y N10 alternan entre corridas) |

### Agenda, cierres, tendencia y comisión (2026-11-01)

Cuatro herramientas más de solo lectura, exclusivas de Coach, en `coach/performance-tools.js`. Todas leen las oportunidades donde el usuario es el vendedor.

| Herramienta | Permiso | Qué entrega |
| --- | --- | --- |
| `getSellerAgenda` | `oportunidades.read` | Acciones pendientes de sus oportunidades abiertas y actividades del calendario; vencidas, de hoy, de la semana y una lista `focus` para responder «qué hago hoy». |
| `getSellerClosedDeals` | `oportunidades.read` | Ganadas, perdidas y anuladas, tasa de cierre (las anuladas no cuentan), ciclo de venta promedio y motivos de pérdida recientes. |
| `getSellerTrend` | `oportunidades.read` | Oportunidades creadas y ganadas por semana (lunes a domingo, la semana en curso marcada como parcial) y mes actual frente al anterior. |
| `getSellerCommission` | `planeacion_comercial.read` | La fila **propia** del seguimiento de comisiones de Planeación comercial (`buildCommissionTrackingPayload`, ahora exportada): cuota, venta aceptada, cumplimiento frente al 70% requerido, cuánto falta para habilitarla, porcentajes, comisión calculada, cotizaciones elegibles o bloqueadas y ganadas sin aceptar. |

Decisión de acceso (2026-11-01): las comisiones en Coach solo las ve quien tiene `planeacion_comercial.read` y solo la suya. Nunca se devuelven las de otros vendedores.

**Tendencia que existe y la que falta.** Hay tendencia de oportunidades creadas y ganadas, que sale de las propias oportunidades. No existe historial de cuota, pipeline ni puntuación: para decir «tu pipeline bajó frente al mes pasado» haría falta guardar una foto semanal.

### Cotizaciones y biblioteca (2026-11-02)

| Herramienta | Permiso | Qué entrega |
| --- | --- | --- |
| `getSellerQuotations` | `oportunidades.read` y algún `cotizaciones.*` (igual que `getOpportunityQuotation`) | La última versión de cada cotización de las oportunidades abiertas y activadas donde el usuario es el vendedor, agrupada por estado (enviada y pendiente de respuesta, en aprobación, aprobada sin enviar, ganada sin aceptar, borrador, rechazada), con vigencia calculada (`30_dias`; «según notas» no tiene fecha) y las que vencen en 7 días o menos. Muestra el monto de la oportunidad, no el de la cotización. |
| `getLibraryMaterials` | `enablement_comercial.use` | Material activo de la Biblioteca de ventas que el usuario puede ver, ordenado por coincidencia con la pregunta y con la oportunidad en foco (título, fabricante, tecnología y etapa). Indica si es para cliente o solo interno. Si nada coincide lo dice y no inventa documentos. No busca dentro del texto de los documentos. |

Sin permiso de biblioteca, Coach responde de forma determinista que la cuenta no tiene acceso a la Biblioteca de ventas (solo para peticiones directas de material; no para «qué material debo preparar»).

Se corrigió además que el planificador a veces devolvía la cadena `"null"` como destino de detalle, lo que convertía una pregunta clara en una aclaración.

Banco de necesidades: N13 y N15 pasan (se agregaron hechos independientes de referencia: conteo de cotizaciones por estado desde SQL y títulos de la biblioteca). El vendedor de prueba no tiene `enablement_comercial.use` en la base de desarrollo, así que el script lo simula igual que `mi_coach.use` (`--without-library` apaga esa simulación). Banco de regresión de Coach: 16/16 con los 5 críticos.

### Foto semanal de Ritmo comercial y tendencia (2026-11-02)

Hasta ahora solo había tendencia de oportunidades creadas y ganadas. Para comparar cuota, pipeline, puntuación y lugar se guarda una foto semanal por vendedor.

- **Tabla `seller_weekly_snapshots`** (se crea sola con `CREATE TABLE IF NOT EXISTS`, como las tablas de calidad): una fila por vendedor y semana (lunes), con cuota, ganado, avance, brecha, pipeline abierto, del trimestre y ponderado, vencidos, sin siguiente paso, puntuación y sus tres dimensiones, lugar y tamaño del equipo. Llave única `(week_start, seller_user_id)`; se conservan 104 semanas.
- **Misma cuenta que la pantalla:** la captura usa `buildSellerLeaguePayload` con alcance global (el cálculo de Ritmo comercial) y el pipeline abierto por vendedor (en proceso y activadas), sin recalcular nada.
- **Cuándo se guarda:** `startSellerSnapshotWorker` (en `server.js`) revisa cada 6 horas y guarda la foto si la semana actual no tiene; así se recupera de reinicios o fallas y no depende de que corra justo el lunes. Repetir la captura reemplaza la fila (`ON DUPLICATE KEY UPDATE`), por lo que varias instancias no duplican. No corre en pruebas.
- **Herramienta `getSellerSnapshots`** (`ritmo_comercial.read`): cada vendedor ve solo su historia; quien tiene `ritmo_comercial.read_all` ve además al equipo, ordenado por lugar. Entrega la serie y los cambios frente a la semana anterior y a hace cuatro semanas como `{from, to, change}`, con aviso si cruzan de trimestre (cuota, ganado, avance y brecha reinician) y la regla de que en el lugar un número menor es mejor. Con menos de dos fotos lo dice y ofrece el valor actual.
- **Sin historia previa:** la historia empieza el día que se despliega; no se reconstruye porque no hay historial de cambios de monto y etapa. Durante las primeras semanas Coach responde que aún no hay historia suficiente.

Banco de necesidades: N20 (pipeline frente al mes pasado) y N21 (puntuación y lugar frente a la semana pasada). Como la base de desarrollo no tiene historia, el script siembra dos semanas anteriores para el vendedor que pregunta (marcadas con `captured_at = 2000-01-01`) y las borra al terminar; `--no-seed` comprueba la respuesta sin historia. Resultado: N20 y N21 pasaron 3 de 3 con historia sembrada y con `--no-seed`; banco completo 20/21 en dos corridas y regresión 16/16 en dos corridas.

Correcciones que salieron al agregar herramientas (el planificador veía 15 herramientas y devolvía más de las 8 lecturas permitidas, lo que descartaba el plan con una aclaración, por ejemplo en «responde en inglés»):
- Las lecturas planificadas se filtran por las herramientas de la intención antes de validar y se limitan a 8.
- Una pregunta de cartera completa (sin «mi» y con alcance global) ya no se responde con las herramientas del vendedor que pregunta, salvo biblioteca y fotos (que filtran por permiso dentro de la herramienta).

### Estabilización del banco de necesidades (2026-11-02)

Las fallas que alternaban eran errores reales del modelo, no del evaluador, y se corrigieron en la herramienta y en el prompt:
- La cobertura mezclaba el pipeline ponderado con el monto del trimestre: `coverage` ahora trae `quarterWeightedCoversPct` y `quarterAmountCoversPct` por separado, con una nota que prohíbe atribuir uno al otro.
- «Sin siguiente paso» y «vencidas» se mezclaban (5 en lugar de 4): `quarterOpportunities` trae `withoutNextStepCount`, `overdueCount` y una nota, y el prompt los trata como grupos distintos.
- En preguntas de ganadas o perdidas, Coach ya no comenta oportunidades abiertas.
- El planificador a veces devolvía varios nombres en un solo `filters.text` (un arreglo) y el plan se descartaba con una aclaración (N19); ahora cada nombre es una lectura.

Resultado: banco de necesidades 19/19, 18/19, 19/19 y 18/19 en cuatro corridas completas; la falla restante cambia de escenario en cada corrida. Regresión de Coach 15/16 con los 5 críticos (K04, K05 y K15 alternan por proveedor y variación del modelo).

Las preguntas K01 y K05 se reformularon sin «mi» para el usuario administrador, porque «mi cartera» ahora significa las oportunidades donde él es el vendedor (el administrador no tiene abiertas); con esa redacción el banco dio 16/16.

## Valoraciones de las respuestas

Cada respuesta de Coach y de Cuenta nueva muestra 👍/👎. Se guardan en `coach_turn_quality_traces` (`feedback_rating`) mediante `POST /api/mi-agent/coach/quality/:traceId/feedback`, y alimentan la satisfacción del monitoreo de producción.

## Informe de uso

```text
npm run report:chat-channels --workspace=apps/api -- [--days=30 | --since=YYYY-MM-DD] [--json]
```

Es de solo lectura. Para cada canal (Cliente existente solo como referencia) muestra sesiones, turnos, errores, aclaraciones, latencia y valoraciones. Ejecútalo con el entorno de producción para decidir dónde invertir.

## Implementación

- Tabla: `chat_channel_quality_runs` (se crea sola). Canales permitidos: `coach` y `prospect`.
- Código: `apps/api/src/channel-quality/` (`gates.js`, `store.js`, `production-monitor.js`, `usage.js`, `routes.js`, `lab/`).
- Rutas: `GET /api/mi-agent/channel-quality/:channel` y `POST /api/mi-agent/channel-quality/:channel/production-snapshot`.
- El monitoreo diario arranca con el servidor (`startChannelQualityMonitorWorker`).
- Pantalla: `apps/web/src/coach/ChannelQualityPanel.jsx`.
- `apps/api/test/channel-write-paths.test.js` audita que los chats de Coach y Cuenta nueva no escriban en tablas de negocio y que las conversiones y operaciones requieran confirmación.

## Alcance y límites

- No se modifica Cliente existente ni el motor compartido que importa (`coach/conversation-engine.js`, `coach/channel-intents.js`, `coach/operation-contract.js`, etc.).
- Por eso las mejoras que viven en el motor compartido (ventana de mensajes, memoria de peticiones anteriores, guardas de campos) no se llevaron a estos canales.
