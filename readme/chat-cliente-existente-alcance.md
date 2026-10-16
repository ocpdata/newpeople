# Alcance funcional: Chat de Cliente existente

Este documento define el alcance, los permisos y el comportamiento esperado del chat de Cliente existente. Es el contrato funcional para mejorar su interpretación y recuperación de información; no autoriza cambios de permisos ni amplía el acceso del modelo al CRM.

## Objetivo

Ayudar al vendedor a consultar, resumir y analizar información CRM de una cuenta existente que ya está seleccionada y autorizada. El chat debe entender preguntas expresadas en lenguaje natural, consultar únicamente evidencia permitida y explicar cuándo no puede contestar con seguridad.

El chat es un asistente especializado en información comercial de la cuenta. No es un asistente general, no sustituye los módulos operativos del CRM y no debe afirmar que una propuesta de escritura ya se ejecutó.

## Límites invariantes

- El alcance de datos es una sola cuenta CRM seleccionada y autorizada.
- Una oportunidad, contacto, lead, actividad o interacción relacionada debe pertenecer a esa cuenta o estar vinculada a ella por una relación CRM autorizada.
- Nombrar otra cuenta en el texto de la pregunta no cambia la cuenta seleccionada ni amplía el alcance. El chat debe negarse a consultar o actuar sobre esa otra cuenta e indicar al vendedor que cambie la selección desde la interfaz.
- Las consultas y operaciones deben validar permisos en el servidor. El planificador, el modelo y las instrucciones del prompt no conceden permisos.
- El historial de este canal no se comparte con Coach ni con Cuenta nueva.
- Los datos CRM, las fuentes públicas y las inferencias deben distinguirse. Un dato público no se presenta como un hecho confirmado en el CRM.
- Ninguna escritura se ejecuta directamente desde la respuesta del modelo. Las propuestas requieren revisión, permiso de ejecución y confirmación en el flujo autorizado.

## Entrada y permisos generales

Las rutas de sesión y conversación de `account-chat` requieren:

| Uso                                                                                | Permisos requeridos                                                                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Abrir Cliente existente, crear o consultar sesión y crear o consultar jobs de chat | `mi_coach.use` y `inteligencia_comercial.read`                                                           |
| Leer datos de una entidad o dominio                                                | Permiso de lectura específico del dominio, indicado en la matriz siguiente                               |
| Ejecutar una operación CRM propuesta                                               | `mi_coach.execute` y permiso de escritura específico del dominio, además de la confirmación del vendedor |
| Investigar fuentes públicas                                                        | Acción explícita del vendedor, permiso de fuentes externas y controles de gobierno vigentes              |

Los permisos `read_all` pueden habilitar el alcance de lectura administrativo previsto por el servidor, pero no cambian el contexto funcional del chat ni permiten que una respuesta mezcle silenciosamente otra cuenta con la seleccionada.

## Matriz de capacidades de lectura

| Dominio                          | Consultas incluidas                                                  | Permisos mínimos de lectura                                                                            |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cuenta seleccionada              | Datos y resumen de la cuenta                                         | `cuentas.read` o permiso administrativo equivalente                                                    |
| Oportunidades de la cuenta       | Lista, búsqueda, detalle, estado, etapa, pipeline y readiness        | `oportunidades.read`; pipeline, actividades y readiness también requieren `desarrollo_comercial.read`  |
| Contactos de la cuenta           | Datos y relaciones CRM permitidas                                    | `contactos.read`                                                                                       |
| Leads e interacciones vinculados | Leads, interacciones y actividad relacionada visible para el usuario | `interacciones.read`                                                                                   |
| Actividades de oportunidades     | Actividades vinculadas a oportunidades autorizadas de la cuenta      | `oportunidades.read` y `desarrollo_comercial.read`                                                     |
| Cotizaciones de una oportunidad  | Contenido comercial de la cotización accesible                       | `oportunidades.read` y al menos un permiso `cotizaciones.*`, sujeto a ownership y controles del módulo |
| Fuentes públicas                 | Evidencia externa relacionada con la cuenta                          | Investigación solicitada explícitamente, permiso `fuentes_externas.execute` y gobierno de fuentes      |

La lectura de cotizaciones no expone costo interno, margen ni notas internas. Una cotización aceptada o ganada no prueba por sí misma que el producto se haya comprado o entregado.

