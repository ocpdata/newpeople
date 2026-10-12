# Administracion de Mi Coach

## Proposito

Este documento describe la pantalla **Mi Coach > Administracion** y las reglas que gobiernan sus canales conversacionales. La administracion permite ajustar configuracion global, limites de lectura y operacion, ejemplos de intenciones y reglas de respuesta.

La interfaz es de gobierno: no reemplaza los permisos de cada usuario ni los formularios y confirmaciones de los modulos CRM.

## Acceso

La pantalla y sus endpoints requieren el permiso `mi_coach.admin`. Tener permiso para usar Coach (`mi_coach.use`) o confirmar una operacion (`mi_coach.execute`) no concede por si mismo acceso administrativo.

La mayoria de los cambios se guardan de forma explicita con el boton de su seccion. Los cambios administrativos relevantes quedan auditados. Los catalogos de intenciones mantienen historial de revisiones y permiten restaurar una revision anterior.

## Secciones

### Reglas del servidor

**Cliente existente** tiene una politica estructurada, versionada y conectada al
codigo. La seccion usa la configuracion existente `customer_account/default` de
`mi_coach_business_rules`: no mantiene una segunda copia de dominios, filtros u
operaciones. Conserva las personalizaciones y los alias existentes.

**Coach** y **Cuenta nueva** aparecen como **pendientes de conexion**. No consumen
esta nueva politica; sus configuraciones y flujos actuales no se modifican. El
catalogo y el contrato de administracion estan separados del adaptador, preparados
para extenderlos por canal en una etapa posterior.

La pantalla organiza el inventario funcional en nueve categorias. Cada regla tiene
un identificador estable y distingue:

- **Editable**: un valor estructurado con opciones o limites seguros. El servidor
  lo utiliza efectivamente; no es una instruccion para la IA.
- **Control protegido**: una validacion obligatoria implementada en codigo. La API
  rechaza los intentos de editarla; no existe un interruptor para quitarla.
- **Evaluacion de IA**: interpretacion del plan, suficiencia de evidencia o auditoria
  de afirmaciones. El resultado esta sujeto a controles deterministas; una
  evaluacion inconclusa o no disponible no habilita operaciones.

#### Matriz de cobertura

El catalogo completo, con IDs, descripciones y controles, se define en
[`server-policy.js`](../apps/api/src/coach/server-policy.js) y es el mismo que
devuelve la API y presenta la interfaz.

| Categoria | Reglas / naturaleza | Punto de aplicacion | Pruebas |
| --- | --- | --- | --- |
| 1. Acceso, solicitud y sesion | `user-access`, `session-context`, `external-access`: protegidas | Rutas, servicio, validacion de contexto y propiedad de sesion | Acceso admin en `customer-server-rules.test.js`; alcance y memoria en `customer-conversation-context.test.js`; validaciones existentes del servicio |
| 2. Herramientas y operaciones | Dominios `*SearchAllowed` y `operation-kinds`: editables. `tool-intersection`: protegido | `conversation-engine.js`, herramientas de lectura, normalizacion de propuestas | `coach-business-rules.test.js`, `customer-chat-adapter.test.js` |
| 3. Plan de B6 | `single-operation-target`, `ambiguous-target`, `selected-fallback`: politicas estructuradas. `plan-contract`, `plan-filters`: protegidas. `plan-confidence`: evaluacion de IA | `channel-intents.js`, motor y adaptador de Cliente existente | `channel-intents.test.js`, `customer-server-policy-runtime.test.js` |
| 4. Lecturas y evidencia | `read-budget`, `evidence-rounds`, `turn-deadline`, `default-open`, `default-active`, `default-inactive`: editables. `read-scope`: protegido. `evidence-assessment`: IA con barreras | Lecturas iniciales y adicionales, filtros, bucle de evidencia y plazo del motor | `customer-server-policy-runtime.test.js`, `customer-chat-evidence.test.js` |
| 5. Actividades | `activity-read-priority`, `activity-links`, `activity-continuation`: protegidas | Adaptador, `activity-draft.js`, persistencia de borradores | Pruebas existentes de actividades y adaptador |
| 6. Cambios de monto | `amount-input`, `amount-target`: validaciones protegidas que aplican las politicas de objetivo de la categoria 3 | Resolucion determinista de oportunidades; contexto de continuacion | `customer-server-policy-runtime.test.js`, `customer-conversation-context.test.js` |
| 7. Propuestas | `proposal-contract`, `proposal-policy`: protegidas | Contrato de operaciones, normalizacion y filtrado final. Rechaza propuestas de un mismo tipo para varios registros | `customer-chat-adapter.test.js`, `customer-server-policy-runtime.test.js` |
| 8. Respuesta final | `business-evidence`: protegido. `answer-audit`: IA con bloqueo determinista | Motor y auditoria de evidencia autorizada | Pruebas del adaptador y de evidencia |
| 9. Persistencia y ejecucion | `operation-version`, `execution-access`: protegidas | Persistencia de borradores, servicio de operaciones controladas, politica de operaciones | Pruebas existentes de borradores y operaciones controladas |

#### Valores editables y limites

