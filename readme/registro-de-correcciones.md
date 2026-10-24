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