## Matriz de operaciones propuestas

El chat puede presentar las operaciones siguientes si el modelo propone una acción válida y el usuario cuenta con los permisos requeridos. Esta matriz describe operaciones propuestas, no una autorización para ejecutarlas automáticamente.

| Operación propuesta                                         | Permiso de dominio para escribir | Condiciones adicionales                                                                                                               |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Proponer una actividad comercial o seguimiento              | `calendario_comercial.update`    | Oportunidad y contacto verificados en la cuenta; requiere también `oportunidades.update`; revisar y guardar manualmente en Calendario |
| Actualizar respuesta de etapa                               | `oportunidades.update`           | Oportunidad de la cuenta; validar estado y reglas de etapa; revisar y confirmar                                                       |
| Actualizar nombre, importe o fecha de cierre de oportunidad | `oportunidades.update`           | Solo campos permitidos; oportunidad abierta y perteneciente a la cuenta; revisar valor vigente y confirmar                            |
| Actualizar campos permitidos de cuenta                      | `cuentas.update`                 | Cuenta seleccionada; campo permitido; revisar valor vigente y confirmar                                                               |
| Actualizar campos permitidos de contacto                    | `contactos.update`               | Contacto vinculado a la cuenta; campo permitido; revisar valor vigente y confirmar                                                    |
| Registrar resultado de llamada de lead                      | `interacciones.update`           | Lead/interacción autorizada y asociada con la cuenta; validar estado; revisar y confirmar                                             |

Las operaciones controladas requieren además `mi_coach.execute`, una entidad identificada sin ambigüedad, validación de alcance en el servidor y la confirmación explícita del vendedor. La API debe ser la autoridad final sobre la elegibilidad y la ejecución.

Una instrucción explícita para cambiar el monto se trata como una operación aunque el planificador la clasifique como consulta. Si la instrucción abarca varias oportunidades y no identifica un único registro, el chat debe pedir que se seleccione o nombre una oportunidad; no debe afirmar que preparó propuestas individuales ni ejecutar cambios masivos.

### Recopilación conversacional de actividades

El planificador IA extrae `activityDraft`: acción (preparar, continuar o descartar), tipo, objetivo, fecha/hora, preferencia temporal, notas y resultado esperado. Recibe el borrador pendiente, el historial reciente, la fecha de referencia del servidor y la zona horaria del negocio. Las referencias CRM se resuelven con candidatos autorizados, no con IDs inventados por el modelo.

Para una actividad de oportunidad con contacto, el servidor verifica el detalle de la oportunidad, la asociación directa del contacto, la cuenta y los permisos. La disponibilidad del contacto, sus preferencias o actividades previas no son requisitos para preparar una propuesta. Una consulta explícita sobre esos hechos sigue pasando por la verificación de evidencia habitual.

Los campos faltantes de la propuesta no son `missingFacts` del CRM. Por ejemplo, "la próxima semana" conserva una preferencia temporal y deja `scheduledAt` pendiente hasta que el vendedor indique día y hora. El servidor pregunta por esos campos sin inventar una cita ni afirmar que el contacto la aceptó.

El primer borrador se persiste en `coach_session_operations` con estado `collecting`; el contexto del chat guarda su referencia. Las respuestas posteriores actualizan la misma operación y la pasan a `ready` al completar los datos. La identidad y versión se comprueban en el servidor, incluso si la IA etiqueta una continuación como preparación. Las operaciones cerradas no se reutilizan. Al reabrir el chat se conserva el acceso al borrador; el botón recupera la versión actual por ID antes de continuar a Calendario. Descartar la propuesta la cancela y no crea ninguna actividad.

Preparar o completar el borrador no guarda una actividad de Calendario. El vendedor abre el formulario oficial, revisa los datos y confirma el guardado manualmente.

### Revisión de respuestas de etapa

Cuando el vendedor aporta información atribuida al cliente, el chat la distingue
de consultas, hipótesis propias y solicitudes explícitas de escritura. La ruta
`opportunity_guidance` permite leer el contexto, pero no implica que se estén
solicitando recomendaciones o actividades. Esta distinción se aplica también
cuando el clasificador usa instrucciones personalizadas.