| Configuracion | Valores admitidos / iniciales | Comportamiento |
| --- | --- | --- |
| Dominios de lectura | Booleanos para cuentas, oportunidades, contactos, leads y cotizaciones | Interseccion con las herramientas de la intencion y los permisos del usuario |
| Operaciones permitidas | Catalogo conocido de Cliente existente | No concede permisos; crear oportunidades o vincular contactos requiere habilitacion explicita |
| Filtros predeterminados | Abiertas, activadas o no activadas | La solicitud explicita tiene prioridad; activadas y no activadas no pueden exigirse simultaneamente |
| Solicitud de varios objetivos | `ask_single` | Unico comportamiento soportado: explicar la limitacion, pedir un registro y devolver cero operaciones |
| Objetivo ambiguo | `ask` | Pedir aclaracion; no hay seleccion silenciosa |
| Respaldo de oportunidad seleccionada | `allow_singular` (inicial), `require_explicit` | Solo cambios de monto singulares compatibles. Nunca reemplaza una solicitud plural ni una referencia ambigua |
| Lecturas por turno | Entero 1–8, inicial 8 | Limita las lecturas de herramientas iniciales y adicionales, incluida la cotizacion; no es un limite de filas ni del snapshot autorizado previo |
| Rondas adicionales de evidencia | Entero 0–2, inicial 2 | Cero permite la evaluacion inicial, pero no lecturas adicionales |
| Plazo del motor | Entero 5000–45000 ms, inicial 45000 | Mismo plazo para planificacion, preparacion de lecturas, evidencia, generacion y auditoria |

Ni las reglas estructuradas ni el prompt editable pueden desactivar permisos,
aislamiento por cuenta, evidencia obligatoria, validacion de entidades/contratos,
revision, confirmacion o validaciones de ejecucion.

#### Versiones, restauracion y cache

- **Guardar reglas del servidor** exige la version que se cargo en el editor.
  Una escritura concurrente devuelve **409**; el borrador se conserva hasta recargar.
- **Recargar reglas guardadas** recupera la version activa y confirma antes de
  descartar cambios. **Cargar reglas iniciales** y **Cargar version en formulario**
  solo cambian el borrador, previa confirmacion: hay que guardar para activar
  una nueva version. No eliminan el historial.
- El primer guardado conserva como revision 0 la configuracion preexistente,
  incluida cualquier personalizacion anterior. Restaurar los valores iniciales
  de codigo es distinto de restaurar esa revision.
- La transaccion bloquea la version y la fila de configuracion, guarda la revision
  inmutable y activa la nueva version. La auditoria registra antes/despues y usuario.
- Cada turno recibe una copia estable de la politica efectiva. Una cache en memoria
  evita releer y normalizar el JSON completo en cada turno; una consulta pequena
  de version detecta cambios de otros procesos. El guardado invalida la cache local.
  La cache completa se refresca como maximo cada 60 segundos.
- Un error de almacenamiento o una politica invalida se propaga: no se sustituye
  silenciosamente por reglas permisivas.

Los endpoints requieren `mi_coach.admin`:

- `GET /api/commercial-intelligence/governance/server-rules`
- `PUT /api/commercial-intelligence/governance/server-rules/customer_account`,
  con `{ expectedVersion, rules }`. Admite cambios parciales solo en campos
  editables; rechaza claves desconocidas, tipos incorrectos y limites inseguros.

La antigua pantalla de politicas redirige Cliente existente a esta seccion.
Su antiguo endpoint de escritura/restablecimiento devuelve 409 para ese canal,
para impedir escrituras sin version o la eliminacion del historial. Coach y
Cuenta nueva conservan sus endpoints y configuraciones actuales.

#### Seleccion individual y trazabilidad

«Actualiza el monto de las oportunidades abiertas de Totalplay a 1000000»
devuelve una aclaracion de que solo se prepara una oportunidad a la vez, incluso
si hay una seleccion activa o B6 propone erroneamente un objetivo singular.
El contexto guarda importe, cuenta, filtros y candidatos autorizados. Al responder
con el nombre de una oportunidad, se vuelve a validar su pertenencia, visibilidad
y compatibilidad con los filtros antes de preparar una propuesta confirmable.
Una oportunidad historica no satisface una solicitud de abiertas. Una respuesta
inequivoca con el nombre del candidato conserva la solicitud de cambio aunque
B6 la confunda con una consulta; una pregunta distinta no se convierte en operacion
por mencionar ese nombre. La seleccion pendiente se conserva si todavia se pide
aclaracion y se consume, cancela o reemplaza al resolver o cambiar la solicitud;
nunca se ejecuta en bloque.

La traza existente conserva `appliedRules.serverRulesVersion`, la politica
efectiva y decisiones con IDs estables, incluyendo aclaraciones/rechazos, limites
de lectura/rondas/plazo, auditoria y validacion de propuestas. No se crea un
registro paralelo de conversaciones ni se convierte el historial en evidencia CRM.

### Prompts del planificador

La seccion ofrece instrucciones editables independientes para **Coach**, **Cliente existente**
(`customer_account`) y **Cuenta nueva** (`prospect`). Solo **Cliente existente** esta conectado:
B5 carga su instruccion vigente de `customer_account/default` antes de invocar B6 y la agrega
al prompt tecnico fijo. Si aun no existe una personalizacion, utiliza la instruccion
predeterminada. Coach y Cuenta nueva permiten guardar configuracion para una etapa posterior,
pero la interfaz los identifica como **No conectado**: sus flujos no consumen estos prompts.
Coach conserva su B6 actual; Cuenta nueva todavia requiere incorporar un planificador B6.

La instruccion predeterminada de Cliente existente es el texto completo que comienza con
**"Eres el planificador estructurado del chat de Cliente existente"** e incluye autoridad
y alcance, decision de intencion, consultas de lectura, operaciones, resolucion de
entidades y formato de salida. Ese mismo texto se muestra en el editor y se incorpora
al prompt de B6. Los registros sin personalizacion (version 0) usan el valor predeterminado
vigente, aunque originalmente se hayan inicializado con un resumen; las versiones
personalizadas ya guardadas se conservan sin sobrescribirlas.

