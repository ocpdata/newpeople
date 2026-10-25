# Registro de correcciones y decisiones vigentes

Memoria de las correcciones del CRM y de los puntos de control por commit.
Su objetivo es conservar el comportamiento acordado y facilitar que una
correccion posterior no deshaga avances anteriores.

## Alcance y uso recomendado

Este registro abarca el CRM completo, incluido el chat de Cliente existente.
Es una practica recomendada, no un requisito obligatorio para hacer commit.
No incorpora hooks, bloqueos, validaciones de CI ni instrucciones automaticas.
Su presencia en Documentacion no garantiza que un asistente lo consulte.

Antes de corregir, se recomienda:

1. Buscar antecedentes por funcionalidad, sintoma y componentes afectados,
   no solo leer la ultima entrada.
2. Identificar las decisiones vigentes relacionadas y sus casos de regresion.
3. Reproducir el problema y distinguir hechos comprobados de hipotesis.
4. Si el cambio contradice una decision anterior, explicar el conflicto y
   solicitar autorizacion antes de sustituirla.

Al terminar, se recomienda registrar el alcance real, las validaciones y
los pendientes. Preservar comportamientos no significa congelar el codigo:
la implementacion puede cambiar si conserva lo acordado.

Los antecedentes incorporados retrospectivamente deben identificar su fuente.
Este documento no es un inventario completo de todas las correcciones previas.
No incluir secretos, credenciales ni datos personales innecesarios.

## Decisiones vigentes

| Referencia | Area | Comportamiento que debe conservarse | Estado de validacion |
| --- | --- | --- | --- |
| COR-001 | Ingreso | La contrasena comienza oculta. El icono permite mostrarla y ocultarla sin enviar el formulario ni cambiar su valor. | Implementada; compilacion verificada; interaccion en navegador pendiente. |
| COR-010 | Consultas de Cliente existente | Las consultas y analisis se responden desde un expediente de evidencia con citas verificables; las acciones conservan sus contratos estrictos. COR-002 a COR-009 quedan descartadas. | Decision aprobada; fases 0, 1 y 2 completadas; motor activo para todos los usuarios. |
| COR-011 | Acciones de actividad en Cliente existente | Una respuesta breve a «¿a qué oportunidad?» o la fecha/hora de un borrador abierto completan la actividad recordada sin reinterpretarse como solicitud nueva. La oportunidad del selector es el destino de la acción. Si falta la oportunidad, se ofrecen opciones. | Implementada; pruebas unitarias y conversaciones reales verificadas. |
| COR-012 | Pestaña Pruebas y verificación del motor de consultas | Las respuestas del motor de expedientes se evalúan por su verificación propia y su contenido, no por el formato del chat anterior. IDs de evidencia con texto pegado se limpian sin aceptar IDs inexistentes; totales y conteos se verifican; no se muestran términos internos; las peticiones breves se respetan. | Implementada; 8 de 9 casos Q01–Q03 en revisión humana y el noveno corregido en el evaluador. |
| COR-013 | Catálogo completo de la pestaña Pruebas | Las consultas se enrutan con un modelo capaz; la cuenta incluye actividades en todos los estados; los correos solos se redactan y en pedidos de varias tareas se pregunta el propósito; la biblioteca excluida no se consulta; el adjunto faltante se pide; eliminar o enviar se reconocen como límite; «sin incluir costos» es una exclusión. El evaluador verifica el motor nuevo por contenido. | Implementada; verificada en vivo salvo 4 casos del recorrido anterior (ver entrada). |
| COR-014 | Migración total: fase A | Contratos del plan del turno y del estado unificado; tareas observadas comunes a ambos recorridos; evaluador independiente de las categorías del recorrido anterior. | Implementada; mismos veredictos que el evaluador anterior en 471 pasos re-evaluados. |
| COR-015 | Migración total: fase A1 | El expediente incluye perfil y responsables de la cuenta, espacio de trabajo de la oportunidad, interacciones de cuenta, leads, campañas, calendario de cuenta, registros ante el fabricante y propuestas, con permisos y gobernanza por fuente. | Implementada; banco 22/23 con 0 afirmaciones prohibidas. |
| COR-016 | Migración total: fase B | El enrutador es la única interpretación del turno: consultas y límites en el motor nuevo; redacción, documentos y acciones llevan el plan al recorrido anterior, donde B3 solo completa especificaciones y el código alinea el contrato con el plan, sin revisor de IA. | Implementada; banco 21/23 y las 2 conversaciones fallidas pasan al repetirlas; Pruebas dirigidas 58/70 en la primera corrida, pendientes asignados a fases C y D y casos de biblioteca bloqueados por el límite mensual de Pinecone. |
| COR-017 | Migración total: fase C | Las redacciones sin biblioteca ni adjunto las prepara el redactor del motor nuevo; el código arma el texto y verifica asunto, saludo, duración de agendas, cantidad de preguntas, fidelidad al texto aportado, incertidumbre, exclusión de precios y que no se afirmen envíos. Las llamadas al proveedor de IA usan streaming para no ser cortadas por el gateway. | Implementada; 34/34 casos de redacción y 29/29 de acciones y mezclas en revisión humana; banco 22/23. |