Una interpretación dedicada recibe el mensaje actual separado del historial y
las preguntas candidatas, sin el objetivo del planificador ni el análisis general
de evidencia CRM. Se ejecuta en la ruta `opportunity_guidance`, no en consultas
factuales de estado, monto, contactos o actividades solo por tener preguntas de
etapa disponibles. Así, una consulta anterior sobre la etapa no convierte el
reporte actual en otra consulta. Una interpretación ausente o inválida se muestra
como error; no se sustituye silenciosamente por recomendaciones.

El reporte se compara semánticamente con las preguntas reales de la etapa actual
de la oportunidad autorizada, incluidas las preguntas sin respuesta y las ya
contestadas; no depende de que readiness tenga una evidencia `stage_answer`.
Una correspondencia única prepara un borrador sin sustituir la respuesta actual.
Si no hay correspondencia clara, hay varias alternativas o el identificador
propuesto no pertenece al contexto autorizado, se solicita precisar la pregunta
y repetir el reporte en lugar de inventar una asociación o recomendar actividades.
Las oportunidades cerradas no generan estos borradores. El reporte conserva su
atribución al cliente y no se presenta como un hecho verificado o guardado en CRM.

El diagnóstico de evidencia incluye `sellerReport`: clase de mensaje, preguntas
candidatas, presencia de respuestas previas, IDs seleccionados o rechazados,
justificación y resultado (`draft_prepared`, `clarification`, `not_a_report`,
`explicit_operation` o `evidence_unavailable`).

El botón "Abrir oportunidad para revisar" abre el formulario de la oportunidad en
una pestaña nueva y mantiene la conversación original. El borrador se transfiere
al `sessionStorage` de la nueva pestaña antes de navegar, sin almacenarlo en
`localStorage`; la pestaña se abre sin acceso a la ventana de origen. El formulario
consume el borrador, agrega el texto a la respuesta vigente y no persiste cambios
hasta que el vendedor pulsa "Guardar cambios". Si el navegador bloquea la apertura
o falla la transferencia del borrador, el chat muestra un error para reintentarlo.

## Comportamiento esperado ante preguntas

| Situación                                                                                     | Comportamiento requerido                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pregunta clara sobre un solo registro                                                         | Consultar ese registro y contestar con los datos devueltos por el CRM autorizado                                                                               |
| Solicitud plural o de listado                                                                 | Devolver la colección que cumpla los filtros; no forzar la selección de un registro individual                                                                 |
| Pregunta sobre varios dominios                                                                | Consultar cada dominio necesario dentro de los permisos y alcance disponibles; separar los resultados por tema                                                 |
| Referencia a un elemento de un turno anterior                                                 | Resolverla contra el contexto conversacional y la cuenta actual; no reutilizar entidades de otra sesión                                                        |
| Varias oportunidades o contactos posibles                                                     | Preguntar cuál registro quiere decir el vendedor antes de dar un dato específico o proponer una escritura                                                      |
| Cambio de monto solicitado para varias oportunidades                                          | Pedir una oportunidad específica; no anunciar propuestas individuales ni aplicar una actualización masiva                                                      |
| Solicitud sobre una cuenta distinta a la seleccionada                                         | Negarse a consultar o actuar sobre esa cuenta e indicar que debe seleccionarse desde la interfaz                                                               |
| Consulta general sin periodo (por ejemplo, listar oportunidades actuales)                     | No inventar un periodo. Usar el conjunto predeterminado que devuelve la consulta autorizada y comunicar su alcance o cualquier truncamiento                    |
| Pregunta que depende de un periodo no especificado (por ejemplo, comparar actividad reciente) | Preguntar el periodo antes de concluir; no inferir fechas a partir de expresiones vagas                                                                        |
| Periodo relativo explícito (por ejemplo, “últimos seis meses”)                                | Resolverlo con la fecha actual del servidor, aplicar el filtro y expresar en la respuesta las fechas efectivas consultadas                                     |
| Sin registros coincidentes                                                                    | Informar que la consulta no devolvió registros con esos filtros; no afirmar que el registro nunca existió si no se consultó el historial completo              |
| Falta de permiso                                                                              | Informar que ese dato no está disponible para el usuario; no insinuar que el dato está vacío o no existe                                                       |
| Error o límite de consulta                                                                    | Informar que no se pudo verificar o que el resultado está limitado; no presentar el fallo como ausencia de datos                                               |
| Evidencia insuficiente o contradictoria                                                       | Separar hechos e inferencias, explicar la limitación y pedir el dato mínimo necesario para continuar                                                           |
| Solicitud de cambio                                                                           | Presentar una propuesta con entidad, campo, valor actual y nuevo valor cuando aplique; no afirmar que está guardada antes de recibir confirmación de ejecución |
| Solicitud de correo                                                                           | Redactar un borrador con los datos autorizados; no enviar el correo automáticamente                                                                            |
| Solicitud de investigación pública                                                            | Ejecutarla solo después de la acción explícita, permiso y validaciones de gobierno; separar sus resultados del CRM                                             |