- **Guardar prompt** activa una nueva version para la proxima planificacion, sin modificar
  las revisiones anteriores. **Historial de versiones** permite consultar el texto guardado.
- **Cargar prompt inicial** recupera el texto original del canal, independientemente de
  cuantas versiones se hayan guardado. Pide confirmacion antes de reemplazar el editor,
  incluidos los cambios sin guardar. No activa el texto automaticamente: pulsa **Guardar**
  para usarlo como una nueva version. El historial y el texto inicial se conservan.
- Cada instruccion admite entre 1 y 8000 caracteres tras quitar espacios exteriores.
- El servidor conserva versiones y autor de la edicion en `mi_coach_planner_prompts` y
  `mi_coach_planner_prompt_revisions`, y audita los cambios. La version 0 indica el valor
  predeterminado sin personalizacion.
- Si otro administrador guarda primero, la edicion obsoleta recibe un conflicto (HTTP 409).
  **Recargar prompts guardados** reemplaza los borradores locales con la version vigente.
- Los endpoints `GET /api/mi-agent/coach/admin/planner-prompts` y
  `PUT /api/mi-agent/coach/admin/planner-prompts/:channel` requieren `mi_coach.admin`.
  La escritura acepta solo `instruction` y `expectedVersion`; ni la conexion del canal,
  ni el prompt tecnico base, ni el esquema JSON son administrables.

Consultar actividades existentes, pendientes o historicas sigue siendo una **lectura**.
Preparar una actividad requiere una solicitud explicita o una continuacion inequivoca de
una propuesta en curso; la existencia de un borrador pendiente no basta para convertir
una consulta en operacion. B5 conserva la validacion del catalogo, alcance, entidades,
filtros, herramientas y operaciones, con permisos y confirmacion del servidor. Las
instrucciones editables no conceden permisos ni sustituyen estas barreras. La traza de
planificacion registra canal, proceso, version y origen del prompt utilizado.

### Intenciones y enrutamiento

Esta seccion sirve para que cada chat identifique que tipo de solicitud recibio y decida como atenderla: orientar al vendedor, contestar una consulta puntual o preparar una propuesta. La configuracion ajusta como se reconocen esas solicitudes y que contexto o herramientas puede proponer cada canal. No ejecuta la solicitud ni concede permisos; el servidor valida el acceso y los limites antes de consultar o cambiar datos.

La seccion tiene un selector unico para **Coach**, **Cliente existente** y **Cuenta nueva**. Cambiar el canal solo cambia el catalogo que se edita; no combina sesiones, permisos ni datos entre canales.

**Coach**

- El catalogo muestra intenciones como `seller_coaching`, `stage_readiness`, `account_query`, `opportunity_query` y `operation`.
- Se pueden editar los ejemplos de cada intencion. El servidor acepta entre 1 y 30 ejemplos, de hasta 240 caracteres cada uno.
- La vista muestra el contexto requerido y las herramientas posibles. Son datos informativos del catalogo; no se editan desde este panel.
- **Probar** simula la clasificacion y muestra intencion, modo, confianza, destino de detalle, contexto requerido y herramientas previstas. La prueba no ejecuta herramientas ni cambia el CRM.
- **Guardar ejemplos** actualiza los ejemplos del catalogo y registra una revision.

#### Conceptos de intencion, modo y politica

No son sinonimos. Cada valor responde una pregunta distinta sobre el mismo mensaje:

| Concepto                              | Que responde                                                          | Ejemplo                                                                   |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Intencion del catalogo** (`intent`) | ¿Que clase concreta de solicitud detecto B6?                          | `opportunity_query`: consultar oportunidades.                             |
| **Modo de interaccion** (`mode`)      | ¿Como debe atenderse la solicitud y que limites de respuesta aplicar? | `brief_context`: responder puntualmente, sin desplegar la ficha completa. |
| **Tema CRM**                          | ¿Sobre que tipo de registro trata la pregunta?                        | Una oportunidad, aunque la intencion sea coaching.                        |
| **`policyProcess`**                   | ¿Que conjunto de reglas de negocio carga B3?                          | `seller_coaching`; si no hay override, `default`.                         |

**Valores posibles de `policyProcess`**