## Registro de correcciones

Usar identificadores consecutivos `COR-001`, `COR-002`, etc. Una correccion
puede abarcar varios commits; un commit puede incluir varias correcciones.
Agregar nuevas entradas sin eliminar las anteriores.

### COR-001 - Mostrar y ocultar contrasena en el ingreso

- **Fecha:** 2026-10-23.
- **Origen:** solicitud del usuario en esta sesion; registro retrospectivo
  del commit `5d85a71`, `Add password visibility toggle to login`.
- **Problema:** el campo de contrasena de inicio de sesion no tenia un
  control para consultar visualmente el valor escrito.
- **Escenario:** abrir el ingreso, escribir una contrasena y alternar el
  control de visibilidad.
- **Comportamiento esperado:** comenzar con el valor oculto; mostrarlo al
  pulsar el ojo y ocultarlo al pulsar de nuevo, conservando el valor y sin
  enviar el formulario.
- **Causa identificada:** el campo usaba un tipo fijo `password` y no tenia
  estado ni control de visibilidad.
- **Cambio realizado:** estado local, iconos de ojo y ojo tachado, boton
  `type="button"`, etiqueta accesible que describe la accion y estilos junto
  al campo. Se agrego `autocomplete="current-password"`.
- **Componentes:** [AuthPages.jsx](../apps/web/src/AuthPages.jsx) e
  [index.css](../apps/web/src/index.css).
- **Fuera de alcance:** registro inicial, configuracion de contrasena y
  autenticacion de la API.
- **Antecedentes revisados:** control Mostrar/Ocultar de la configuracion de
  contrasena y estilos existentes. No habia un registro previo de correcciones.
- **Comportamientos a preservar:** ingreso con correo y contrasena,
  validacion del campo requerido, acceso con Google y controles existentes
  de configuracion de contrasena.
- **Validacion realizada:** `npm run build --prefix apps/web` termino
  correctamente con advertencia de tamano de chunks; `git diff --check`
  no encontro errores de espacios.
- **Limitaciones:** el lint de `AuthPages.jsx` reporto dos errores en codigo
  preexistente: estado actualizado sincronicamente en un efecto y variable
  `error` sin usar en un `catch`. No se ejecuto una prueba de interaccion
  en navegador ni se verificaron funcionalmente los flujos de autenticacion.
- **Estado:** implementada; validacion funcional pendiente.

### COR-002 a COR-009 - Correcciones descartadas del chat de Cliente existente

- **Fecha:** 2026-10-23.
- **Estado:** descartadas a solicitud del usuario. Nunca tuvieron commit; los
  cambios sin commit se revirtieron. Sus identificadores no deben reutilizarse.
- **Que intentaron:**