## Fuera de alcance

- Consultar libremente cualquier cuenta, oportunidad o contacto del CRM.
- Sustituir pantallas o flujos especializados para edición detallada, aprobaciones y administración.
- Leer campos internos de cotización excluidos por la política de datos.
- Consultar casos de soporte o cualquier dominio que no esté incluido explícitamente en la matriz de capacidades de lectura.
- Tratar inferencias, recomendaciones o fuentes públicas como hechos CRM confirmados.
- Ejecutar escrituras, enviar correos o convertir prospectos sin el flujo de permiso y confirmación correspondiente.
- Responder preguntas generales no relacionadas con la cuenta usando conocimiento externo como si proviniera del CRM.

## Criterios de aceptación de esta fase

1. El alcance de una conversación queda fijado a la cuenta seleccionada y no cambia por una instrucción contenida en el texto del usuario.
2. Cada lectura y escritura conserva la validación de permisos de servidor por dominio.
3. Una referencia ambigua no se resuelve escogiendo arbitrariamente una entidad.
4. Una consulta fallida, incompleta o sin permiso se distingue de una consulta válida sin resultados.
5. Hechos CRM, evidencia pública e inferencias se presentan como categorías distintas.
6. Una operación de escritura no se comunica como completada hasta que el servidor confirma su ejecución.
7. Las pruebas de contrato deben cubrir alcance, permisos, ambigüedad, falta de evidencia y confirmación de operaciones antes de ampliar la interpretación del chat.

## Decisiones de alcance acordadas

Las decisiones siguientes fueron confirmadas para esta implementación:

- Una solicitud sobre otra cuenta se rechaza; el usuario debe cambiar la selección en la interfaz.
- Siguen disponibles las propuestas de actividad, respuestas de etapa, resultados de llamadas y cambios permitidos en campos de cuenta, contacto y oportunidad. Todas requieren los permisos del dominio y el flujo de confirmación.
- Las consultas usan el conjunto predeterminado de cada consulta. La respuesta debe declarar el alcance aplicado y avisar si el resultado es parcial o está truncado.
- La investigación pública no participa en respuestas por defecto. Solo puede ejecutarse por acción explícita del usuario, con permiso y sujeto al gobierno de fuentes.
- Los casos de soporte y cualquier dominio no enumerado en la matriz quedan fuera de alcance.

Cuando una lista o historial esté limitado por la consulta, el chat debe identificarlo como un resultado parcial, incluir el rango o criterio aplicado cuando esté disponible y ofrecer acotar o continuar la búsqueda. No debe llamarlo “todos” si no verificó que el resultado esté completo. Las capacidades de escritura aquí enumeradas describen lo que el canal mantiene disponible; no eliminan validaciones de permisos, elegibilidad, alcance o confirmación del servidor.

La continuidad entre turnos conserva por separado del historial visible un resumen tipado y pequeño de entidades y filtros aclarados. Antes de reutilizarlo, el servidor comprueba que pertenece a la misma cuenta y que cada registro sigue presente en el snapshot autorizado y habilitado por la política vigente. Las referencias que no se pueden validar se descartan; una pregunta nueva y explícita prevalece sobre el contexto recordado. Errores y solicitudes de aclaración no reemplazan el último resumen válido. Los periodos de actividad admiten rangos ISO explícitos, días, semanas, meses, años calendario y trimestres, con un máximo de cinco años para rangos absolutos.

La evaluación inicial será sintética hasta que se reúnan ejemplos reales revisados. La muestra sintética valida consistencia frente a escenarios diseñados; no se considerará representativa de todas las preguntas de vendedores.

El corpus, su comando de ejecución, las brechas conocidas y sus limitaciones están documentados en [Evaluación sintética del Chat de Cliente existente](./chat-cliente-existente-evaluacion-sintetica.md).