| Valor             | Cuando se usa                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`         | Configuracion general y respaldo. Se usa si B3 no reconoce la pregunta con claridad y para modos como exploracion detallada, que no tiene un override propio. |
| `seller_coaching` | Orientacion sobre desempeño, prioridades, riesgos, etapas y siguientes pasos.                                                                                 |
| `brief_context`   | Consulta puntual de una cuenta, oportunidad, contacto, lead, actividad o cotizacion; el tema CRM sigue identificandose por separado.                          |
| `operation`       | Solicitud explicita de crear o modificar un registro mediante el flujo de propuesta y confirmacion.                                                           |

Una intencion del catalogo no tiene que corresponder a un `policyProcess` exclusivo. Por ejemplo, `account_query` y `opportunity_query` pueden usar `brief_context` si preguntan por un dato puntual, o `seller_coaching` si el vendedor pide una recomendacion. `deep_exploration` es un modo de interaccion, no un valor de `policyProcess`; siempre se deriva fuera de Coach.

#### Ejemplo paso a paso: priorizar oportunidades

Pregunta del vendedor: **«¿Que oportunidades deberia priorizar esta semana?»**

| Paso | Quien actua                        | Que decide o hace                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | B3, clasificador local             | Reconoce una solicitud de orientacion sobre oportunidades. Conserva `opportunity_query` como tema CRM, elige `coaching` como modo efectivo y fija `seller_coaching` como `policyProcess`.                                                                              |
| 2    | Gateway Coach                      | Carga las reglas de negocio de `coach/seller_coaching`. Si no hay un override guardado para ese proceso, usa las reglas `coach/default`.                                                                                                                               |
| 3    | B6, IA                             | Recibe la pregunta, el catalogo de intenciones y los ejemplos configurados. Propone una intencion del catalogo (por ejemplo, `seller_coaching`) y lecturas posibles, como consultar pipeline u oportunidades. No recibe permiso para leer por el hecho de proponerlas. |
| 4    | B5, servidor                       | Valida la intencion, confianza, contexto, filtros y herramientas. El plan se limita a las herramientas de esa intencion, a la politica de Coach y a los permisos del usuario. Rechaza herramientas o referencias que no esten autorizadas.                             |
| 5    | B7 y B8, read model y herramientas | Preparan el contexto CRM permitido y ejecutan solo las lecturas aprobadas. No escriben datos.                                                                                                                                                                          |
| 6    | B9, verificador                    | Compara la pregunta con las lecturas. Si falta evidencia, puede pedir una lectura adicional autorizada; si no puede sustentar la respuesta, solicita precision o limita la conclusion.                                                                                 |
| 7    | B10, respuesta                     | Redacta la recomendacion con evidencia verificada, la guia del proceso comercial, las reglas conversacionales activas y la politica del modo `coaching`.                                                                                                               |
| 8    | B11, persistencia                  | Guarda el resultado y el historial/contexto de la sesion de Coach; la traza registra la intencion, el modo y `policyProcess` de B3.                                                                                                                                    |

En este ejemplo `opportunity_query` responde **de que trata** la pregunta; `coaching` responde **como contestar**; y `seller_coaching` selecciona **que reglas de negocio cargar**. Aunque `seller_coaching` tambien exista como intencion del catalogo de B6, ese campo y `policyProcess` son decisiones distintas. Si el vendedor preguntara «¿Cual es el monto de esta oportunidad?», el tema seguiria siendo una oportunidad, pero el objetivo seria una consulta puntual, el modo `brief_context` y el `policyProcess` correspondiente.

B3 determina el `policyProcess` y el modo efectivo mediante la clasificacion local de la pregunta. B6, con IA, propone la intencion del catalogo y las lecturas necesarias. El servidor valida la propuesta; el modo propuesto por la IA no puede ampliar las lecturas permitidas por B3.

**Modos de interaccion disponibles**

| Modo               | Que hace Coach                                                                                          | Limite aplicado                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `coaching`         | Orienta al vendedor sobre desempeño, prioridades, riesgos y siguientes pasos usando evidencia resumida. | Puede recomendar; los hechos CRM necesitan lecturas autorizadas.                                   |
| `brief_context`    | Responde una pregunta puntual con los datos minimos relevantes.                                         | Limita la respuesta a 1400 caracteres, hasta 6 hechos/evidencias y hasta 3 inferencias/pendientes. |
| `deep_exploration` | Deriva la revision detallada a Cliente existente o al modulo autorizado.                                | No consulta el detalle CRM desde Coach; el servidor valida el acceso al abrir el destino.          |
| `operation`        | Prepara una propuesta de creacion o cambio para que el vendedor la revise.                              | No ejecuta escrituras ni afirma que el cambio ya ocurrio; requiere permisos y confirmacion.        |

**Intenciones del catalogo de B6**

El catalogo contiene 14 intenciones que describen **de que trata la pregunta**. No equivalen a los modos de interaccion ni a las politicas configurables. Para estas ultimas, Coach tiene `default` mas tres overrides: `seller_coaching`, `brief_context` y `operation`.

| Codigo                | Para que sirve                                                                                                                 | Contexto requerido por catalogo                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `process_information` | Explicar etapas, conceptos o practicas generales del proceso comercial, sin consultar registros CRM.                           | Ninguno.                                                                                |
| `seller_coaching`     | Orientar al vendedor sobre desempeño, prioridades, seguimiento y avance de su cartera con señales resumidas.                   | Ninguno; puede usar el pipeline autorizado.                                             |
| `stage_readiness`     | Revisar pendientes, riesgos y preparacion de una oportunidad para avanzar de etapa.                                            | Oportunidad.                                                                            |
| `activity_query`      | Consultar actividades pendientes y siguientes pasos de una oportunidad.                                                        | Oportunidad.                                                                            |
| `quotation_query`     | Consultar el contenido comercial de la cotizacion asociada a una oportunidad.                                                  | Oportunidad.                                                                            |
| `contact_query`       | Buscar contactos o decisores relacionados con una cuenta u oportunidad.                                                        | Cuenta.                                                                                 |
| `account_query`       | Consultar el resumen o historial autorizado de una cuenta.                                                                     | Cuenta.                                                                                 |
| `opportunity_query`   | Buscar o resumir oportunidades autorizadas y su pipeline.                                                                      | Ninguno predefinido; el servidor determina el alcance autorizado.                       |
| `lead_query`          | Buscar o consultar leads autorizados.                                                                                          | Ninguno predefinido; se requieren herramientas y permisos aplicables.                   |
| `account_ranking`     | Comparar cuentas mediante las oportunidades y cobertura de pipeline disponibles.                                               | Ninguno predefinido.                                                                    |
| `temporal_filter`     | Filtrar oportunidades por fecha de cierre u otro periodo comercial.                                                            | Ninguno predefinido.                                                                    |
| `operation`           | Identificar una solicitud explicita de crear o modificar un registro para llevarla al flujo de propuesta y confirmacion.       | Ninguno predefinido; la operacion concreta exige su contexto y permisos en el servidor. |
| `general_query`       | Clasificar una pregunta general que no corresponde claramente a otra intencion, como pedir orientacion o un ejemplo de correo. | Ninguno.                                                                                |
| `clarification`       | Indicar que la solicitud es ambigua o que la confianza de clasificacion no alcanza el minimo requerido.                        | No aplica; el resultado esperado es pedir precision.                                    |

**Cliente existente**

- B4 carga politica `customer_account/default` y el catalogo configurado del canal. B6 usa IA para proponer una intencion y lecturas; B5 normaliza el plan antes de que B7 prepare el read model.
- Por intencion se pueden ajustar activacion, prioridad, ejemplos, herramientas permitidas y contexto requerido.
- La prioridad acepta valores de 0 a 200. Las herramientas solo pueden reducirse a un subconjunto permitido por el catalogo fijo del canal.
- El contexto obligatorio definido por el servidor no se puede eliminar.
- En este canal los ejemplos ayudan al planificador IA; patrones, herramientas maximas y contexto obligatorio siguen perteneciendo al catalogo del servidor. El `accountId` seleccionado es el alcance fijo y no se cambia por una mencion en el texto.

**Intenciones de Cliente existente**

| Codigo                     | Para que sirve                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm_operation`            | Detecta una solicitud explicita de crear o cambiar un registro de la cuenta seleccionada; siempre pasa por revision y confirmacion.                                        |
| `email_draft`              | Prepara un borrador de correo con datos autorizados; no envia el correo.                                                                                                   |
| `quotation_query`          | Consulta el contenido comercial de una cotizacion autorizada de la cuenta.                                                                                                 |
| `contact_history`          | Lista contactos visibles y sus interacciones CRM relacionadas.                                                                                                             |
| `opportunity_status`       | Consulta el estado, etapa y activacion de una oportunidad.                                                                                                                 |
| `opportunity_guidance`     | Recomienda siguientes pasos para una oportunidad usando detalle, readiness, actividades e interacciones autorizadas.                                                       |
| `account_activity_history` | Consulta interacciones y actividades de la cuenta para el periodo pedido.                                                                                                  |
| `contact_query`            | Busca contactos y verifica su asociacion con una oportunidad cuando se solicita.                                                                                           |
| `opportunity_query`        | Busca o resume oportunidades autorizadas de la cuenta.                                                                                                                     |
| `account_overview`         | Intencion general de respaldo: resume datos basicos, conteos de oportunidades/contactos disponibles; no afirma interacciones si no se consultaron. No se puede desactivar. |