| ID | Intento | Por que no basto |
| --- | --- | --- |
| COR-002 | Retirar sobrescrituras lexicas para que la IA decida la interpretacion. | La IA siguio eligiendo categorias que no leian la evidencia necesaria. |
| COR-003 | Limitar la explicacion del revisor B3 para no exceder el esquema. | Corregia un fallo tecnico del revisor, no la interpretacion. |
| COR-004 | Presentar actividades en lenguaje comercial con evidencia desplegable. | Mejoraba la redaccion; no la cobertura de fuentes. |
| COR-005 | Reparar con IA un reporte rechazado por no ser literal. | Excepcion para un tipo de error de clasificacion. |
| COR-006 | Auditoria semantica general de cifras y fechas en B10. | La auditoria solo contrasta con lo leido, no con lo que existe en CRM. |
| COR-007 | Reparacion de estructura y regla "verificaciones no son ranking G04". | La regla quedo en el prompt y el modelo la ignoro en el caso real (job 200). |
| COR-008 | Distinguir fechas de hechos de vencimientos y contar exclusiones. | El modelo repitio el filtro erroneo (job 197). |
| COR-009 | Revisor IA temporal especializado y barrera de ausencia. | Resolvio ese caso (job 199) pero agrego otro revisor especifico. |

- **Diagnostico comun:** cada correccion trato un sintoma de la misma causa.
  Ver COR-010.
- **Lecciones que deben conservarse:**
  - No agregar reglas puntuales al prompt de interpretacion por cada fallo:
    con ~20 000 tokens y `gpt-4.1-mini` no se cumplen de forma fiable.
  - No agregar revisores IA especializados por tipo de confusion.
  - No declarar una correccion resuelta solo con pruebas simuladas: exigir la
    conversacion completa con proveedor real y hechos del CRM.
  - Una actividad pendiente puede tener una nota que describe un avance; una
    orden prevista no es una orden recibida; un cargo no acredita autoridad.
  - Registros excluidos por un filtro no equivalen a ausencia.
- **Copia de referencia:** se conservo fuera del repositorio, en el espacio
  de la sesion de trabajo, solo como consulta.

### COR-010 - Expediente de evidencia y analista con citas para consultas

- **Fecha:** 2026-10-23.
- **Origen:** analisis de la arquitectura B1-B12 a partir de la sesion 61
  (jobs 198-201) y decision del usuario.
- **Problema:** las consultas se clasifican en una de 46 categorias; cada una
  ejecuta una receta que decide de antemano que datos lee. Una categoria
  equivocada, o una receta sin la fuente necesaria, produce respuestas
  incompletas o falsas aunque el resto funcione.
- **Causas comprobadas:**
  - El chat solo carga las respuestas de la etapa actual: las respuestas de
    etapas anteriores (necesidad, presupuesto, aprobacion, fecha objetivo)
    no le llegan. La consulta ademas convierte un error de base de datos en
    una lista vacia.
  - `query.account_summary` no lee cotizaciones, notas ni fecha de cierre.
  - Prompt de interpretacion de ~72 700 caracteres con 305 prohibiciones
    ejecutado por `gpt-4.1-mini`; el revisor usa el mismo modelo y catalogo.
  - Auditorias que verifican coherencia con lo leido, no cobertura.
  - Sin prueba de aceptacion de conversaciones reales de varios turnos.
- **Decisiones del usuario:**
  1. Cambiar el enfoque a expediente de evidencia mas analista con citas,
     solo para consultas y analisis. Las acciones se mantienen como estan.
  2. Usar un modelo mas capaz en el CRM para el analista.
  3. Eliminar los cambios sin commit de COR-002 a COR-009.
  4. Agregar un selector de oportunidad en el chat, permitiendo tambien
     trabajar sin oportunidad seleccionada.
- **Diseno:** [diseno-consultas-expediente-cliente-existente.md](./diseno-consultas-expediente-cliente-existente.md).
- **Fase 0 (2026-10-23):** banco de aceptacion con 5 conversaciones, 17 turnos
  y 51 hechos del CRM verificados contra la base. Linea base del sistema
  actual: 0/17 turnos aprobados y 7/42 hechos criticos presentes, con 11
  ausencias falsas. Detalle en la seccion 12 del diseno.
- **Cambio de configuracion autorizado:** tarifa de `gpt-6-astra` registrada en
  `ai_pricing_rates` (id 3) para el evaluador del banco.
- **Cambio de codigo compartido:** parametro opcional `model` en el cliente de
  IA estructurada; sin el parametro se mantiene el modelo configurado.
- **Validacion:** 14 pruebas del banco y una prueba nueva del cliente de IA
  pasan. Las 4 fallas de `structured-web-research.test.js` ya existian en el
  commit `5d85a71`, comprobado en una copia aislada.
