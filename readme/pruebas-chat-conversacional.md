# Pruebas del chat conversacional

Guía manual integral para comprobar los tres chats: Coach, Cliente existente y Cuenta nueva. Valida interpretación, contexto, fuentes, permisos, evidencia, operaciones, persistencia y límites por canal. No se exige una redacción literal; sí que la intención, los datos y el resultado sean correctos y estén respaldados.

## Preparación común

- Ejecuta las pruebas en un entorno de prueba autorizado. No confirmes escrituras sobre datos compartidos o producción.
- Usa un usuario de prueba con los permisos previstos para cada caso. Repite los casos negativos con un usuario al que le falte el permiso que se está comprobando.
- Anota el canal, usuario, sesión y `jobId` de cada turno. En conversaciones asíncronas, comprueba el estado final y no confundas `pending`/`running` con una respuesta completa.
- Comprueba los datos esperados desde la ficha CRM o de investigación autorizada, no desde una respuesta previa del chat. Los nombres/valores de los datos de prueba pueden variar por entorno.
- No escribas IDs CRM en el chat. Las entidades se deben resolver desde nombres, contexto seleccionado o referencias conversacionales validadas.
- Si usas investigación pública, verifica que el entorno permite llamadas externas y considera sus límites, tiempo de espera y consumo de proveedor.

## 1. Coach

### Preparación

Abre **Mi Agent > Coach** con un usuario de prueba. Empieza una conversación general, sin entidad seleccionada; prepara también una cuenta y dos oportunidades accesibles, una oportunidad con información suficiente para evaluar su etapa y un registro al que el usuario de prueba no tenga acceso. Consulta antes sus valores reales, estado, actividades y respuestas de etapa en el CRM. Para las pruebas de escritura, usa borradores que puedas cancelar sin modificar datos compartidos.

### Casos

#### 1. Orientación basada en la guía comercial

**Vendedor:** ¿Qué exige la etapa de Cotización antes de avanzar?

**Esperado:** explica los criterios de la guía autorizada del proceso comercial, distingue requisitos de recomendaciones y no exige elegir una cuenta si la pregunta es general. No inventa una oportunidad ni presenta la guía como evidencia de datos CRM.

#### 2. Coaching general con datos de cartera

**Vendedor:** ¿Qué oportunidades abiertas debería priorizar y por qué?

**Esperado:** usa solo oportunidades abiertas/activadas visibles para el usuario, explica las señales y lecturas que respaldan cada prioridad y presenta las recomendaciones como recomendaciones, no como hechos. No cuenta oportunidades ganadas, perdidas, anuladas o desactivadas como pipeline abierto. Si las lecturas fallan o están truncadas, no afirma que la cartera no tenga riesgos.

#### 3. Contexto breve y continuidad de entidad

Inicia el turno con una oportunidad inequívoca:

**Vendedor:** ¿En qué etapa está la oportunidad `<nombre>`?

**Esperado:** responde la etapa CRM de esa oportunidad y muestra respaldo suficiente.

**Vendedor:** ¿Qué me falta para avanzar?

**Esperado:** conserva la misma oportunidad, consulta sus criterios/readiness y separa avances confirmados, pendientes, riesgos y siguiente paso. No cambia a otro registro ni mueve la etapa automáticamente.

**Vendedor:** ¿Y el monto de `<otra oportunidad>`?

**Esperado:** el nombre explícito cambia el foco; responde con el monto de la segunda oportunidad y no reutiliza datos de la primera.

#### 4. Límite entre contexto breve y exploración detallada

**Vendedor:** Dame el detalle completo y todo el historial de `<cuenta u oportunidad>`.

**Esperado:** Coach no abre lecturas de historial exhaustivo. Si el destino está autorizado, deriva a Cliente existente o al módulo correspondiente con el registro validado; al abrirse, ese destino vuelve a validar el acceso. Si no hay contexto inequívoco o falta permiso, pide aclaración o informa la limitación; no revela el detalle desde Coach.

#### 5. Aclaración ante referencia ambigua