**Cuenta nueva**

- B4 carga politica `prospect/default` y el catalogo configurado. Antes de preparar lecturas, el motor llama a `classifyChannelIntent`; no usa el planificador IA B6 de Cliente existente.
- El clasificador determinista compara patrones del catalogo y ejemplos configurados, descarta intenciones desactivadas y selecciona la coincidencia habilitada con mayor prioridad. Los ejemplos, prioridad, activacion, herramientas permitidas y contexto requerido son editables.
- Herramientas permitidas solo se pueden reducir respecto del catalogo fijo; los contextos obligatorios no se pueden quitar. `prospect_profile` es la intencion general de respaldo y no se puede desactivar. La sesion activa de prospeccion sigue siendo el limite de datos.

**Intenciones de Cuenta nueva**

| Codigo                   | Para que sirve                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `conversion_request`     | Prepara la revision de una conversion de prospecto a CRM; no crea registros sin confirmacion.       |
| `outreach_draft`         | Prepara un mensaje de acercamiento usando el contexto de la sesion.                                 |
| `public_research_review` | Resume evidencia publica ya guardada en la sesion; no inicia una nueva busqueda.                    |
| `prospect_contacts`      | Consulta contactos potenciales encontrados, sin presentarlos como contactos CRM confirmados.        |
| `opportunity_hypotheses` | Consulta hipotesis comerciales aun pendientes de validacion.                                        |
| `prospect_findings`      | Consulta hallazgos, indicios y evidencia registrados en la sesion.                                  |
| `prospect_profile`       | Intencion general de respaldo: consulta el perfil ingresado para la sesion. No se puede desactivar. |

En ambos canales, **Probar** simula el enrutamiento sin ejecutar herramientas ni crear registros. Guardar o restaurar una revision deja el cambio auditado.

#### En que bloque se aplica

| Canal             | Clasificacion                                                                                                                                                                                                                                              | Bloques y uso de la configuracion                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coach             | El preclasificador determinista aporta señales; `semantic-intent-classifier.js` usa IA para proponer la intención de negocio y el resolver del servidor fija intención/modo efectivos. El B6 del diagrama planifica lecturas compatibles con esa decisión. | El catálogo y los ejemplos editables se entregan al planificador B6 para construir propuestas de lectura; no cambian la decisión del clasificador semántico ni sustituyen la comprobación de permisos del servidor. B7 prepara el read model y B8 ejecuta solo lecturas autorizadas. |
| Cliente existente | B6 IA propone intencion, filtros y lecturas usando el catalogo configurado.                                                                                                                                                                                | B4 carga politica/catalogo `customer_account`; B5 valida la propuesta; B7 prepara lecturas para el `accountId` autorizado; B8 ejecuta herramientas en el snapshot fijo de esa cuenta.                                                                                                |
| Cuenta nueva      | Clasificador determinista compara patrones del servidor y ejemplos/prioridades configurados.                                                                                                                                                               | B4 carga politica/catalogo `prospect`; el motor clasifica antes de preparar el read model; el adaptador carga siempre el perfil de la sesion y ejecuta las lecturas de la intencion seleccionada. No invoca el planificador B6 de Cliente existente.                                 |

