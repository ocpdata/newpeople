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