Inicia una conversación nueva, sin entidad activa:

**Vendedor:** ¿Cuál es el monto de la oportunidad?

**Esperado:** si hay varias candidatas o ninguna referencia única, pregunta cuál. No selecciona la primera coincidencia ni hereda un foco de una sesión distinta.

**Vendedor:** `<nombre inequívoco>`.

**Esperado:** resuelve la aclaración y responde sobre ese registro sin pedir de nuevo el nombre.

#### 6. Hecho sin respaldo suficiente

Pregunta por un dato que no esté en las lecturas permitidas o por una relación que el CRM no confirme.

**Esperado:** identifica qué no pudo verificar, pide precisión o indica que la fuente no lo confirma. No convierte una lectura vacía, fallida, omitida o truncada en ausencia global ni inventa relaciones entre cuenta, oportunidad y contacto.

#### 7. Propuesta de actividad y confirmación

**Vendedor:** Agenda una llamada con `<contacto>` sobre `<oportunidad>` para `<fecha y hora>` con el objetivo `<objetivo>`.

**Esperado:** valida que la cuenta, oportunidad y contacto sean compatibles; si falta un campo obligatorio o hay ambigüedad, lo pregunta. Presenta una propuesta editable y deriva a Calendario; abrir el formulario no crea la actividad.

Cancela el formulario y verifica que no haya actividad nueva. Repite en un entorno de prueba, revisa/corrige los campos y confirma explícitamente el guardado; solo entonces debe existir la actividad.

#### 8. Propuesta de actualización de CRM

**Vendedor:** Actualiza el monto de `<oportunidad inequívoca>` a `<nuevo monto>`.

**Esperado:** muestra entidad, valor actual, nuevo valor y evidencia; dirige al flujo/formulario oficial. No escribe desde el chat ni asegura que el cambio ya ocurrió. Cancela y comprueba que el monto permanezca igual. Si el destino es plural o cambió el valor desde la lectura, solicita selección o revisión; no actualiza un registro arbitrario.

#### 9. Permisos y aislamiento entre chats

Con un usuario sin permiso de lectura para una entidad, solicita su detalle y luego intenta abrir una derivación a otro módulo.

**Esperado:** no consulta ni revela el registro; la ruta de destino vuelve a validar permiso. Cambia a Cliente existente y Cuenta nueva, regresa a Coach y comprueba que sus historiales/contextos no se mezclen. El contexto general o activo se conserva solo dentro de la sesión de Coach correspondiente.

## 2. Cliente existente

### Preparación

Selecciona **Totalplay** en Cliente existente. En la instancia local revisada, la cuenta tiene ID `22` y la oportunidad `Vrf 2027` ID `94`; usa los nombres en el chat, no escribas IDs. El monto observado de Vrf 2027 es USD 2,000,000, la etapa es Contacto Inicial y está abierta/en proceso. Puede haber más oportunidades abiertas en Totalplay; los nombres e IDs pueden variar entre entornos.

Para las comprobaciones de contacto, actividad y cotización, usa solo los datos que el chat confirme con evidencia actual de Totalplay. Si el CRM no muestra un contacto, actividad o cotización asociados a Vrf 2027, el resultado correcto es indicarlo como no disponible/no encontrado; no inventes nombres ni relaciones. Haz las pruebas en un entorno autorizado y no confirmes escrituras sobre datos compartidos.

### Conversaciones

#### 1. Referencia explícita y seguimiento

**Vendedor:** ¿Cuál es el monto de Vrf 2027?

**Esperado:** USD 2,000,000 según el CRM. La oportunidad objetivo es Vrf 2027.

**Vendedor:** ¿Y en qué etapa está?

**Esperado:** Contacto Inicial, para la misma oportunidad. No debe pedir nuevamente el nombre ni cambiar a otra oportunidad.

**Vendedor:** ¿Qué actividad pendiente tiene?

**Esperado:** Consulta las actividades de Vrf 2027. Si la lectura autorizada devuelve cero actividades, lo dice claramente; no usa actividades de otra oportunidad o cuenta.