En todos los canales el catalogo del servidor define la autoridad final. Una intencion desactivada no se selecciona; las herramientas del plan se intersectan con las herramientas del canal y con los permisos efectivos del usuario. En Cuenta nueva, la prioridad resuelve que patron coincidente gana; en Cliente existente la prioridad y los ejemplos forman parte de la configuracion validada del planificador.

### Reglas conversacionales

Las reglas conversacionales son instrucciones de texto que se agregan al contexto del modelo. Orientan como responder, por ejemplo, a distinguir evidencia de inferencias, respetar la continuidad de entidades o proponer una operacion sin afirmar que ya se ejecuto.

- **Comunes a todos los chats** se aplican en todos los canales.
- Las reglas **especificas por canal** pueden limitarse a Coach, Cliente existente o Cuenta nueva.
- Coach admite reglas para `default` y para los procesos canonicos `seller_coaching`, `brief_context` y `operation`. Si no existe una regla para una intencion, se usa `default`.
- Cliente existente y Cuenta nueva usan una unica configuracion por canal (`default`).
- Cada regla tiene titulo, instruccion, orden y estado activa/inactiva. Los grupos comunes y por canal se pueden desplegar por separado.

Estas instrucciones orientan al modelo, pero no son controles de seguridad: una regla de texto no concede permisos ni autoriza lecturas o escrituras. El servidor aplica por separado las politicas de negocio, permisos, ownership, contexto y confirmaciones.

#### Cuando llegan al modelo

El gateway prepara las reglas para el canal y proceso del turno. El motor incluye las reglas activas en `administrativeRules` dentro del contexto que recibe el modelo al generar la respuesta (B10). En la arquitectura por bloques de Coach, el evaluador de evidencia B9 tambien recibe las reglas administrativas activas junto con las politicas, la guia del proceso y la evidencia; asi puede valorar la respuesta segun las instrucciones del canal.

Las reglas conversacionales **no clasifican la pregunta ni autorizan herramientas**. En Coach, B6 recibe el catalogo de intenciones y ejemplos, no estas instrucciones de respuesta. El orden de aplicacion es: reglas comunes, reglas activas del canal y, cuando corresponde, reglas del proceso/intencion. Una regla especifica no elimina las comunes; se agregan como instrucciones de contexto.

Los canales Cliente existente y Cuenta nueva tambien pueden tener reglas comunes y reglas propias de canal. Esas instrucciones llegan al contexto del modelo de su turno, pero no convierten sus planificadores en el de Coach ni amplian su catalogo de herramientas.

### Politicas del canal y contexto

La seccion configura lo que cada canal puede consultar o proponer. Coach ofrece una configuracion general y ajustes opcionales por intencion; Cliente existente y Cuenta nueva tienen una configuracion por canal. Si no hay ajuste especifico de Coach, se usa la configuracion general.

**Dominios de consulta**

- **Cuentas:** datos generales de cuentas autorizadas.
- **Contactos:** contactos relacionados con el contexto autorizado.
- **Leads:** leads visibles para el usuario y permitidos por el canal.
- **Oportunidades y pipeline:** oportunidades, etapas, estado, activacion y resumen de pipeline, segun el canal.
- **Cotizaciones:** contenido comercial accesible; las validaciones evitan exponer costos internos o margenes.

Desactivar un dominio reduce las lecturas disponibles para el chat, pero no amplia los permisos del usuario. El canal Cuenta nueva mantiene sus restricciones: no habilita consultas de contactos CRM, leads, oportunidades ni cotizaciones desde ese alcance.

**Operaciones que el canal puede proponer**

La lista depende del canal. Coach puede proponer borradores de actividad, respuestas de etapa, resultados de llamada de lead y cambios permitidos en campos CRM. Cliente existente agrega operaciones acotadas a la cuenta seleccionada, como crear un contacto, crear una oportunidad o vincular un contacto existente. Cuenta nueva propone conversiones de cuenta, contacto u oportunidad desde la sesion de prospeccion.

Habilitar una operacion solo permite que el chat la proponga. La escritura final sigue sujeta a permisos especificos, validacion de contexto y propiedad, revision del usuario y confirmacion del modulo correspondiente.

#### Bloques y precedencia

- **Coach:** B3 carga la politica general o el override del `policyProcess` clasificado. El motor aplica los dominios al catalogo de lectura/snapshot y limita los tipos de operacion propuestos. B7/B8 vuelven a validar cada lectura; las escrituras pasan por su servicio controlado y sus permisos.
- **Cliente existente:** B4 carga una politica unica `default`, con alcance fijo a la cuenta de la sesion. B5 combina esa lista con la politica de operaciones del adaptador; el planificador no puede ampliarla. El usuario sigue necesitando el permiso CRM correspondiente.
- **Cuenta nueva:** B4 carga una politica unica `default`, con dominios CRM restringidos y registros sin confirmar. Sus operaciones son conversiones propuestas; el switch global de conversion controla una capa adicional.

Las restricciones obligatorias del canal no se pueden relajar con la UI ni con instrucciones del modelo. Desactivar un dominio reduce herramientas y datos disponibles; activar una operacion no concede el permiso de usuario que exige la escritura.

### Configuracion de gobierno

Esta seccion contiene controles globales para toda la organizacion.