- **Fase 1 (2026-10-23):** expediente de oportunidad y de cuenta construido
  por codigo, en solo lectura y con los permisos actuales del chat. Cada
  seccion declara su estado (cargada, vacia, restringida, truncada o
  fallida) y cada dato lleva su significado. Contiene los 51 hechos del banco
  (40/40 criticos); ocupa entre 7 500 y 12 000 tokens por oportunidad.
  14 pruebas nuevas pasan. Aun no esta conectado al chat. Se corrigio el
  hecho del banco sobre la orden de compra: la del cliente esta en
  `quotation_won_documents`, no en las ordenes a proveedores.
- **Fase 2 (2026-10-24):** enrutador (`gpt-4.1-mini`), analista con citas,
  verificacion por codigo con una reparacion, integracion en el chat detras
  de `CUSTOMER_DOSSIER_ENGINE_MODE` (por defecto `off`), selector de
  oportunidad y evidencia citada en la interfaz. Banco con `gpt-6.1-sol`
  como analista: 16/17 turnos aprobados y 41/42 hechos criticos (linea base
  0/17 y 7/42), sin afirmaciones prohibidas ni aclaraciones innecesarias;
  mediana de 21-25 s. Se descartaron `gpt-5.6-sol`, por menor calidad, y
  `gpt-6-astra`, por errores del proveedor y lentitud.
- **Cambios de configuracion autorizados (fase 2):** tarifas de
  `gpt-6.1-sol` (id 4) y `gpt-5.6-sol` (id 5); credito de 10 USD a la
  billetera de IA del usuario 1 para la medicion.
- **Validacion fase 2:** 22 pruebas del motor, 15 del expediente y 14 del
  banco; una prueba de navegador nueva y dos vecinas pasan. Las suites
  existentes de los modulos tocados dan el mismo resultado que el commit
  `5d85a71` (1 719 pasan; las mismas 10 fallas previas).
- **Estado:** fases 0, 1 y 2 completadas. Por decision del usuario es una
  aplicacion nueva para todos: el motor queda activo por defecto, sin piloto,
  con `gpt-6.1-sol` (esfuerzo `low`) y respetando las herramientas
  habilitadas en la gobernanza del canal. `off` queda solo como interruptor
  de emergencia.

### COR-011 - Continuidad de acciones de actividad (2026-10-24)

- **Solicitud y problema observado:** tras «Agenda una llamada con Daniel el
  martes» con «Toda la cuenta», el chat preguntó la oportunidad; la respuesta
  «a sealpath» se reinterpretó como nueva consulta y devolvió la lista de
  oportunidades, perdiendo la llamada. Al reproducirlo, la misma respuesta
  también terminó en «contrato de turno inválido», y «a las 10 de la mañana»
  se interpretó como reprogramación de otra actividad.
- **Causa:** el recorrido de acciones volvía a clasificar con IA cada
  respuesta breve en lugar de usar el estado pendiente; además, el borrador
  solo aceptaba la oportunidad resuelta por el planificador e ignoraba la
  seleccionada, por lo que preguntaba aun con una oportunidad elegida.
- **Cambio:**
  - `pending-activity-target.js`: resuelve sin IA la oportunidad de una
    actividad recordada (nombre completo o palabras del nombre; si no hay una
    sola coincidencia, ofrece opciones) y la fecha y hora de un borrador
    abierto (días de la semana, hoy, mañana, ayer, fechas y horas habituales;
    toma el día dicho antes en la conversación si la respuesta solo trae la
    hora). Rechaza horas pasadas para actividades programadas.
  - `activity-draft.js`: usa la oportunidad seleccionada cuando la solicitud
    no nombra otra; usa los datos autorizados del snapshot solo si no se
    intentó leer la oportunidad (una lectura fallida nunca se sustituye).
  - `service.js`: aplica lo anterior antes de la clasificación heredada, pasa
    la oportunidad del selector a las acciones y adjunta opciones a la
    aclaración de oportunidad.
  - Interfaz: botones con las oportunidades en la última aclaración.
- **Fuera de alcance:** otras acciones (reprogramar, actualizar importe,
  resultados) siguen en el recorrido actual; las horas sin «mañana/tarde» de
  1 a 6 se interpretan como de la tarde y se muestran antes de confirmar.
