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
- Los casos con `knownGap` documentan un comportamiento que hoy es incorrecto (por ejemplo, que mencionar la cuenta no desambigüe dos oportunidades con el mismo nombre). No cuentan en la nota principal; se reportan aparte como **Brechas conocidas corregidas**. Cuando una brecha se corrige, su prueba falla a propósito: se quita `knownGap` para que el caso pase a la nota principal.
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

| Medida | Línea base | Después de las mejoras |
| --- | --- | --- |
| Escenarios aprobados | 2/16 | **11/16 a 12/16** (últimas tres corridas) |
| Escenarios críticos | 0/5 | 2/5 a 3/5 |
| Cartera y pipeline (área A) | 0/5 | **5/5** |
| Una oportunidad (área B) | 0/2 | **2/2** |

La línea base mostró que Coach no contestaba ninguna pregunta real. Defectos corregidos, todos en archivos exclusivos de Coach:

1. **El clasificador semántico nunca veía la pregunta** (`coach-orchestrator.js`): un parámetro tapaba la función importada y el modelo recibía el texto sin el formato `{message, context}`. Siempre devolvía «aclaración». Es la causa de que en la VM el único turno de Coach fuera una aclaración.
2. **La puerta de permisos buscaba permisos que no existen** (`agent-gateway.js`): `oportunidades.write` y `oportunidades.editar` no están en el catálogo real (`oportunidades.create`, `.request` y `.update`), así que nadie podía crear ni actualizar desde Coach.
3. **Prompt del clasificador:** ahora define cada intención (consejo, pipeline, dato puntual, creación, actualización), cubre las preguntas de seguimiento y no toma un consejo por una creación.
4. **Filtros del planificador:** los códigos con mayúsculas, acentos o espacios («Ganada», «En proceso») se rechazaban; ahora se normalizan.
5. **Respuestas sin hechos:** igual que en Cuenta nueva, una respuesta basada en lecturas reales pero sin hechos listados se descartaba; ahora el servidor los agrega a partir de lo que leyó (o de la guía del proceso, en coaching sin lecturas).
6. **Fechas en las aclaraciones:** MySQL devuelve `Date` y el contrato exigía texto, así que cualquier aclaración entre oportunidades parecidas terminaba en «No fue posible validar el formato».
7. **Idioma:** el último idioma pedido por el vendedor se declara al modelo.

### Brechas que quedan (requieren tocar el motor compartido con Cliente existente)

- **Escenario 9, historial exhaustivo:** debe derivar a Cliente existente, pero responde «selecciona account en el contexto del Coach».
- **Escenario 13, marcar como ganada:** no cambia nada (correcto), pero responde con el mensaje genérico «La evidencia autorizada no cubre la solicitud» en lugar de explicar que no se hace desde el chat.
- **Escenario 14, crear una oportunidad para una cuenta:** el resolvedor de entidades toma el nombre de la cuenta como oportunidad y pide elegir entre «varias coincidencias».
- **Escenario 15, volver a una entidad anterior:** «volviendo a la primera» no recupera la oportunidad de hace dos turnos.

Los criterios de liberación de Coach siguen sin cumplirse (críticos 100% y 85% de los casos). Los resultados varían entre corridas por el modelo; las cifras de arriba son de las últimas tres corridas completas.

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