| Control                                    | Efecto                                                                                                                                        | Valor inicial o limite                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Etapas del pipeline calificado             | Define que etapas se incluyen en ese indicador.                                                                                               | Desarrollo, Cotizacion, Demostracion, Negociacion y Waiting. |
| Etapas del monto comprometido              | Define que etapas cuentan como comprometidas; deben ser parte del pipeline calificado.                                                        | Negociacion y Waiting.                                       |
| Fuentes externas habilitadas               | Permite iniciar investigaciones que consultan fuentes publicas externas. Si esta apagado, el servidor rechaza la investigacion externa.       | Desactivado.                                                 |
| Conversiones de prospeccion habilitadas    | Permite convertir datos de Cuenta nueva en registros CRM. No reemplaza permisos, revisiones de duplicados ni confirmaciones.                  | Activado.                                                    |
| Incluir oportunidades ganadas              | Permite que oportunidades ganadas aparezcan en el historial autorizado de Cliente existente. No las convierte en oportunidades abiertas.      | Activado.                                                    |
| Incluir oportunidades perdidas             | Permite incluir oportunidades perdidas en ese historial.                                                                                      | Activado.                                                    |
| Incluir oportunidades anuladas             | Permite incluir oportunidades anuladas en ese historial.                                                                                      | Desactivado.                                                 |
| Limite diario de investigacion por usuario | Limita investigaciones externas por usuario durante la ventana movil de 24 horas. Al alcanzar el limite, la API responde con limite excedido. | 25; minimo 1, maximo 500.                                    |
| Retencion de hallazgos                     | Determina la antiguedad maxima de hallazgos, jobs de inteligencia y sesiones de prospeccion que conserva la limpieza de gobierno.             | 365 dias; minimo 30, maximo 3650.                            |
| Notas                                      | Texto administrativo para documentar la configuracion.                                                                                        | Hasta 1000 caracteres.                                       |

El pipeline abierto se determina aparte de las etapas elegidas: una oportunidad abierta debe estar activada y en estado comercial **En proceso**. La inclusion de ganadas, perdidas o anuladas controla su presencia en el historial; no cambia su estado ni los calculos de pipeline abierto.

Las listas de etapas aceptan solo las siete etapas comerciales del catalogo. El servidor normaliza selecciones invalidas; siempre debe quedar al menos una etapa calificada y, si ninguna etapa comprometida sigue siendo valida, asigna una etapa calificada como respaldo.

La limpieza por retencion se ejecuta cuando el servicio carga el resumen de gobierno, no mediante un ajuste de politica separado. La configuracion del backend tambien conserva `requireEvidenceForExternalFindings` (activado por defecto), aunque no se muestra como control independiente en esta pantalla.

Los cambios globales se aplican al pulsar **Guardar configuracion**. El servidor normaliza los valores, los persiste y registra el cambio en auditoria.

La fila de configuracion es global para la organizacion (`singleton_key=default`), no hay una copia por vendedor ni por canal. Se carga al abrir administracion y se guarda como un unico conjunto de settings.

#### Bloques y efecto

- `externalSourcesEnabled` y `dailyResearchLimitPerUser` se consultan antes de iniciar investigacion externa. La bandera desactivada bloquea la solicitud; el limite cuenta los jobs externos y sesiones investigadas por el usuario en la ventana movil de 24 horas.
- `findingRetentionDays` se usa en la carga del resumen de gobierno para eliminar hallazgos, jobs de inteligencia y sesiones de prospeccion mas antiguos que el periodo configurado. No es una retencion de sesiones de chat de Coach.
- `includeWonOpportunities`, `includeLostOpportunities` y `includeCancelledOpportunities` filtran el historial de Cliente existente y sus artefactos asociados. No cambian la definicion de pipeline abierto ni convierten una oportunidad terminal en abierta.
- `allowProspectConversion` se verifica en los endpoints de conversion de Cuenta nueva a cuenta, contacto, lead/interaccion u oportunidad. Si esta desactivado, la conversion se rechaza aunque el vendedor tenga permisos; si esta activado, siguen siendo obligatorios los permisos del registro, las revisiones y la confirmacion aplicable.
- Las etapas calificadas y comprometidas se usan en los calculos organizacionales correspondientes. Una etapa comprometida debe estar tambien en la lista calificada; la normalizacion del servidor elimina inconsistencias y conserva al menos un valor valido.
- `notes` queda como anotacion administrativa; no se envia como instruccion conversacional ni modifica una politica de seguridad.

`requireEvidenceForExternalFindings` existe en el contrato persistido y su valor inicial es `true`, pero no tiene un control visible ni una lectura efectiva en el runtime actual. No debe tratarse como una bandera operativa hasta que se implemente su consumo.

## Modelo de configuracion y precedencia

La pantalla presenta controles separados porque resuelven problemas distintos:

1. El enrutamiento decide que intencion o tipo de solicitud atender.
2. Las reglas conversacionales orientan la redaccion y el criterio del modelo.
3. Las politicas de negocio limitan dominios y operaciones por canal e intencion.
4. Los permisos del usuario y las validaciones del servidor determinan el acceso efectivo.

Una instruccion conversacional no puede ampliar herramientas, desactivar permisos obligatorios ni saltarse confirmaciones. Los catalogos de herramientas y los contextos obligatorios son autoridad del servidor; la configuracion administrativa puede reducir el alcance permitido.

Las reglas comunes se combinan con las reglas activas del canal y del proceso aplicable. Para Coach, B3 elige el proceso de politica y B6 propone la intencion y lecturas; para Cliente existente, B6 propone el plan estructurado; Cuenta nueva resuelve su intencion con patrones deterministas. El canal seleccionado en administracion no altera estos flujos de ejecucion.

## Historial, migraciones y auditoria

- Los ejemplos de intencion de Coach y las configuraciones de enrutamiento por canal guardan revisiones y ofrecen restauracion.
- Las reglas conversacionales registran creacion, edicion y eliminacion en auditoria.
- Los cambios de reglas de negocio y de configuracion global tambien se auditan.
- Las migraciones de procesos antiguos a los grupos canonicos conservan snapshots antes de consolidar filas. La migracion de reglas no cambia permisos ni datos CRM.