- **Validacion:** 13 pruebas nuevas en `customer-pending-activity.test.js` y
  las de `customer-activity-draft.test.js` pasan. Conversaciones reales en
  Grupo Diestra: «a sealpath», «la de seguridad», «la otra» (opciones),
  selector en Sealpath y «a las 10 de la mañana» / «a las 4 de la tarde»
  generan el borrador correcto para el martes 2026-10-27. Las suites del chat
  dan las mismas fallas que el commit `36c16cc`; `customer-chat-diagnostics`
  fija el motor de consultas en `off` porque prueba el recorrido heredado.
  Los borradores creados en las pruebas se cancelaron.
- **Estado:** implementada.

### COR-012 - Pestaña Pruebas con el motor de expedientes (2026-10-24)

- **Problema observado:** los casos Q01-01 a Q03-03 de la pestaña Pruebas
  salían fallidos aunque el chat respondía.
- **Causas:**
  - El evaluador exigía la redacción auditada por B10, la evidencia
    `searchContacts` y frases literales del chat anterior; el motor nuevo no
    produce ese formato.
  - Los avisos «No pude verificar por completo» venían de IDs de evidencia
    con texto pegado por el modelo (`opp94 trunc`, `contact139 ponder`,
    `contact139殊contact109`); la reparación repetía el fallo.
  - Respuestas con la palabra «expediente» y un brief demasiado largo para
    «tengo dos minutos».
  - La referencia de Totalplay estaba desactualizada (decía 8 «En proceso»
    por USD 4.510.000; hoy son 6 por USD 4.310.000 y 7 «Ganada»).
- **Cambio:**
  - Verificador: limpieza de IDs (solo conserva IDs existentes), valores
    `count` y `amount_total`, revisión de presentación (términos internos,
    longitud y títulos si `responseLength=brief`).
  - Enrutador: campo `responseLength` (brief, standard, detailed).
  - Analista: reglas de IDs, ausencias por sección, totales, brevedad y
    vocabulario.
  - Motor: la reparación de presentación no degrada la respuesta ni pierde
    la verificación factual; la respuesta incluye `dossierSources`.
  - Evaluador (`checks.js`): para el motor nuevo, «Respuesta verificada con
    registros del CRM» sustituye a la de B10; la búsqueda de contactos se
    acredita con la lectura completa de contactos; Q01-01 y Q01-02 se
    evalúan por contenido (contacto real, ganadas frente a en proceso, sin
    presentar oportunidades abiertas como ventas, pendiente, siguiente paso,
    longitud); «no figura» y «no consta» cuentan como ausencia; la
    protección contra cargos inventados solo detecta un campo «Cargo:» al
    inicio de línea. Las revisiones del chat anterior no cambian.
  - Referencia de Totalplay actualizada en
    `preguntas-validacion-chat-cliente-existente.md`.
- **Validacion:** pruebas nuevas del verificador, del motor y del
  evaluador. Corrida real de los 9 casos: 8 en revisión humana a la
  primera; Q03-03 falló solo por la regla de «cargo:», que se corrigió, y al
  volver a evaluar la misma respuesta queda en revisión humana. Las suites
  relacionadas solo conservan las 2 fallas previas de «B3 timeout».
- **Pendientes:** los demás casos del catálogo que dependen de componentes
  o campos del chat anterior pueden necesitar la misma adaptación.
- **Estado:** implementada.

### COR-013 - Revisión del catálogo completo de Pruebas (2026-10-24/25)

- **Solicitud:** revisar los 203 casos restantes de la pestaña Pruebas y
  corregir el evaluador (A), el motor nuevo (B) y el recorrido anterior (C).
- **Hallazgos de entorno:**
  - Una instancia en la nube (`newpip.digitalvs.com`) usa la misma base de
    datos con código anterior; su worker tomaba y cortaba las corridas.
  - Las conexiones inactivas a MySQL (remoto en AWS) se cortaban; el worker
    perdía el bloqueo `GET_LOCK` y la corrida se marcaba interrumpida.
  - Se activó keepalive y reciclaje de conexiones inactivas en el pool
    (`config.js`), y el worker mantiene viva la sesión del bloqueo.
  - Algunas llamadas a OpenAI devolvieron 504 con la página de bloqueo de un
    firewall F5 intermedio.