## Contrato de turno v1: activación controlada

La ruta nueva se selecciona en B3 con `CUSTOMER_TURN_CONTRACT_MODE`:

| Valor | Efecto |
| --- | --- |
| `off` | Conserva la ruta anterior, sin llamadas nuevas del contrato. |
| `pilot` | Solo habilita los IDs de usuario separados por comas en `CUSTOMER_TURN_CONTRACT_PILOT_USER_IDS`. |
| `on` (predeterminado en todos los entornos) | Habilita el contrato para todos los usuarios autorizados del canal. No amplía permisos. |

Ejemplo de piloto: `CUSTOMER_TURN_CONTRACT_MODE=pilot` y
`CUSTOMER_TURN_CONTRACT_PILOT_USER_IDS=31,32`. Reiniciar la API después de cambiar
las variables. Para revertir, establecer `off` y reiniciar: no requiere migraciones
ni modificar prompts almacenados. La memoria nueva se ignora en la ruta anterior.
No se habilita automáticamente un piloto ni se cambia la configuración de usuarios.

### Responsabilidades por bloque

```text
Mensaje + historial + contexto revalidado
  B3: interpretación única -> contrato validado v1 (propósitos + movimiento)
    Coordinador: dependencias, disponibilidad, configuración, permisos, presupuesto
      B6: por componente, resolver referencias opacas y planificar lecturas
        B7/B8: herramientas existentes; misma cuenta, permisos y filtros
          B9: verificador por familia, nunca un segundo clasificador de propósito
            B10: presentar cada resultado sin convertir consultas/reportes en acciones
              B11: persistir contexto, pendientes, resultado e historial
```

- **B3** reconoce 44 categorías aunque una capacidad no esté implementada. El
  catálogo de interpretación no oculta categorías deshabilitadas. La disponibilidad
  se decide después, en el servidor. Identificar una oportunidad por nombre no exige
  demostrar su existencia en B3: B6 resuelve la referencia contra candidatos autorizados.
- El contrato contiene versión, confianza, resolución, movimiento y hasta cuatro
  componentes con IDs únicos (cero para controles como detener o confirmar), categoría, texto, objeto, tema, alcance, referencia,
  atribución, certeza, autorización explícita solicitada, dependencias y
  `continuationOf` (referencia a un componente anterior, nunca un ID CRM).
  Los campos y dependencias se validan con Zod. Pedir cinco ejemplos es un componente,
  no cinco solicitudes. Más de cuatro solicitudes requiere dividir el mensaje.
- **B6** recibe el componente como autoridad: no puede convertir un reporte en una
  actividad ni cambiar el tipo de operación. Las referencias se convierten en IDs
  exclusivamente mediante candidatos del servidor. Las políticas existentes siguen
  intersectando herramientas, tipos de operación, dominio y permisos.
- **B9/consulta y orientación** conserva la verificación de evidencia CRM/pública y
  el control de límites. **B9/reporte** solo verifica el destino y asocia semánticamente
  el reporte con una pregunta de etapa; no vuelve a decidir si era pregunta o reporte,
  ni exige que la información nueva ya exista en CRM. Incluye preguntas sin respuesta
  y preguntas ya respondidas. Las hipótesis propias no se agregan como hechos.
  **B9/contenido** verifica fuentes y audita el borrador; una transformación de texto
  no requiere inventar evidencia CRM. La orientación con lecturas completas trata las
  respuestas vacías como brechas para recomendar, no como un impedimento para orientar.
  **B9/acción** conserva el contrato operativo,
  las comprobaciones de vínculos y las confirmaciones vigentes.
- **B10** usa respuestas deterministas donde ya existen, generación/auditoría de
  contenido para redacción y el generador con evidencia para consultas/orientación.
  La salida incluye `components` con categoría, etiqueta y estado de cada solicitud.
  Los estados distinguen `completed` (atendida, no ejecutada), `clarification`,
  `error`, `unavailable`, `disabled` y `permission_denied`.
- El presupuesto de lecturas, rondas y tiempo es **compartido por todo el turno**,
  no se multiplica por el número de componentes. La deduplicación identifica
  herramienta **y argumentos normalizados**, no solo su nombre.