## Endpoints administrativos

Todas estas rutas requieren `mi_coach.admin`. El prefijo es `/api/commercial-intelligence` salvo el endpoint de prueba IA indicado aparte.

| Ruta                                                                      | Uso                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /governance`                                                         | Cargar configuracion global y resumen administrativo.                |
| `PUT /governance/settings`                                                | Guardar limites y banderas globales; normaliza y audita los valores. |
| `GET /governance/business-rules?channel=...&process=...`                  | Leer politicas por canal y proceso.                                  |
| `PUT` o `DELETE /governance/business-rules`                               | Guardar o restablecer politicas de negocio.                          |
| `GET /governance/rules?channel=...&process=...`                           | Listar reglas conversacionales comunes y aplicables.                 |
| `POST /governance/rules`                                                  | Crear una regla conversacional.                                      |
| `PUT` o `DELETE /governance/rules/:ruleId`                                | Editar o eliminar una regla conversacional.                          |
| `GET /governance/intents`                                                 | Leer el catalogo de Coach y sus revisiones.                          |
| `PUT /governance/intents/:intentCode/examples`                            | Actualizar ejemplos de una intencion de Coach.                       |
| `GET /governance/intents/revisions`                                       | Consultar revisiones del catalogo de Coach.                          |
| `POST /governance/intents/revisions/:revisionId/restore`                  | Restaurar una revision del catalogo de Coach.                        |
| `POST /api/mi-agent/coach/admin/intents/preview`                          | Simular la clasificacion de una pregunta de Coach.                   |
| `GET /governance/channel-intents/:channel`                                | Leer intenciones de Cliente existente o Cuenta nueva.                |
| `PUT /governance/channel-intents/:channel/:intentCode`                    | Guardar ajustes de una intencion de canal.                           |
| `POST /governance/channel-intents/preview`                                | Simular el enrutamiento por canal sin ejecutar herramientas.         |
| `GET /governance/channel-intents/:channel/revisions`                      | Consultar revisiones de enrutamiento del canal.                      |
| `POST /governance/channel-intents/:channel/revisions/:revisionId/restore` | Restaurar una revision de enrutamiento del canal.                    |

Las rutas de revisiones para ambos catalogos permiten consultar el historial y restaurar una revision. Las restauraciones tambien se registran.

## Bloques por tipo de ajuste

| Ajuste                     | Lectura/seleccion                                                                                                                                                                  | Uso efectivo                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intenciones y enrutamiento | Catalogo y configuracion del canal, cargados por B4/B5 segun canal. Coach incluye catalogo de intenciones y ejemplos; los otros canales leen configuraciones de `channel-intents`. | B3 selecciona politica de Coach; B6 planifica Coach y Cliente existente; Cuenta nueva clasifica por patrones. B5 valida planes, B7 prepara datos y B8 ejecuta lecturas.                                                                     |
| Reglas conversacionales    | `listCoachAdminRules` combina reglas comunes y reglas de canal/proceso activas.                                                                                                    | Se agregan al contexto de evaluacion de evidencia B9 para Coach y al contexto de respuesta B10. No sustituyen validaciones.                                                                                                                 |
| Politicas de canal         | Reglas de negocio cargadas por canal/proceso; Coach usa `policyProcess`, los otros dos canales usan `default`.                                                                     | Aplicadas antes y durante la lectura: filtros de herramientas/snapshot, requisitos de contexto y tipos de operacion permitidos. Las herramientas vuelven a validar permisos/ownership.                                                      |
| Configuracion de gobierno  | Settings globales cargados desde el registro singleton de organizacion.                                                                                                            | Cada servicio comprueba el ajuste pertinente: investigacion externa y limites antes de investigar, conversiones antes de crear registros, historial antes de exponer oportunidades terminales y retencion al cargar el resumen de gobierno. |

## Modulos de implementacion

| Responsabilidad                                           | Archivo principal                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Interfaz de administracion y formularios                  | `apps/web/src/MiAgentPage.jsx`                                                      |
| Rutas protegidas de gobierno                              | `apps/api/src/routes.commercial-intelligence.js`                                    |
| Defaults y persistencia de configuracion global           | `apps/api/src/commercial-intelligence/service.js`                                   |
| Defaults, normalizacion, migraciones y carga de politicas | `apps/api/src/coach/business-rules.js`                                              |
| CRUD, scopes y carga de reglas conversacionales           | `apps/api/src/coach/admin-rules.js`                                                 |
| Catalogo IA de Coach, modos y validacion                  | `apps/api/src/coach/intent-governance.js`                                           |
| Patrones y defaults de intenciones por canal              | `apps/api/src/coach/channel-intents.js`                                             |
| Persistencia y validacion de configuracion por canal      | `apps/api/src/coach/channel-intent-governance.js`                                   |
| Seleccion de politica B3 y routing de Coach               | `apps/api/src/coach/phase-one-engine.js`, `apps/api/src/coach/agent-gateway.js`     |
| Plan, lecturas, evidencia y sintesis de Coach             | `apps/api/src/coach/block-pipeline.js`, `apps/api/src/coach/conversation-engine.js` |

## Fuera del alcance de esta pantalla

La administracion no permite conceder permisos individuales, editar formularios de Cuentas u Oportunidades, escribir en el CRM directamente ni forzar al modelo a obedecer una instruccion. La seccion visible de metricas operativas no forma parte actualmente de esta pantalla; los datos y trazas del motor se gestionan por sus endpoints y herramientas de diagnostico.