- **Motor nuevo (B):**
  - Enrutador con `gpt-6.1-sol` (esfuerzo bajo): con `gpt-4.1-mini` aplicaba
    las reglas de forma inconsistente. Reglas: biblioteca, manuales y
    partidas de cotización van al lector de documentos; preguntas generales
    sin datos del cliente van a contenido; preparar una actividad aunque diga
    «no guardes» es acción; los principios se responden sin pedir oportunidad.
  - Expediente de cuenta con `accountActivities` (todos los estados). Un
    mismo registro puede aparecer en dos secciones del índice de evidencia.
  - La traza guarda `dossierFailure` con la causa resumida del fallo.
- **Recorrido anterior (C):**
  - Correo solo: se redacta (con marcadores si falta el propósito). En un
    pedido de varias tareas, sin propósito, se pregunta para no agotar el
    presupuesto de lecturas compartido (caso MIX04).
  - La biblioteca no se consulta si el vendedor la excluye explícitamente.
  - Un adjunto faltante se pide en lugar de declarar la capacidad no
    disponible.
  - El revisor de B3 ya no rechaza eliminar o enviar por no ser ejecutables.
  - Un reporte parafraseado por B3 recibe un reintento con la regla concreta.
  - B3: las preguntas basadas en la biblioteca no llevan componentes de
    apoyo; los manuales del sistema son ayuda del sistema.
- **Evaluador (A):** verificaciones por contenido para el motor nuevo (Q06,
  Q07, Q08-02, Q08-03, Q10-01, notas/detalle/campo), fechas en rangos o días
  sueltos, equivalentes de significado (Q10-02, Q08-03), A10-03 como control
  de redacción y L06 bloqueado por datos vigentes (ya no hay Waiting «En
  proceso»). La referencia guarda las actividades de cada oportunidad con
  fechas ISO (`evaluatorVersion` 6).
- **Ajustes finales:** el analista conserva la fecha registrada de cada
  actividad en historiales (Q06-02); el lector de cotizaciones reconoce
  «sin incluir», «excluyendo» y «omitiendo» como exclusión de costos (MIX07).
- **Resultados:** corrida completa de 212 casos tras B: 185 en revisión
  humana, 11 fallidos (antes 28). Verificación dirigida de 29 casos tras A y
  C (repetida con crédito en OpenAI): 23 en revisión humana; tras los
  ajustes finales también pasan Q06-02 y MIX07.
- **Pendientes del recorrido anterior (B3, no deterministas):**
  - Q09-01: B3 a veces clasifica la pregunta de cantidades como resumen; la
    respuesta es correcta, pero sin el desglose determinista por partida.
  - Q11-02: B3 sigue tratando el manual de Mi Coach como consulta a la
    biblioteca pese a la regla de ayuda del sistema.
  - MIX09: categorías correctas, pero las preguntas no pasan por la
    validación de cantidad.
  - SEQ15 (paso 2): B3 pierde «solo dos» y «sin biblioteca» al reescribir la
    tarea; el revisor la rechaza y se pide aclaración. Una regla adicional en
    B3 no lo resolvió y se revirtió.
- **Estado:** implementada; verificada salvo los pendientes indicados.

### COR-014 - Migración total al motor de expedientes: fase A (2026-10-25)

- **Contexto:** diseño aprobado en
  [diseno-migracion-total-motor-expedientes.md](./diseno-migracion-total-motor-expedientes.md).
- **Cambio:** `dossier/turn-plan.js` (contrato y validación del plan del
  turno), `dossier/conversation-state.js` (estado unificado y conversión
  desde las memorias actuales), `dossier/observed-tasks.js` (tareas
  observadas de ambos recorridos), `turnTasks` en las respuestas del motor
  nuevo y evaluador basado en tareas observadas.
- **Validación:** pruebas nuevas en `customer-turn-plan.test.js`; las del
  evaluador y del motor pasan. Re-evaluación sin costo de las respuestas
  guardadas de tres corridas: 471 pasos con veredicto idéntico al evaluador
  anterior.
- **Sin cambio visible:** los contratos aún no deciden el turno.
- **Estado:** implementada.

### COR-015 - Migración total: fase A1, expediente completo (2026-10-25)