#### 2. Cambio explícito de entidad

Después de consultar Vrf 2027:

**Vendedor:** ¿Cuál es el monto de Seguridad de las APIs?

**Esperado:** Si Seguridad de las APIs sigue visible en Totalplay, responde con su monto CRM. La mención explícita cambia el foco desde Vrf 2027; no debe reutilizar USD 2,000,000.

**Vendedor:** ¿Y su etapa?

**Esperado:** La etapa de Seguridad de las APIs, no la de Vrf 2027. Si el CRM no devuelve esa oportunidad, pide aclarar o informa que no pudo encontrarla.

#### 3. Colección frente a selección singular

Con Vrf 2027 como foco previo:

**Vendedor:** ¿Cuáles son las oportunidades abiertas?

**Esperado:** Devuelve las oportunidades abiertas de Totalplay que encuentre, incluida Vrf 2027 si sigue abierta. No responde solo con Vrf 2027 por el foco anterior ni incluye oportunidades históricas como abiertas.

**Vendedor:** Compara sus montos.

**Esperado:** Compara los montos de las oportunidades devueltas, identificando cada nombre y valor. No convierte una petición plural en una selección singular.

#### 4. Cambio de oportunidad a contacto

Después de consultar Vrf 2027:

**Vendedor:** ¿Qué contacto está asociado a Vrf 2027?

**Esperado:** Rene Negrete, Gerente de Operaciones, porque `Vrf 2027.contact_id` lo vincula directamente con la oportunidad. No basta con que un contacto pertenezca a Totalplay; si no se puede verificar la relación directa, no debe inventarla.

**Vendedor:** ¿Qué puesto tiene?

**Esperado:** Si se resolvió un único contacto en el turno anterior, responde con su puesto CRM; de lo contrario pide identificar el contacto. No vuelve a Vrf 2027 por defecto.

#### 5. Cotización y seguimiento de la cotización

**Vendedor:** ¿Qué cotizaciones hay para Vrf 2027 y qué incluyen?

**Esperado:** Consulta las cotizaciones autorizadas relacionadas con Vrf 2027. Si existen, resume solo su contenido comercial permitido; si no, indica que la consulta no encontró cotizaciones. No expone costos internos, márgenes ni notas internas.

**Vendedor:** ¿Y cuántas secciones tiene?

**Esperado:** Si se encontró una cotización única, responde el número de secciones de esa cotización. Si hay varias, pregunta cuál; no cambia al historial de contacto ni a otra oportunidad.

#### 6. Aclaración por ambigüedad real

Inicia una conversación nueva, sin oportunidad seleccionada:

**Vendedor:** ¿Cuál es el monto de la oportunidad?

**Esperado:** Pide identificar la oportunidad porque hay más de una candidata plausible. No elige la primera ni prepara una operación.

**Vendedor:** Vrf 2027.

**Esperado:** Resuelve la aclaración con la entidad indicada y responde USD 2,000,000. No vuelve a pedir que repita el nombre.

#### 7. Propuesta de escritura singular

Con Vrf 2027 como referencia inequívoca:

**Vendedor:** Actualiza el monto de Vrf 2027 a 1000000.

**Esperado:** Presenta una propuesta de USD 2,000,000 a USD 1,000,000 y ofrece revisarla/confirmarla. No afirma que el CRM ya cambió ni escribe antes de la confirmación.

En la prueba manual, abre la revisión y cancélala; comprueba que el monto de Vrf 2027 siga en USD 2,000,000.

#### 8. Escritura con objetivo plural

**Vendedor:** Actualiza el monto de las oportunidades abiertas de Totalplay a 1000000.

**Esperado:** Pide elegir una oportunidad o explica que la operación requiere un destino singular. No aplica el cambio a una oportunidad arbitraria ni genera una operación ejecutable para varias.

#### 9. Límite de cuenta

Con Totalplay seleccionada:

**Vendedor:** Busca la oportunidad de Grupo Nébula y dime su monto.