- No se ejecuta una escritura por decir «sí» o «confirmo» en el chat. Se dirige al
  control de confirmación existente. Los reportes preparan un complemento revisable,
  conservando su texto, atribución e incertidumbre; Guardar cambios sigue siendo manual.

### Catálogo completo y capacidades

`Disponible` describe reconocimiento y uso de herramientas actuales, no garantía
de datos completos. `Parcial` limita objetos, campos o fuentes. Toda operación
requiere habilitación administrativa, elegibilidad y permisos además de confirmación.

| Categoría | Capacidad actual |
| --- | --- |
| `query.account_summary` | Resumen autorizado de cuenta. |
| `query.record_detail` | Parcial: entidades expuestas por las herramientas actuales. |
| `query.field_value` | Parcial: campos disponibles, incluida etapa actual. |
| `query.record_list` | Parcial: registros autorizados y límites vigentes. |
| `query.record_search` | Parcial: filtros y entidades actuales. |
| `query.history` | Parcial: interacciones e historial disponibles. |
| `query.pending_items` | Actividades y pendientes autorizados. |
| `query.relationships` | Parcial: relaciones expuestas por el CRM, no relaciones inferidas. |
| `query.document_content` | Parcial: cotizaciones autorizadas o texto ya extraído de un adjunto aportado; no lector genérico de documentos CRM. |
| `query.stage_readiness` | Requisitos y preparación de etapa. |
| `query.system_help` | No disponible: no hay herramienta de documentación del sistema. |
| `guidance.situation_assessment` | Evaluación con evidencia disponible. |
| `guidance.risks_and_gaps` | Riesgos y brechas, separados de hechos. |
| `guidance.next_steps` | Recomendaciones, sin crear actividades implícitas. |
| `guidance.prioritization` | Parcial: oportunidades autorizadas. |
| `guidance.comparison` | Parcial: oportunidades y datos comparables disponibles. |
| `guidance.trend_analysis` | No disponible: no existe serie histórica comparable de ingresos. |
| `guidance.scenario_analysis` | Parcial: hipótesis explícita, no predicción confirmada. |
| `guidance.strategy` | Estrategia basada en contexto autorizado. |
| `content.email_draft` | Redactar, nunca enviar. |
| `content.message_draft` | Mensaje breve, sin envío. |
| `content.meeting_preparation` | Agenda o guion, sin agendar. |
| `content.discovery_questions` | Preguntas de descubrimiento. |
| `content.summary` | Resumen de material disponible. |
| `content.explanation` | Explicación de contenido o términos comerciales, no consulta externa libre. |
| `content.rewrite` | Reescritura de material aportado. |
| `content.translation` | Traducción de material aportado. |
| `content.value_argument` | Argumento de valor sin métricas inventadas. |
| `report.client_statement` | Reporte atribuido al cliente, incluida una sospecha del cliente. |
| `report.seller_observation` | Observación atribuida al vendedor. |
| `report.interaction_outcome` | Resultado reportado, no registro automático de actividad. |
| `report.commitment` | Compromiso informado, no reunión automáticamente programada. |
| `report.document_evidence` | Parcial: texto documental aportado; no prueba de autenticidad. |
| `report.hypothesis` | Se conserva como hipótesis; no se incorpora como hecho a respuestas de etapa. |
| `action.create_record` | Parcial: contacto u oportunidad, si el tipo está habilitado; no cuentas nuevas. |
| `action.update_fields` | Parcial: campos permitidos de cuenta/contacto/oportunidad. |
| `action.update_stage_answer` | Propuesta de respuesta de etapa con revisión y confirmación. |
| `action.link_records` | Parcial: contacto a oportunidad, con habilitación explícita. |
| `action.schedule_activity` | Borrador de actividad; fecha faltante sigue pendiente. |
| `action.reschedule_activity` | No disponible: no hay operación de edición de actividad existente. |
| `action.record_outcome` | Parcial: resultado de llamada de lead autorizado. |
| `action.change_status` | No disponible en el contrato: usar reglas del módulo correspondiente. |
| `action.remove_record` | No disponible: no se cancela, elimina ni desactiva desde este flujo. |
| `action.send_communication` | No disponible: no se envían comunicaciones. |

### Continuidad y errores

Los 13 movimientos, independientes de las categorías, son:
`new_request`, `answer_clarification`, `select_candidate`, `accept_proposal`,
`confirm_execution`, `modify_draft`, `correct`, `reject`, `discard_draft`,
`continue`, `change_focus`, `request_rationale` y `stop`.