- **Solicitud:** el expediente no leía el perfil de la cuenta, el espacio de
  trabajo de la oportunidad, interacciones de cuenta, leads, campañas,
  calendario de cuenta, registros ante el fabricante ni propuestas.
- **Cambio:** `dossier/extended-sections.js` y su integración en el
  expediente, con significados, permisos, gobernanza, citas legibles y
  términos internos nuevos en el verificador. Banco con hechos y preguntas
  nuevas; el verificador de hechos admite ubicar en el expediente un dato
  guardado como ID (sector, responsable).
- **Hallazgo:** formatear en la base las fechas de registros ante el
  fabricante daba un día menos (la aplicación guarda la medianoche UTC del
  día elegido); se leen igual que en el módulo de registros.
- **Validación:** pruebas unitarias nuevas; 62/62 hechos en la base y en el
  expediente; banco en vivo 22/23 (R3, caso conocido). Los criterios de X3 y
  Y1 se ajustaron tras la primera evaluación porque pedían datos que la
  pregunta no solicitaba (registrado en el diseño).
- **Estado:** implementada.


### COR-016 - Migración total: fase B, enrutador como única puerta (2026-10-25)

- **Problema:** el enrutador y B3 interpretaban por separado el mismo
  mensaje; cuando discrepaban, el revisor de B3 pedía aclaraciones («no pude
  conciliar») o se perdían restricciones.
- **Corrección:** el enrutador produce el plan del turno y el código deriva la
  ruta. Consultas y límites se resuelven en el motor nuevo (los límites con
  mensajes fijos, también mezclados con consultas). Los turnos de redacción,
  documento y acción llevan el plan a B3, que devuelve un componente por
  tarea con las categorías permitidas; el código compara contrato y plan,
  pide una corrección y después alinea (`dossier/plan-alignment.js`). Se
  retiró el revisor de IA en ese camino. La ayuda del sistema queda lista
  para enlazar la documentación (`SYSTEM_DOCUMENTATION_URL`).
- **Ajustes tras verificar en vivo:** «qué cotización tiene» es consulta del
  registro, no lectura del documento; el texto de los componentes conserva el
  material aportado para resumir o traducir; una restricción sin cita tras el
  reintento ya no hace fallar el turno; el error de cuota de Pinecone se
  informa con su mensaje.
- **Validación:** pruebas nuevas del plan, la ruta, los límites y la
  alineación; suite completa sin regresiones frente a HEAD (las 140 fallas
  existentes son las mismas). Banco 21/23 en la corrida completa;
  FOCUS-SEALPATH y DIESTRA-ACCOUNT pasan completas al repetirlas. Pruebas dirigidas: 58/70 en
  revisión humana en la primera corrida; tras las correcciones pasan C01-03,
  C05-01, C08-01 y SEQ06.
- **Pendientes:** Q09-01 (fase D), C05-03 y transformaciones encadenadas
  (fase C); MIX09, SEQ11, SEQ13 y SEQ15 sin validar por el límite mensual de
  tokens de contexto de Pinecone Assistant.

### COR-017 - Migración total: fase C, redactor en el motor nuevo (2026-10-25)

- **Problema:** las redacciones pasaban por B3, la generación de contenido y
  su auditor (B9) y la presentación auditada (B10). El auditor rechazaba
  resúmenes y traducciones correctas de texto aportado y las transformaciones
  encadenadas respondían «No hay un único borrador vigente».
- **Corrección:** el plan indica el material de cada tarea; el redactor del
  motor nuevo produce entregables estructurados y el código arma y verifica
  el texto (reglas del §4.5 del diseño). Las redacciones con biblioteca o
  adjunto siguen en el recorrido anterior hasta la fase D. Preparar el
  contenido de una reunión ya no se interpreta como agendarla.
- **Infraestructura:** el gateway de OpenAI configurado corta a ~30 s las
  peticiones sin primer byte; las llamadas se piden en streaming
  (`OPENAI_STREAM_RESPONSES=true` por defecto) y se lee el evento final. Un
  flujo sin datos durante 60 s se aborta como fallo transitorio
  (`OPENAI_STREAM_IDLE_TIMEOUT_MS`) y el enrutador lo reintenta una vez.