**Esperado:** No consulta ni revela datos de Grupo Nébula. Indica que Cliente existente está limitado a Totalplay; mencionar otra cuenta no amplía el alcance.

#### 10. Investigación pública junto con evidencia CRM

Si el canal ofrece la opción de investigación pública, habilítala y pregunta por una iniciativa reciente de Totalplay relacionada con una oportunidad seleccionada.

**Esperado:** separa datos CRM de hallazgos públicos, muestra la fuente pública cuando se use y no presenta un hallazgo como un campo confirmado del CRM. Si investigación pública está deshabilitada o falla, informa esa limitación sin tratar el fallo como evidencia de ausencia.

#### 11. Continuidad, sondeo y persistencia

Haz una consulta de chat, espera `completed`, recarga la página y vuelve a la misma sesión. Continúa con una referencia deíctica como “¿y su etapa?” y después consulta el job desde la interfaz.

**Esperado:** el historial/contexto se restaura para la misma sesión y cuenta, la pregunta de seguimiento conserva la referencia compatible, el job muestra su resultado persistido y una sesión de otro usuario no expone el historial. Un job `pending` o `running` no se presenta como respuesta final.

## 3. Cuenta nueva

### Preparación

Abre **Mi Agent > Cuenta nueva** con un usuario autorizado para prospección. Usa una empresa de prueba y país; agrega sitio web/industria solo si tienes datos válidos. Prefiere una empresa sin duplicado para probar conversión y ejecuta también un caso con una coincidencia duplicada. Inicia **Investigar fuentes públicas**, espera el estado final y registra las fuentes, hallazgos, personas y posibles hipótesis que realmente produjo la sesión. No crees una cuenta CRM al preparar el prospecto.

### Casos

#### 1. Creación de sesión e investigación externa

**Acción:** crea la ficha con empresa y país y solicita investigación pública.

**Esperado:** se crea/reutiliza una sesión de prospecto y un run de investigación; al finalizar se muestran estado, hallazgos e indicios de duplicados. La ficha sigue siendo una sesión de investigación: `accountId` CRM y `convertedAccountId` permanecen vacíos hasta una conversión explícita.

#### 2. Respuesta del chat con fuentes del prospecto

**Vendedor:** ¿Qué hallazgos públicos respaldan la hipótesis principal?

**Esperado:** resume solo hallazgos de esa sesión, identifica fuentes que los respaldan y distingue evidencia pública de inferencia. No describe una hipótesis como oportunidad CRM confirmada ni inventa citas/fuentes.

#### 3. Persona identificada frente a rol objetivo

**Vendedor:** ¿Quién aparece como contacto y quién deberíamos buscar?

**Esperado:** separa personas identificadas en una fuente pública (marcadas como no confirmadas en CRM) de roles objetivo sugeridos (que no son personas identificadas). Atribuye cada afirmación a su fuente. Si la investigación no identifica a alguien, no inventa nombre, puesto ni relación.

#### 4. Hipótesis, outreach y datos no disponibles

Pregunta por una hipótesis, reto, correo de outreach o dato de perfil de la sesión.

**Esperado:** responde con el contenido presente en la ficha, separando perfil proporcionado, hallazgo público e inferencia. Si falta el dato, lo dice o pregunta; no lo completa con información de otro prospecto o del CRM.

#### 5. Continuidad del chat y actualización de investigación

**Vendedor:** ¿Qué hipótesis debería validar?

Continúa: **Vendedor:** ¿Qué evidencia falta para esa hipótesis?

Después recarga la ficha y usa **Actualizar investigación**.

**Esperado:** el segundo turno usa la misma hipótesis y contexto de sesión; tras recargar se restaura el historial. Actualizar conserva la misma ficha y su historial de investigación; no crea otra sesión de chat ni transforma hallazgos anteriores en hechos CRM.

#### 6. Límite respecto del CRM y de otros chats

**Vendedor:** ¿Cuál es el monto de la oportunidad `<nombre de oportunidad CRM>`?