`context_json.turnMemory` conserva el contrato y los componentes pendientes,
revalidado dentro de la cuenta seleccionada. Al seleccionar una pregunta no se
reemplaza el reporte por «la primera». Se preservan los otros componentes pendientes
y sus dependencias. Cambiar explícitamente de tema o detener la solicitud no cancela
registros CRM. Una explicación o confirmación no borra un reporte pendiente.
Varios borradores editables requieren elegir uno antes de preparar cambios; el
resto se conserva. El historial visible también conserva componentes y el enlace
de revisión de etapa, sin guardar el complemento automáticamente.

Los fallos de interpretación (`CUSTOMER_TURN_CONTRACT_INVALID`,
`CUSTOMER_REPORT_TEXT_CHANGED`), asociación (`CUSTOMER_REPORT_ASSOCIATION_INVALID`),
contenido y límites de turno se registran separadamente en las trazas. Un contrato
inválido no activa silenciosamente el flujo anterior. Un permiso denegado no se
presenta como falta de comprensión, ni una consulta fallida como ausencia de datos.

La interpretación y asociación usan muestreo determinista (`temperature=0`, igual
que el clasificador de Coach); las llamadas anteriores conservan su configuración.
Un modelo configurado que no acepte ese parámetro requiere adaptar su cliente
antes de habilitar este piloto. Los adjuntos siguen siendo material no confiable:
se conservan al aclarar la solicitud, pero no se convierten en evidencia CRM ni
pueden añadir instrucciones de sistema.

### Validación y criterio para activar

- Pruebas deterministas: `customer-turn-contract.test.js`,
  `customer-turn-pipeline.test.js`, continuidad, evidencia y suites existentes.
- Evaluación real **opt-in y con costo**:
  `npm run test:customer-chat:contract:live --workspace=apps/api -- --output /ruta/reporte.json`.
  Usa exclusivamente el corpus sintético; no carga clientes, conversaciones,
  prompts de base de datos ni código del repositorio como datos del proveedor.
  Usa el modelo configurado y no registra consumos sintéticos en cuentas de usuarios.
- Umbral del corpus: al menos 95% de 44 categorías con objeto correcto, al menos
  90% de 13 movimientos y 100% de los casos críticos (los cinco ejemplos funcionales,
  pregunta de etapa, reporte, asociación y mensaje compuesto).
- Evaluación real del recorrido completo con snapshot sintético:
  `npm run test:customer-chat:pipeline:live --workspace=apps/api -- --output /ruta/pipeline.json`.
  Exige siete escenarios correctos de B3 a B10: reporte, etapa, orientación,
  listado, correo, reunión y creación reconocida pero deshabilitada por política.
  La confirmación y persistencia de escrituras siguen cubiertas por sus pruebas
  deterministas/de navegador; esta evaluación no escribe registros reales.
- Un corpus sintético no demuestra cobertura de toda conversación posible. Antes de
  habilitar un piloto deben pasar los umbrales y las pruebas de integración; después,
  revisar trazas y errores del piloto sin activar globalmente por defecto.

La ejecución de referencia con `gpt-4.1-mini` alcanzó 43/44 casos con categoría y
objeto correctos, 12/13 movimientos, 9/9 controles críticos y 7/7 recorridos completos
con el proveedor real. Las dos discrepancias restantes fueron objeto
`opportunity` en vez de `quotation` al preguntar por una cotización, y
`new_request` en vez de `change_focus`. La primera conserva el lector autorizado de
cotizaciones; ambos movimientos inician la solicitud nueva sin reutilizar el reporte
pendiente. Cumple el umbral del piloto, no equivale a interpretación perfecta ni a
certificación sobre datos reales. Por decisión expresa del usuario, el código y las
plantillas de entorno usan `on` como valor predeterminado en development, test y
producción, para todos los usuarios autorizados del canal. Una variable explícita
`off` o `pilot` sigue teniendo prioridad. Los despliegues existentes deben recibir
esta versión y reiniciar su API; si ya tienen una variable explícita, deben cambiarla
a `on` para habilitar a todos. Para revertir, establecer
`CUSTOMER_TURN_CONTRACT_MODE=off` y reiniciar la API.