- **Validación:** pruebas del redactor, del motor con redacción y consulta en
  el mismo turno, y del streaming; sin regresiones frente a HEAD. Pruebas
  dirigidas: 34/34 en revisión humana (MIX05 tras activar streaming) y 29/29
  acciones, límites, secuencias y mezclas. Banco 22/23 (R1, omisión del
  analista sobre cotizaciones).
- **Pendientes:** retirar B9 y su auditor con la fase D.
### Plantilla para la siguiente correccion

Copiar estos campos en una nueva entrada con su ID definitivo:

- **ID, titulo y fecha:**
- **Solicitud y problema observado:**
- **Escenario de reproduccion:**
- **Comportamiento esperado:**
- **Causa identificada o hipotesis pendiente:**
- **Cambio realizado y componentes afectados:**
- **Fuera de alcance:**
- **Correcciones y decisiones anteriores revisadas:**
- **Comportamientos que deben conservarse y casos de regresion:**
- **Validacion realizada y resultados:**
- **Pendientes, limitaciones y aspectos no verificados:**
- **Referencias a commits, pruebas y documentacion:**
- **Estado:** propuesta, implementada, verificada o sustituida.
- **Relacion con otras correcciones y autorizacion, si aplica:**

Una compilacion correcta no acredita por si sola la validacion funcional.
Marcar una correccion como verificada solo cuando se haya comprobado su
comportamiento esperado y las regresiones relacionadas, indicando el alcance.

Para el chat de Cliente existente, registrar tambien los mensajes anteriores
necesarios para reproducir el caso, cuenta y oportunidad cuando corresponda,
respuesta observada y esperada, permisos relevantes y fuentes de evidencia.
Distinguir consulta, propuesta y operacion confirmada; no presentar inferencias
como hechos CRM ni propuestas como cambios ejecutados.

## Puntos de control por commit

Cada punto de control describe hasta donde llego el trabajo: que quedo listo,
que se comprobo y que falta. No sustituye el detalle de cada correccion.

Se recomienda preparar la entrada junto con el cambio e incluir ambos en el
mismo commit. Usar un identificador `HITO-001`, `HITO-002`, etc. tanto en esta
entrada como en el mensaje del commit para relacionarlos desde el historial Git.
Esta convencion no es obligatoria.

El hash del propio commit no se conoce hasta crearlo. No intentar escribirlo
en el mismo contenido que lo genera, ni crear otro commit solo para agregarlo.
Los hitos retrospectivos pueden citar hashes ya existentes.

### HITO-001 - Control de visibilidad de contrasena

- **Fecha:** 2026-10-23.
- **Referencia:** registro retrospectivo del commit `5d85a71`. Su mensaje
  original no incluye este ID porque el registro se creo despues.
- **Objetivo y correcciones:** facilitar la revision del valor escrito en
  el ingreso; COR-001.
- **Alcance alcanzado:** control implementado en el formulario y sus estilos;
  commit subido a `origin/main` durante esta sesion.
- **Validacion:** compilacion web correcta y revision de espacios sin errores.
- **Pendientes:** prueba funcional del control y comprobacion de los flujos
  de ingreso; lint con los dos errores preexistentes descritos en COR-001.
- **Comportamientos protegidos:** los enumerados en COR-001; preservacion
  prevista por el alcance del cambio, no acreditada mediante prueba funcional.

### Plantilla para el siguiente punto de control

- **ID, fecha y objetivo:**
- **Correcciones incluidas:**
- **Alcance alcanzado y utilizable:**
- **Validaciones y resultados:**
- **Pendientes y limitaciones para continuar:**
- **Decisiones anteriores revisadas y evidencia de preservacion:**
- **Referencia Git:** ID compartido con el mensaje; hash si es retrospectivo.

La creacion de este registro y su enlace en el indice aun no tienen commit
al redactar esta version. No se presentan como un hito ya confirmado en Git.

## Decisiones sustituidas

COR-002 a COR-009 fueron descartadas y sustituidas por la decision de enfoque
COR-010 a solicitud del usuario. Se conserva su resumen y sus lecciones.

Cuando una decision cambie, conservar la entrada original, marcarla como
sustituida e indicar la nueva referencia, el motivo, la autorizacion recibida
y la validacion del cambio. Actualizar la tabla de decisiones vigentes para
que no presente ambas reglas como aplicables al mismo tiempo.