**Esperado:** Cuenta nueva no busca oportunidades CRM ni reutiliza el contexto de Coach/Cliente existente. Explica que la sesión contiene información del prospecto y que ese dato debe consultarse en el canal CRM autorizado. Cambia entre espacios y comprueba que no se mezclen mensajes ni entidades.

#### 7. Falta de evidencia o fallo de una fuente

Pregunta por un hecho concreto que no esté en los hallazgos o usa una sesión donde investigación terminó sin fuente útil.

**Esperado:** indica que la sesión no contiene evidencia suficiente, distingue “sin hallazgos” de error/timeout y ofrece actualizar o precisar la búsqueda. No inventa hechos ni presenta una fuente fallida como ausencia confirmada.

#### 8. Conversión con cancelación, confirmación y duplicados

En una sesión sin duplicado, solicita convertir el prospecto en cuenta/lead y una hipótesis en oportunidad.

**Esperado en el chat:** la respuesta puede recomendar acciones de conversión con `requiresConfirmation`; no afirma que la cuenta, lead, contacto u oportunidad ya se haya creado. La propuesta no equivale a ejecución.

En la interfaz, abre la confirmación de creación de cuenta o lead, cancélala y verifica que no haya solicitud ni registro creado. Repite y confirma expresamente en entorno de prueba; verifica el resultado en el CRM. Para oportunidades, confirma la hipótesis según el flujo de la ficha y comprueba que la creación no esté disponible antes de esa confirmación.

Repite con una investigación que tenga un posible duplicado.

**Esperado:** se bloquean crear/vincular cuenta y cualquier opción de “crear de todos modos” mientras el duplicado requiera resolución; no se crea un registro. Las conversiones disponibles siguen mostrando confirmación explícita.

#### 9. Sesión guardada y propiedad

Abre una investigación guardada con el usuario propietario y luego intenta consultar esa sesión/job con otro usuario de prueba.

**Esperado:** el propietario recupera la misma ficha e historial; el otro usuario no obtiene perfil, hallazgos, chat ni resultado del job. Un error de autorización no se presenta como una sesión vacía.

## Criterios de aprobación

- Variaciones de redacción que aluden al mismo registro conservan la referencia cuando el historial y los candidatos señalan uno solo.
- Una mención explícita nueva reemplaza el foco anterior.
- El plan distingue un registro, varios registros y una colección completa.
- Los candidatos mostrados al modelo usan aliases; el servidor valida cuenta y permisos antes de resolver el ID interno.
- Una referencia ambigua produce una aclaración concreta, no una selección silenciosa.
- Una operación requiere un único objetivo y confirmación explícita; la lectura nunca se presenta como escritura ejecutada.
- En Coach, la guía respalda orientación de proceso, las lecturas CRM respaldan hechos del vendedor y el detalle exhaustivo se deriva al espacio autorizado.
- En Cuenta nueva, toda respuesta permanece limitada a la sesión; fuentes públicas, hipótesis y roles objetivo no se presentan como registros CRM confirmados.
- En todos los canales, errores, timeouts, truncamientos y consultas omitidas se diferencian de una búsqueda válida sin coincidencias.
- Al terminar un job, resultado, historial y contexto se conservan en la sesión correcta; B1 obtiene el resultado sondeando B2.

## Verificación automatizada complementaria

Ejecuta las suites automatizadas además de los recorridos manuales. Los tests usan fixtures/mocks cuando corresponde; no sustituyen la comprobación manual con datos autorizados del entorno:

```bash
cd apps/api && npm run test:coach
cd apps/api && npm run test:customer-chat:evaluation
cd apps/api && npx vitest run --maxWorkers=1 test/prospect-chat-adapter.test.js test/channel-intents.test.js
cd apps/web && npm run test:e2e:coach
```

La batería también complementa la [evaluación sintética de Cliente existente](./chat-cliente-existente-evaluacion-sintetica.md) y la [matriz automatizada del Coach](./coach-evaluation-questions.md).
