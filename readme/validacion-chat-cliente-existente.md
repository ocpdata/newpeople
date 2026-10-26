# Validación del chat de Cliente existente

## Objetivo

La matriz detallada de alcance y aceptación incluida en este documento
desarrolla las 46 categorías, los escenarios transversales
y los criterios propuestos para convertir este análisis en casos de evaluación.
El campo «Actual» distingue lo implementado dentro de cada alcance de las
ampliaciones propuestas. La implementación no equivale a aceptación con
proveedor real; los escenarios siguen pendientes de esa validación.

El nuevo [catálogo de preguntas, contexto y respuestas esperadas](./preguntas-validacion-chat-cliente-existente.md)
desarrolla los casos con información real de la aplicación e identifica las
precondiciones y brechas pendientes. Es una propuesta aún no ejecutada.

La validación se plantea para el lanzamiento de una aplicación nueva, no como
un piloto. Debe comprobarse el alcance aprobado para la primera versión antes
de poner el chat a disposición de los vendedores.

Esta guía consolida la arquitectura, las definiciones de las categorías y
el plan recomendado para una nueva validación del chat de Cliente existente en
Mi Coach con preguntas representativas de vendedores. No incluye resultados
de ejecuciones anteriores ni considera aprobados los escenarios de la matriz.

La validación mide interpretación, recuperación de evidencia, calidad de
respuesta, continuidad entre turnos, permisos y operación. No amplía el alcance
del chat ni sustituye los permisos del servidor. Las pruebas con proveedor real
son opt-in y pueden generar costo.

## Resumen ejecutivo

El chat ya cuenta con controles importantes: limita cada conversación a la
cuenta seleccionada, revalida el contexto antes de reutilizarlo, filtra las
lecturas por permisos y políticas del servidor, verifica evidencia y presenta
las escrituras como propuestas sujetas a revisión y confirmación.

El contrato reconoce 46 categorías de propósito. Esa amplitud describe lo que el sistema puede interpretar;
no demuestra que el modelo clasifique correctamente todas las formas en que
pregunta un vendedor ni que las respuestas sean siempre útiles.

## Matriz consolidada de implementación

Las preguntas pueden ejecutarse desde **Mi Coach > Pruebas del chat**, con
historial persistente y permisos administrativos separados. Véanse las
[instrucciones y límites del ejecutor](./preguntas-validacion-chat-cliente-existente.md#ejecución-automática-desde-mi-coach).
La automatización no sustituye la revisión semántica ni acredita una aceptación
con IA real que todavía no se ha ejecutado.

Actualizada tras completar A08. «Existente» significa implementado dentro del
alcance aprobado de cada categoría, sujeto a permisos y habilitación; no
equivale a aceptación con proveedor real de IA y vendedores ni a disponibilidad
universal.

| Grupo | Categorías existentes | Existentes | Parciales | Ausentes |
| --- | --- | ---: | ---: | ---: |
| Consultas | Q01–Q10, Q12 | 11 | 0 | 1 (Q11) |
| Orientación comercial | G01–G08 | 8 | 0 | 0 |
| Contenido | C01–C09 | 9 | 0 | 0 |
| Reportes | R01–R06 | 6 | 0 | 0 |
| Acciones controladas | A01–A08, A11 | 9 | 0 | 2 (A09, A10) |
| **Total** | **46 categorías** | **43** | **0** | **3** |

| Categoría pendiente | Capacidad ausente |
| --- | --- |
| Q11 | Ayuda para usar el sistema mediante una herramienta de documentación. |
| A09 | Eliminación, cancelación o desactivación de registros desde este flujo. |
| A10 | Envío de comunicaciones desde el chat. |

A07 pasa de **Parcial** a **Existente**: preparación versionada del resultado de
una llamada de lead, catálogo compartido, requisitos condicionales y revisión y
confirmación transaccional en Mi Coach. No incluye resultados masivos ni
creaciones implícitas. La aceptación con proveedor real y vendedores permanece
pendiente para el alcance implementado.

A08 pasa de **Ausente** a **Existente en su alcance aprobado**: preparar y
trasladar a Oportunidades la validación del avance a la siguiente etapa de una
oportunidad. El vendedor la solicita explícitamente en el módulo; se reutiliza
su validador actual, incluido su posible avance automático. No se amplía a
cierres, activación, retrocesos, saltos, bypass ni lotes.

## Matriz detallada de implementación por categoría

Esta tabla resume el estado actual tras completar A08 y notas de oportunidad: **43 existentes,
0 parciales y 3 ausentes**. «Existente» significa implementado dentro del
alcance indicado, sujeto a permisos, habilitación y datos disponibles; no
significa capacidad universal ni aceptación final con proveedor real de IA
y vendedores.

### Consultas — Q01 a Q12

| ID | Categoría | Estado | Capacidad y límites |
| --- | --- | --- | --- |
| **Q01** | Resumen de cuenta | Existente | Resume la información autorizada de la cuenta seleccionada. No incorpora datos de otras cuentas ni completa información faltante por suposición. |
| **Q02** | Detalle de registro | Existente | Muestra fichas de oportunidades y contactos con los campos definidos en el catálogo aprobado. No es un detalle universal para cualquier entidad del CRM. |
| **Q03** | Consulta de campos | Existente | Responde por uno o varios campos admitidos de oportunidades y contactos. Informa explícitamente cuando un campo no está soportado o no tiene valor. |
| **Q04** | Listado de registros | Existente | Lista oportunidades y contactos con filtros, orden, cantidad y columnas; conserva continuidad e informa cobertura. Muestra hasta 50 resultados, sin paginación. |
| **Q05** | Búsqueda de registros | Existente | Busca oportunidades y contactos por texto y criterios admitidos, incluidos importe USD y fecha de cierre. Mantiene filtros y continuidad sin inventar coincidencias. |
| **Q06** | Historial | Existente | Construye una cronología de fuentes autorizadas, delimitada por periodo, entidad y estados. Explica cobertura; no afirma disponer de toda la historia comercial. |
| **Q07** | Pendientes | Existente | Consulta actividades y pendientes autorizados del contexto disponible. Consultarlos no los crea, modifica ni cancela. |
| **Q08** | Relaciones entre registros | Existente | Consulta el contacto asociado a una oportunidad, verifica una pareja contacto–oportunidad y resuelve relaciones inversas. Un vínculo registrado no demuestra autoridad de compra. |
| **Q09** | Contenido documental | Existente | Consulta cotizaciones y versiones autorizadas, datos estructurados y contenido documental con citas y cobertura. No es un lector genérico de cualquier documento del CRM. |
| **Q10** | Preparación de etapa | Existente | Explica requisitos y preparación de la etapa con la información disponible. Consultar readiness no valida ni autoriza el avance. |
| **Q11** | Ayuda para usar el sistema | **Ausente** | Falta una herramienta de documentación del sistema que permita fundamentar instrucciones de uso. |
| **Q12** | Consultar notas de oportunidad | Existente | Lee notas individuales de una oportunidad única autorizada dentro de la cuenta seleccionada. Informa explícitamente si no hay notas; no amplía la lectura a otras oportunidades ni interpreta ausencia de nota como ausencia del hecho. |

### Orientación comercial — G01 a G08

| ID | Categoría | Estado | Capacidad y límites |
| --- | --- | --- | --- |
| **G01** | Evaluación de situación | Existente | Analiza la situación comercial con evidencia disponible y distingue hechos de interpretaciones. |
| **G02** | Riesgos y brechas | Existente | Identifica riesgos y faltantes de información. No presenta sospechas o inferencias como hechos confirmados. |
| **G03** | Próximos pasos | Existente | Recomienda acciones comerciales justificadas. Recomendar una llamada o reunión no la agenda automáticamente. |
| **G04** | Priorización | Existente | Ordena oportunidades por importe USD o cierre registrado, con filtros, empates, faltantes y cobertura explícitos. No utiliza scoring predictivo ni prioriza universalmente cualquier entidad. |
| **G05** | Comparación | Existente | Compara entre 2 y 5 oportunidades por importe USD, etapa, estado y cierre; contacto bajo solicitud. No incluye comparación universal de historial, pendientes u otras entidades. |
| **G06** | Tendencias y evolución | Existente | Analiza evolución comercial y pipeline con auditoría y estado base verificable. No incluye finanzas todavía ni reconstruye como cierta una historia sin evidencia. |
| **G07** | Escenarios hipotéticos | Existente | Construye escenarios deterministas y alternativas sobre una base actual, con continuidad y separación entre datos reales y supuestos. No predice resultados ni escribe cambios en CRM. |
| **G08** | Estrategia comercial | Existente | Propone estrategia basada en contexto autorizado. Las recomendaciones no equivalen a hechos confirmados ni garantizan resultados. |

### Generación de contenido — C01 a C09

| ID | Categoría | Estado | Capacidad y límites |
| --- | --- | --- | --- |
| **C01** | Borrador de correo | Existente | Redacta correos con el contexto disponible. **No los envía**. |
| **C02** | Borrador de mensaje | Existente | Redacta mensajes breves para el canal solicitado. No los transmite ni inventa destinatarios o datos de contacto. |
| **C03** | Preparación de reunión | Existente | Genera agendas, guiones y puntos de preparación. No agenda la reunión por el hecho de prepararla. |
| **C04** | Preguntas de descubrimiento | Existente | Sugiere preguntas para obtener información comercial faltante. No convierte sus posibles respuestas en hechos. |
| **C05** | Resumen | Existente | Resume el material disponible sin agregar hechos no sustentados. |
| **C06** | Explicación | Existente | Explica contenido y términos comerciales. No supone una consulta externa libre ni sustituye la ayuda documental del sistema pendiente en Q11. |
| **C07** | Reescritura | Existente | Ajusta tono, estructura o claridad del material aportado, sin autorizar acciones mencionadas dentro del texto. |
| **C08** | Traducción | Existente | Traduce material aportado preservando su sentido. No ejecuta instrucciones contenidas en ese material. |
| **C09** | Argumento de valor | Existente | Construye argumentos comerciales con información disponible. No inventa métricas, ahorros, resultados ni compromisos. |

### Reportes del vendedor — R01 a R06

| ID | Categoría | Estado | Capacidad y límites |
| --- | --- | --- | --- |
| **R01** | Declaración del cliente | Existente | Conserva lo narrado como una declaración atribuida al cliente, incluso si este expresa una sospecha. No lo convierte automáticamente en hecho verificado. |
| **R02** | Observación del vendedor | Existente | Distingue las observaciones del vendedor de los hechos registrados y de las declaraciones del cliente. |
| **R03** | Resultado de interacción | Existente | Interpreta el resultado narrado de una interacción. El reporte por sí solo no registra una actividad ni ejecuta A07. |
| **R04** | Compromiso | Existente | Reconoce compromisos informados y su atribución. No crea automáticamente reuniones, tareas o actividades. |
| **R05** | Evidencia documental | Existente | Contrasta lo reportado con fuentes Q09, citas, cobertura y discrepancias. Puede preparar un borrador atribuido bajo solicitud; no certifica autenticidad ni escribe automáticamente. |
| **R06** | Hipótesis | Existente | Mantiene una hipótesis como tal. No la incorpora como hecho confirmado ni como respuesta de etapa validada. |

### Acciones controladas — A01 a A11

| ID | Categoría | Estado | Capacidad y límites |
| --- | --- | --- | --- |
| **A01** | Crear registros | Existente | Prepara borradores tipados de contactos u oportunidades, con continuidad, coincidencias y revisión vigente. Traslada al módulo para completar y guardar. No crea cuentas nuevas ni guarda automáticamente. |
| **A02** | Actualizar campos | Existente | Prepara cambios de los campos aprobados de cuenta, contacto u oportunidad, mostrando antes/después. Incluye revisión y ejecución transaccional auditada. No admite edición arbitraria ni masiva. |
| **A03** | Actualizar respuestas de etapa | Existente | Propone respuestas de etapa con revisión y confirmación. Guardar una respuesta no equivale a validar o aprobar el avance. |
| **A04** | Vincular registros | Existente | Asigna o sustituye el contacto asociado a una oportunidad de la cuenta fija. Muestra antes/después y permite guardar el vínculo auditado en Oportunidades. No admite relaciones universales ni múltiples contactos asociados mediante este flujo. |
| **A05** | Agendar actividad | Existente | Prepara un borrador de actividad para revisión y guardado explícito. Los datos faltantes, incluida la fecha, permanecen pendientes; no se inventan. |
| **A06** | Reprogramar actividad | Existente | Reprograma una actividad pendiente de oportunidad mediante propuesta versionada y confirmación en Calendario, conservando su identidad. No incluye lotes, recurrencias, actividades independientes o de lead, ni creación de una actividad sustituta. |
| **A07** | Registrar resultado de llamada | Existente | Prepara y registra el resultado de una llamada de lead de la cuenta fija con catálogo compartido, requisitos condicionales y confirmación transaccional en Mi Coach. No incluye lotes ni creación implícita de contactos, reuniones o tareas. |
| **A08** | Solicitar validación de avance | Existente | Prepara y traslada a Oportunidades la solicitud de validación para la siguiente etapa. El vendedor inicia allí el **validador existente**, sin cambiar sus reglas ni su posible avance automático. No incluye cierres, activación, retrocesos, saltos, bypass ni lotes. |
| **A09** | Eliminar, cancelar o desactivar | **Ausente** | No elimina, cancela ni desactiva registros persistidos desde este flujo. Descartar un borrador conversacional es una acción diferente. |
| **A10** | Enviar comunicaciones | **Ausente** | No envía correos, WhatsApp ni otras comunicaciones. Redactar contenido está disponible en C01/C02, pero no implica enviarlo. |
| **A11** | Registrar nota | Existente | Prepara una nota individual con texto, atribución y certeza revisables para una oportunidad única. Solo se persiste en `opportunity_notes` tras confirmación explícita; el reporte no se guarda automáticamente y una nota guardada no se edita ni sobrescribe desde el chat. |

**Pendientes de implementación:** Q11, A09 y A10.
**Pendiente transversal:** aceptación con proveedor real de IA y pruebas con
vendedores del alcance implementado.

Para los criterios y escenarios de aceptación de cada categoría, consulta
las secciones correspondientes más adelante en este documento y el
[catálogo de preguntas de validación](./preguntas-validacion-chat-cliente-existente.md).
El [catálogo de capacidades y límites](./chat-cliente-existente-alcance.md#catálogo-completo-y-capacidades)
complementa esta matriz.

## Arquitectura actual

El recorrido simplificado de un turno es:

![Diagrama del turno de Cliente existente: interfaz, job asíncrono, contexto autorizado, coordinación, lecturas, verificación de evidencia, respuesta y persistencia.](./validacion-chat-cliente-existente-flujo.svg)

### Qué hace cada etapa

1. **B3 entiende qué pide el vendedor.** Prepara la información que el usuario
   tiene permiso de consultar y convierte el mensaje en una descripción
   organizada para el sistema. A esta descripción se le llama **contrato
   estructurado**: no es un contrato comercial ni una autorización para actuar.
   Indica el **propósito** (por ejemplo, consultar o redactar), el **objeto**
   (la cuenta, una oportunidad o un contacto), la **resolución** (si está
   identificado lo necesario o hace falta aclarar), la **confianza** de la
   interpretación y las distintas tareas solicitadas.
2. **B4 adapta la solicitud al canal Cliente existente.** Conecta el contexto,
   las reglas y las herramientas disponibles con el motor compartido. En esta
   ruta también coordina las tareas del mensaje: comprueba cuáles están
   disponibles, cuáles dependen de otras y qué permisos y políticas les
   corresponden. Al recibir el resultado, lo adapta al formato del canal.
3. **B5 organiza el procesamiento dentro del motor.** Coordina la planificación,
   las consultas, la revisión de evidencia y la preparación de la respuesta.
   Valida que el plan respete lo que B3 interpretó y los límites autorizados.
   **B4 conecta el canal con el motor; B5 organiza el trabajo dentro del motor.**
4. **B6 propone qué consultar; B7/B8 realizan las lecturas permitidas.** B6
   puede ayudar a identificar a qué registro se refiere el vendedor, pero no
   puede cambiar la tarea por otra ni otorgar permisos. B7/B8 obtienen la
   información mediante consultas de solo lectura.
5. **B9 comprueba si la información alcanza para responder.** Si falta
   evidencia, puede solicitar lecturas adicionales dentro de los límites.
   Una consulta que falla no demuestra que no existan registros; una lista
   recortada tampoco demuestra que se hayan visto todos. La respuesta debe
   explicar esas limitaciones.
6. **B10 prepara la respuesta, el borrador o la propuesta.** Utiliza la
   información verificada. Preparar una propuesta no significa guardar un
   cambio en el CRM ni ejecutar una acción.
7. **B3 guarda el resultado mediante B11.** Se conservan el resultado del
   trabajo, el historial y los datos de contexto validados para continuar la
   conversación. Mientras se procesa la solicitud, B1 consulta su estado a
   través de B2 y muestra el resultado cuando está disponible.

Los bloques representan responsabilidades, no once servicios independientes
ni una cadena que siempre se recorra completa. B6–B10 forman parte de la
coordinación del motor; algunas solicitudes pueden resolverse sin pasar por
todas las etapas de lectura.

### Cómo se cuentan las tareas de un mensaje

Un **turno** es un mensaje del vendedor y su procesamiento. Un **componente**
es una tarea distinta dentro de ese mensaje, no cada registro o ejemplo pedido.

- «Lista diez oportunidades» es **una tarea**: listar oportunidades.
- «Dame cinco ejemplos de un correo de seguimiento» es **una tarea**: generar
  ejemplos del contenido solicitado.
- «Resume la cuenta, lista sus pendientes y redacta un correo» son **tres
  tareas**: resumir, listar y redactar.
- «Consulta la etapa de Alfa y usa ese dato en un correo» son **dos tareas
  relacionadas**: primero consultar y después redactar con ese resultado.

El contrato admite **hasta cuatro tareas distintas por turno**. No significa
que todas puedan ejecutarse: cada una sigue sujeta a disponibilidad, datos,
permisos y al presupuesto compartido del turno. Si el mensaje contiene más
de cuatro tareas independientes, el chat debe pedir dividirlo. Si alguna no
puede resolverse, debe indicarlo, no omitirla ni afirmar que completó todo.

### Límites de seguridad y operación

- La cuenta seleccionada es el límite de acceso. Nombrar otra cuenta no lo
  modifica.
- La IA puede ayudar a identificar la cuenta, oportunidad, contacto o actividad
  que menciona el vendedor, pero no puede autorizar el uso de ese registro.
  Cada registro tiene un identificador interno o **ID**; antes de utilizarlo
  en una operación, el servidor debe comprobar que existe, pertenece a la
  cuenta seleccionada y el usuario tiene los permisos necesarios. Un ID
  propuesto por la IA no es suficiente para autorizar una acción. Por ejemplo,
  si hay dos oportunidades llamadas «Renovación», el chat debe pedir aclaración
  en lugar de elegir una arbitrariamente. La IA tampoco puede ampliar el
  acceso a otra cuenta ni conceder permisos que el usuario no tiene.
- Los resultados de CRM, la información pública, los reportes del vendedor y
  las inferencias deben permanecer diferenciados.
- Las propuestas de escritura no son escrituras ejecutadas. La confirmación
  debe ocurrir en el flujo autorizado correspondiente.
- La investigación pública requiere solicitud explícita, permiso y controles de
  gobierno; no se incluye por defecto.
- El presupuesto predeterminado permite hasta ocho lecturas, dos rondas
  adicionales de evidencia y 45 segundos por turno. La interpretación B3 tiene
  un timeout de 15 segundos; la selección previa de datos opcionales del
  snapshot tiene un timeout de cinco segundos.
- Aumentar límites puede elevar costo y latencia. Conviene hacerlo solo tras
  medir los resultados por etapa.

Los detalles de alcance y capacidades están en
[chat-cliente-existente-alcance.md](./chat-cliente-existente-alcance.md); la
descripción de bloques está en
[arquitectura-chat-conversacional.md](./arquitectura-chat-conversacional.md).

## Alcance funcional reconocido

El sistema utiliza un **contrato estructurado**: un formato que organiza lo
que solicita el vendedor para que las siguientes etapas sepan qué tarea
procesar, sobre qué registro y si hace falta una aclaración. No es un contrato
comercial ni una autorización para ejecutar acciones.

Este formato contempla **46 categorías de solicitud**, agrupadas en cinco
familias. Reconocer una categoría no significa que el chat pueda ejecutarla:
por ejemplo, puede identificar que el vendedor pide enviar un correo y
explicar que el envío no está disponible.

| Familia | Cantidad | Ejemplos |
| --- | --- | --- |
| Consultas (`query.*`) | 12 | Resumen, detalle, campos, listas, historial, pendientes, relaciones, cotización, preparación de etapa y notas de oportunidad. |
| Orientación (`guidance.*`) | 8 | Diagnóstico, riesgos, siguientes pasos, priorización, comparación y estrategia. |
| Contenido (`content.*`) | 9 | Correo, mensaje, agenda, preguntas de descubrimiento, resumen, explicación, reescritura, traducción y argumento de valor. |
| Reportes (`report.*`) | 6 | Declaración del cliente, observación del vendedor, resultado, compromiso, evidencia documental e hipótesis. |
| Acciones (`action.*`) | 11 | Crear, actualizar, vincular, programar, reprogramar, registrar resultado, cambiar estado, eliminar, enviar comunicación y registrar nota. |

**Entender lo que pide el vendedor no significa poder hacerlo.** Las
46 categorías permiten identificar la solicitud, incluso cuando el chat no
tiene la función necesaria para atenderla. Después de interpretarla, el
servidor comprueba si esa función existe, si está habilitada, si aplica al tipo
de registro solicitado y si el usuario tiene los permisos necesarios.

Una función puede estar **disponible**, **disponible solo para algunos casos**
o **no disponible**. Por ejemplo, que se pueda preparar un cambio para un tipo
de registro no significa que se pueda preparar el mismo cambio para cualquier
otro. Además, preparar un borrador o una propuesta no equivale a ejecutar una
acción ni a guardar un cambio.

Si el vendedor pide «Envía este correo» y el chat solo puede redactarlo, debe
explicar: «No puedo enviarlo desde este chat; puedo preparar el texto para que
lo revises y lo envíes por el canal correspondiente». No debe responder como si
lo hubiera enviado ni entregar un borrador dando a entender que cumplió el
envío. **Puede ofrecer una alternativa, pero debe aclarar qué no pudo hacer
y en qué consiste la alternativa.**

Para consultar el detalle técnico:

- [turn-contract.js](../apps/api/src/commercial-intelligence/turn-contract.js)
  contiene las categorías y las reglas que relacionan las solicitudes con
  las capacidades del sistema.
- La sección de capacidades de
  [chat-cliente-existente-alcance.md](./chat-cliente-existente-alcance.md)
  explica qué funciones están disponibles o limitadas según el tipo de
  registro, como cuenta, oportunidad, contacto o actividad. Aquí, «objeto»
  significa ese tipo de registro, no el objetivo comercial del vendedor.

## Estado de la nueva validación

**Pendiente de ejecución.** Los escenarios de este documento son casos y
criterios propuestos, no resultados aprobados. La nueva validación debe
registrar sus propias evidencias, fallos, métricas y condiciones de ejecución,
sin reutilizar resultados anteriores como aprobación.

## Brechas de validación identificadas

### 1. Variedad lingüística insuficiente

Un ejemplo por categoría no representa preguntas cortas, coloquiales,
paráfrasis, errores de escritura, omisiones de entidad, solicitudes negativas o
instrucciones contradictorias. Para cada categoría conviene añadir varias
frases independientes y registrar la interpretación esperada.

### 2. Continuidad multi-turno

Hace falta evaluar secuencias completas, no solo turnos aislados:

- Aclarar una oportunidad, fecha, importe o contacto que pidió el asistente.
- Elegir entre candidatos o preguntas numeradas.
- Corregir un reporte sin perder su texto original ni su atribución.
- Aceptar preparar una propuesta, modificarla, rechazarla o descartarla.
- Distinguir «prepara» de «confirma la ejecución».
- Cambiar de tema y comprobar que no se reutilice por accidente un pendiente.
- Retomar una tarea después de una respuesta parcial o un error recuperable.

### 3. Composición, dependencias y omisiones

Se necesita medir solicitudes con dos, tres y cuatro componentes, con y sin
dependencias. La evaluación debe detectar si se pierde una parte, se responde
fuera de orden o se afirma que todo quedó atendido cuando hay una parte en
aclaración, error o espera.

### 4. Variación de datos, permisos y evidencia

Cada intención relevante debería combinarse con:

- Una entidad única, nombres duplicados, ninguna coincidencia y referencias
  implícitas que dependan del contexto.
- Oportunidades abiertas, inactivas y en estado terminal.
- Datos completos, vacíos, antiguos, truncados o contradictorios.
- Lecturas correctas, fallidas, no autorizadas y omitidas por presupuesto.
- Un usuario con permisos completos y usuarios sin permisos por dominio.
- Solicitudes sobre otra cuenta, fuentes públicas, adjuntos y dominios fuera de
  alcance.

### 5. Calidad de la respuesta

La evaluación debe revisar algo más que la categoría y las herramientas:

- ¿Responde todas las partes y directamente la pregunta del vendedor?
- ¿Usa hechos presentes en evidencia autorizada y no inventa nombres, importes,
  fechas ni compromisos?
- ¿Distingue hechos CRM, datos atribuidos al cliente/vendedor/documento,
  inferencias e hipótesis?
- ¿Declara rangos, filtros y truncamiento cuando afectan la completitud?
- ¿Explica con claridad qué dato falta y qué puede hacer el vendedor después?
- ¿Evita afirmar que envió, programó o guardó algo que solo propuso?

### 6. Costo y latencia por etapa

La selección de datos opcionales del snapshot ocurre antes de la interpretación
B3 y usa una llamada de modelo independiente. No se debe asumir que convenga
fusionarla: primero se deben medir costo, latencia, errores y utilidad por etapa
(selección del snapshot, B3, B6, B9 y B10), además de la latencia total y los
reintentos.

## Plan recomendado para validar exhaustivamente

### Fase A: establecer una línea base reproducible

1. Preparar datos de prueba, permisos, configuración y respuestas esperadas
   conforme al alcance aprobado.
2. Definir el nuevo conjunto de evaluación a partir del alcance aprobado antes
   de ejecutarlo.
3. Guardar por ejecución la revisión de código, versión del corpus, proveedor y
   modelo, configuración de prompts, semilla o parámetros disponibles, fecha,
   costo y resultados. Mantener los resultados separados por ejecución.

### Fase B: definir y revisar el nuevo conjunto de evaluación

1. Crear variantes por intención con lenguaje natural diverso y preguntas
   realistas de vendedores.
2. Añadir diálogos multi-turno y preguntas compuestas, con el contexto
   necesario para reproducir cada secuencia.
3. Etiquetar por separado categoría, objeto, referencias, filtros,
   componentes, dependencias, aclaración esperada, consultas permitidas,
   evidencia mínima y forma de respuesta aceptable.
4. Añadir datos reales únicamente después de revisión y minimización de datos
   personales y comerciales; empezar con datos sintéticos representativos.
5. Mantener IDs de caso estables y versionar deliberadamente cambios al fixture.

### Fase C: separar métricas

No reducir la calidad a un único promedio. Informar al menos:

| Dimensión | Métrica recomendada |
| --- | --- |
| Interpretación B3 | Exactitud por categoría, objeto y resolución; matriz de confusión. |
| Composición | Porcentaje de componentes preservados, orden correcto y dependencias correctas. |
| Resolución B6 | Entidad correcta, aclaraciones necesarias y selecciones ambiguas indebidas. |
| Evidencia B7–B9 | Cobertura de hechos requeridos, consultas correctas, fallos y truncamientos divulgados. |
| Respuesta B10 | Respuesta completa y útil; afirmaciones sin respaldo; distinción de fuentes e incertidumbre. |
| Seguridad operativa | Lecturas fuera de alcance, operaciones implícitas, propuestas inválidas y confirmación incorrecta. |
| Experiencia | Tasa de aclaración, aclaraciones innecesarias, reintentos, recuperación y finalización. |
| Eficiencia | Latencia p50/p95 por etapa, timeout, llamadas de modelo y costo por turno/categoría. |

### Fase D: pruebas live controladas

1. Ejecutar la nueva evaluación con proveedor real solo de forma explícita, en un entorno con
   proveedor configurado, cuenta de gasto aprobada y snapshots sintéticos.
2. Repetir muestras sensibles a variabilidad y reportar distribución, no solo la
   mejor ejecución.
3. Verificar que una evaluación fallida produzca casos reproducibles y un
   reporte sin datos personales innecesarios.

### Fase E: aceptación previa al lanzamiento

Validar la versión candidata en un entorno de pruebas con datos controlados y
participación de vendedores que revisen su utilidad comercial. Comparar los
resultados con la línea base y conservar un mecanismo de reversión para el
lanzamiento. No declarar lista la aplicación hasta verificar el alcance
aprobado y cumplir los criterios de aceptación y umbrales medibles acordados.

Los umbrales de calidad comercial y eficiencia deben acordarse con los
responsables del producto y representantes de los vendedores antes de ejecutar
la nueva evaluación.

## Parámetros: qué medir antes de cambiar

| Parámetro o configuración | Estado observado | Recomendación |
| --- | --- | --- |
| `OPENAI_MODEL` | El código usa `gpt-4.1-mini` como valor predeterminado. | Registrar el modelo realmente desplegado y comparar candidatos con el mismo corpus antes de cambiarlo. |
| Temperatura de B3/B6 del contrato | Las llamadas de interpretación y planificación del contrato usan temperatura cero. | No asumir que temperatura cero garantiza exactitud; priorizar corpus, instrucciones y evaluación por error. |
| Timeout de B3 | 15 segundos para la interpretación del contrato. | Medir timeout y latencia de interpretación por categoría antes de ampliarlo. |
| Selección de datos opcionales | Llamada previa con timeout de cinco segundos. | Medir errores y dominios seleccionados incorrectamente; no asumir que debe fusionarse con B3. |
| Lecturas y rondas | Hasta 8 lecturas, hasta 2 rondas adicionales según la política. | Medir límites agotados y lecturas innecesarias; no aumentarlos para ocultar planes imprecisos. |
| Tiempo máximo del turno | Hasta 45 segundos según política de servidor. | Revisar latencia por etapa y la espera configurada en la interfaz antes de modificarlo. |
| Contrato de turno B3 | Obligatorio para los turnos de acción; la variable `CUSTOMER_TURN_CONTRACT_MODE` fue retirada. | No hay interruptor que verificar por entorno. |

## Matriz de alcance y aceptación

### 1. Propósito y estado de esta matriz

Definir qué debe resolver el chat, qué respuesta es útil para el vendedor y cómo
comprobarla antes de desarrollar nuevas funciones o ajustar modelos y parámetros.
Esta sección desarrolla el alcance y el plan de evaluación de esta guía.

**Estado: propuesta pendiente de revisión y aprobación.** Esta matriz describe
las 46 categorías y el alcance que se propone evaluar. No certifica que las
funciones estén disponibles ni que funcionen correctamente. Su disponibilidad
depende de la implementación, la configuración y los permisos del usuario.
El documento no modifica esas condiciones.

Cada ficha separa:

- **Definición:** qué solicita el vendedor, en lenguaje cotidiano.
- **Necesidad:** para qué le sirve, sin limitarla a un solo escenario.
- **Prioridad propuesta:** importancia para la primera versión; no indica que la
  función esté implementada o aprobada.
- **Ejemplo de uso:** situación comercial ilustrativa, no único uso permitido.
- **Cómo distinguirla:** diferencia respecto de solicitudes parecidas.
- **Actual:** capacidad declarada y límites de la implementación; no certifica
  precisión del modelo.
- **Objetivo:** resultado propuesto para el vendedor.
- **Decisión:** validar/mejorar lo existente, ampliar datos, evaluar una función
  nueva o mantener el límite.
- **Aceptación:** comportamiento observable que deberá convertirse en casos.
  Todos los casos nuevos descritos aquí están pendientes de ejecución.

Los nombres Alfa, Beta, Elena y Cliente A son ejemplos sintéticos. No se deben
copiar conversaciones reales sin revisión y minimización de datos.

### 2. Prioridades y reglas comunes

#### Prioridad propuesta

| Prioridad | Significado | Condición de salida |
| --- | --- | --- |
| P0 | Núcleo necesario para una primera versión útil y confiable. | Resolver dentro del alcance acordado y cumplir los criterios de aceptación antes del lanzamiento. |
| P1 | Productividad comercial que completa el núcleo. | Decidir si forma parte de la primera versión según la necesidad comercial; si se incluye, validarla antes del lanzamiento. |
| P2 | Ampliación que requiere justificar demanda, datos o esfuerzo. | Decidir explícitamente si se incluye o se pospone; si se incluye en la primera versión, validarla antes del lanzamiento. |
| Límite | No ofrecer ejecución desde este chat en la primera versión propuesta. | Reconocer y explicar el límite; derivar cuando exista un flujo autorizado conocido. |

La prioridad funcional no reduce la obligación de reconocer correctamente una
solicitud. Las categorías no disponibles también necesitan pruebas P0 de
contención: nunca simular ejecución ni sustituir silenciosamente la tarea.

P0 no significa responder cualquier pregunta ni disponer de todos los datos de
la cuenta. Significa resolver de forma confiable la necesidad dentro del alcance
acordado, o explicar con claridad la información o capacidad que falta.

En las fichas, **registro** significa un elemento guardado en el CRM, como una
oportunidad o un contacto; **campo**, un dato de ese elemento, como monto o
teléfono; **evidencia**, la información disponible que respalda una respuesta;
**borrador**, contenido o datos preparados que todavía deben revisarse. Una
**propuesta de cambio** no es un cambio ya guardado. Los códigos entre comillas
invertidas identifican las categorías técnicas; no son términos que el vendedor
deba aprender para usar el chat.

### 3. Matriz detallada de las 46 categorías

#### A. Consultas: 12 categorías

##### Q01 — Resumen general de la cuenta (`query.account_summary`)

| Campo | Definición |
| --- | --- |
| Definición | Reunir y resumir la información comercial disponible de la cuenta seleccionada para ofrecer una visión de conjunto. |
| Necesidad | Comprender rápidamente la situación comercial de la cuenta: oportunidades, contactos relevantes, actividad reciente y pendientes, según la información disponible y autorizada. |
| Prioridad propuesta | **P0:** capacidad esencial para el lanzamiento a vendedores. |
| Ejemplo de uso | Prepararse para una llamada, retomar el seguimiento o revisar el estado general del cliente. |
| Cómo distinguirla | Responde «¿qué sabemos de esta cuenta?». Evaluar por qué está bien o mal corresponde a diagnóstico; recomendar qué hacer corresponde a siguientes pasos. |
| Preguntas de prueba | «Ponme al día con esta cuenta»; «Dame un panorama en cinco puntos»; «¿Qué debo saber antes de verla mañana?». |
| Actual | Disponible: resumen de la cuenta autorizada, sujeto a los datos y herramientas permitidos. |
| Datos necesarios | Identidad de cuenta y, según lo pedido y autorizado, oportunidades, contactos, actividad reciente y señales CRM. |
| Objetivo | Síntesis pertinente de situación, oportunidades, actividad y brechas. Identificar qué se sabe y qué no; no limitarse a repetir datos de ubicación. |
| Aclaración y límites | No exigir elegir una oportunidad para resumir la cuenta. Si el usuario pide datos de facturación no disponibles, indicar la ausencia de esa fuente sin confundir pipeline con ingresos. |
| Aceptación específica | Cada hecho debe coincidir con el fixture; respetar cinco puntos si se piden; una cuenta sin actividad no se describe como saludable por defecto; con permisos reducidos no revelar ni inferir registros restringidos. |
| Decisión propuesta | Validar y mejorar pertinencia de lo existente antes de ampliar fuentes. |

##### Q02 — Detalle de un registro (`query.record_detail`)

| Campo | Definición |
| --- | --- |
| Definición | Mostrar la información disponible de una oportunidad, contacto u otro registro concreto que el canal permita consultar. |
| Necesidad | Revisar un caso específico con suficiente contexto para trabajar sobre él, sin confundirlo con los demás registros de la cuenta. |
| Prioridad propuesta | **P0:** para oportunidades y contactos expuestos por las herramientas actuales. |
| Ejemplo de uso | Revisar los datos de una oportunidad al retomar su seguimiento o conocer a un contacto antes de hablar con él. |
| Cómo distinguirla | Pide varios datos del mismo registro. Si solo pregunta el monto o una fecha, es consulta de un campo; si pide varios registros, es una lista. |
| Preguntas de prueba | «Muéstrame el detalle de Alfa»; «¿Qué tenemos registrado de Elena?»; «Ahora dame el detalle de esa oportunidad». |
| Actual | Ficha de oportunidad o contacto construida con lecturas autorizadas. Oportunidad: nombre, cuenta, importe USD, cierre, etapa, estado comercial, activación y contacto asociado accesible. Contacto: nombre, cuenta, cargo, correo, teléfono y móvil. No garantiza detalle de otros tipos de registro. Pendiente de validación con proveedor real. |
| Datos necesarios | Registro autorizado, tipo de entidad y campos legibles. El nombre por sí solo no demuestra una coincidencia única. |
| Objetivo | Presentar campos relevantes del registro correcto y sus relaciones comprobadas, no un resumen de otro registro o de toda la cuenta. |
| Aclaración y límites | Si hay dos Alfa, ofrecer candidatos distinguibles. Si se solicita un tipo no soportado, reconocerlo y explicar el límite. |
| Aceptación específica | Mismo ID esperado tras resolución del servidor; campos ausentes señalados sin completarlos; seguimiento «ese» conserva el foco válido; registro ajeno o inaccesible no se expone. |
| Decisión propuesta | Validar las fichas implementadas de oportunidad y contacto, sus permisos, ambigüedad y continuidad. Evaluar otros campos o entidades únicamente si el alcance aprobado los requiere; no prometer detalle genérico de todo el CRM. |

##### Q03 — Consulta de un dato específico (`query.field_value`)

| Campo | Definición |
| --- | --- |
| Definición | Consultar el valor registrado de un dato concreto, como etapa, monto, fecha de cierre o estado comercial. |
| Necesidad | Resolver una duda puntual con una respuesta exacta y breve, sin tener que revisar todo el registro. |
| Prioridad propuesta | **P0:** fundamento de la confianza del vendedor en las respuestas del chat. |
| Ejemplo de uso | Confirmar el monto vigente antes de una llamada o verificar en qué etapa está una oportunidad. |
| Cómo distinguirla | Preguntar «¿cuál es el monto?» consulta un valor. «Cambia el monto» solicita una propuesta de actualización; no son la misma tarea. |
| Preguntas de prueba | «¿En qué etapa está Alfa?»; «¿Cuál es su monto?»; «¿Qué fecha de cierre tiene?»; «¿Y el estado comercial?». |
| Actual | Consulta determinista de uno o varios campos de oportunidades y contactos del catálogo Q02, con lecturas y formato compartidos. El contrato identifica los campos solicitados; la respuesta solo muestra esos campos y el nombre del registro. Pendiente de validación con proveedor real. |
| Datos necesarios | Entidad inequívoca, campo solicitado, valor vigente y unidades si corresponden. |
| Objetivo | Respuesta directa con registro y valor. Distinguir etapa, estado comercial y activación en lugar de tratarlos como sinónimos. |
| Aclaración y límites | Pedir precisión para «¿cómo está?» solo si el contexto no permite saber qué campo se busca. No exigir campos ajenos al dato consultado. |
| Aceptación específica | Igualdad exacta con el fixture para valor, moneda y fecha; un valor cero no equivale a desconocido; campo vacío se informa como no registrado; no proponer cambios por una consulta. |
| Decisión propuesta | Validar el catálogo implementado para oportunidades y contactos, continuidad, permisos, cero, vacíos y fallos. Verificar que campos no soportados no se sustituyan por otros y que no se genere una ficha completa ni una operación de escritura. |

##### Q04 — Listado de registros (`query.record_list`)

| Campo | Definición |
| --- | --- |
| Definición | Mostrar un conjunto de registros de la cuenta, como sus oportunidades o contactos, bajo un alcance declarado. |
| Necesidad | Saber qué elementos existen y revisar el conjunto antes de elegir uno o continuar el trabajo. |
| Prioridad propuesta | **P0:** consulta básica para explorar la cuenta y orientarse dentro de ella. |
| Ejemplo de uso | Revisar las oportunidades abiertas del cliente o identificar los contactos disponibles. |
| Cómo distinguirla | Su resultado es una lista, no el detalle de un solo registro. Puede tener filtros básicos; una búsqueda enfatiza criterios específicos para localizar coincidencias. |
| Preguntas de prueba | «Lista las oportunidades abiertas»; «Muéstrame los contactos»; «Incluye también las históricas»; «Dame todas». |
| Actual | Listados deterministas de oportunidades y contactos. Filtros de oportunidad por estado comercial, etapa y activación; orden por nombre/importe/cierre en oportunidades y nombre/cargo en contactos; cantidad y columnas explícitas. Máximo 50 mostrados, con métricas de lectura y presentación separadas, sin paginación. Pendiente de validación con proveedor real. |
| Datos necesarios | Colección, filtros aplicados y metadatos de completitud/truncamiento. |
| Objetivo | Lista legible con campos útiles y criterio de selección explícito; distinguir abiertas, históricas, activadas o inactivas cuando corresponda. |
| Aclaración y límites | No pedir elegir un registro para listar una colección. No ofrecer paginación o continuación que el sistema no pueda ejecutar. |
| Aceptación específica | Conjunto de IDs igual al esperado bajo filtros; sin duplicados ni registros ajenos; cero coincidencias explicado; truncamiento visible; «todas» no elimina permisos ni límites. |
| Decisión propuesta | Validar conjuntos exactos, orden antes del límite, columnas, continuidad y referencia ordinal sobre el orden mostrado. Confirmar permisos, política histórica y advertencias de lectura parcial antes de añadir otras colecciones o paginación. |

##### Q05 — Búsqueda por criterios (`query.record_search`)

| Campo | Definición |
| --- | --- |
| Definición | Localizar registros que cumplan condiciones expresadas por el vendedor, dentro de los filtros que el sistema realmente soporta. |
| Necesidad | Encontrar los casos relevantes sin revisar manualmente toda la cartera de la cuenta. |
| Prioridad propuesta | **P0:** para los filtros disponibles; nuevos filtros requieren priorización propia. |
| Ejemplo de uso | Encontrar oportunidades abiertas con cierre en un año determinado o limitar una lista a una etapa. |
| Cómo distinguirla | No basta con devolver registros parecidos: deben cumplir los criterios aplicados. Un filtro no disponible debe explicarse, no ignorarse. |
| Preguntas de prueba | «Busca las abiertas que cierren en 2027»; «Solo las de calificación»; «De esas, las históricas»; «Busca oportunidades de otro cliente». |
| Actual | Búsqueda determinista sobre oportunidades y contactos recuperados, compartida con Q04. Texto por nombre y cargo de contacto; importe USD y cierre de oportunidad con comparadores exactos e intervalos explícitos; estado, etapa y activación separados. Continuidad para añadir/reemplazar/quitar grupos y selección ordinal validada. Sin ampliación de lectura ni paginación. Pendiente de validación con proveedor real. |
| Datos necesarios | Filtros tipados admitidos, candidatos de la cuenta y contexto previo válido. |
| Objetivo | Ejecutar los filtros soportados y declarar cuáles se aplicaron. Si falta un filtro necesario, no devolver una lista amplia como si lo cumpliera. |
| Aclaración y límites | Fechas o estados ambiguos requieren precisión. Otra cuenta obliga a cambiar la selección de la interfaz, no a ampliar la búsqueda. |
| Aceptación específica | IDs y filtros efectivos coinciden con el caso; un filtro no implementado se informa; una nueva referencia explícita no hereda filtros incompatibles inadvertidamente. |
| Decisión propuesta | Validar conjuntos exactos, umbrales inclusivos/exclusivos, fechas válidas, filtros combinados, continuidad y aclaraciones. Confirmar que resultados parciales no se presenten como ausencia o ranking global y que criterios no soportados no se ignoren. Ampliar filtros o recuperación solo con alcance explícito. |

##### Q06 — Historial de la relación comercial (`query.history`)

| Campo | Definición |
| --- | --- |
| Definición | Consultar los eventos, interacciones y actividades disponibles para explicar qué ocurrió con una cuenta, contacto u oportunidad en un periodo. |
| Necesidad | Recuperar el contexto de la relación y evitar repetir gestiones o perder acuerdos y resultados registrados. |
| Prioridad propuesta | **P0:** esencial para continuar una relación comercial con contexto. |
| Ejemplo de uso | Retomar una cuenta después de varios meses o revisar qué pasó en los últimos contactos con el cliente. |
| Cómo distinguirla | Relata eventos registrados; no analiza por sí sola una tendencia de ingresos ni supone que el CRM contiene todo lo que ocurrió fuera del sistema. |
| Preguntas de prueba | «¿Qué ha pasado con esta cuenta en seis meses?»; «¿Cuándo hablamos con Elena?»; «Muéstrame el historial entre estas fechas». |
| Actual | Cronología determinista de interacciones, actividades de oportunidades y calendario autorizados. Cuenta/oportunidad y contacto según vínculos explícitos; filtros de periodo, fuente y estado; continuidad y cobertura por fuente. Sin periodo, últimos seis meses anunciados. Hasta 500 recuperados por fuente y 50 mostrados por consulta, sin paginación. No es un registro universal; validación con proveedor real pendiente. |
| Datos necesarios | Interacciones y actividades autorizadas, vínculos de entidad, fechas y alcance temporal. |
| Objetivo | Secuencia cronológica que diferencie interacción, actividad y resultado registrado; declarar rango y fuentes consultadas. |
| Aclaración y límites | Resolver periodos relativos con reloj fijo en pruebas. Ausencia de registros no demuestra que nunca hubo contacto. |
| Aceptación específica | Orden y pertenencia correctos; eventos fuera del rango excluidos; historial de contacto no mezclado con el de todos; fallo de fuente no descrito como historial vacío. |
| Decisión propuesta | Validar IDs, rangos y zona horaria con reloj fijo, pertenencia por vínculos explícitos, significado de fechas, estados `done`/`completed`, orden, límites y continuidad. Confirmar que errores, restricciones y truncamiento no se presenten como ausencia; que varias cronologías no se oculten y que una fecha programada no se describa como realización ni como resultado logrado. |

##### Q07 — Pendientes y actividades por atender (`query.pending_items`)

| Campo | Definición |
| --- | --- |
| Definición | Identificar actividades y pendientes consultables que aún requieren atención, diferenciando su estado y fecha. |
| Necesidad | Organizar el seguimiento, detectar atrasos y evitar que se olviden tareas comerciales. |
| Prioridad propuesta | **P0:** soporte directo al trabajo cotidiano del vendedor. |
| Ejemplo de uso | Revisar qué atender esta semana o qué actividades de una oportunidad están vencidas. |
| Cómo distinguirla | Consulta trabajo existente. Recomendar una tarea nueva es orientación; preparar su registro es una acción; un compromiso narrado no equivale a una actividad guardada. |
| Preguntas de prueba | «¿Qué tengo pendiente aquí?»; «¿Qué actividades vencidas tiene Alfa?»; «¿Qué toca esta semana?». |
| Actual | Disponible para actividades y pendientes autorizados. No equivale a leer todos los compromisos posibles en documentos o mensajes. |
| Datos necesarios | Estado, fecha, entidad vinculada y campos disponibles de las actividades; reloj y zona horaria de referencia. |
| Objetivo | Distinguir pendientes, vencidas, futuras y realizadas. Separar compromisos reportados de actividades ya guardadas. |
| Aclaración y límites | Una fecha faltante no se convierte en vencimiento inventado. Consultar pendientes no debe preparar una actividad nueva. |
| Aceptación específica | Estados y rangos exactos; actividades realizadas no aparecen como pendientes; sin fecha se identifican aparte; no afirmar «sin pendientes» si la consulta falló o fue parcial. |
| Decisión propuesta | Validar primero el recorrido de consulta y sus límites de fecha/estado. |

##### Q08 — Relaciones entre contactos y registros (`query.relationships`)

| Campo | Definición |
| --- | --- |
| Definición | Consultar qué vínculos están registrados entre entidades, por ejemplo qué contacto está asociado a una oportunidad. |
| Necesidad | Saber con quién trabajar y a qué caso pertenece cada relación, sin asumir asociaciones que no están comprobadas. |
| Prioridad propuesta | **P0:** para la relación contacto-oportunidad disponible; otros vínculos requieren evaluación. |
| Ejemplo de uso | Confirmar quién está asociado a una oportunidad antes de preparar una llamada. |
| Cómo distinguirla | Estar en la misma cuenta no prueba una relación con la oportunidad; estar asociado tampoco demuestra ser decisor o tener autoridad de compra. |
| Preguntas de prueba | «¿Quién está asociado a Alfa?»; «¿Qué oportunidades tiene Elena?»; «¿Quién toma la decisión?». |
| Actual | Consulta determinista del contacto asociado a una oportunidad, verificación de pareja y relación inversa contacto-oportunidades. Lectura autorizada de ambos extremos, continuidad, listados y selección ordinal revalidada. Contactos activados y oportunidades recuperadas; hasta 50 mostradas, sin paginación. No acredita decisor ni firma; validación con proveedor real pendiente. |
| Datos necesarios | Vínculo CRM explícito y lectura autorizada de las entidades involucradas. |
| Objetivo | Informar relaciones comprobadas y diferenciar asociación registrada de rol de compra, influencia o decisión. |
| Aclaración y límites | No deducir decisor por cargo. Si no hay una relación consultable, explicar lo que no se pudo demostrar. |
| Aceptación específica | Contacto correcto a partir del vínculo, no del primer resultado de la cuenta; relación inversa no ofrecida sin fuente; rol no registrado queda desconocido. |
| Decisión propuesta | Validar identificadores en ambas direcciones, pareja coincidente/diferente, vínculo vacío y destino inaccesible, errores, parcialidad, continuidad y selección ordinal tras cambio de asociación. Confirmar que no se deduzca autoridad por cargo o pertenencia y que un listado genérico no quite el filtro por contacto. Otras relaciones requieren alcance explícito. |

##### Q09 — Consulta del contenido de una cotización o documento (`query.document_content`)

| Campo | Definición |
| --- | --- |
| Definición | Contestar preguntas sobre el contenido de una cotización autorizada o de material documental aportado y legible para el canal. |
| Necesidad | Comprender alcance, productos, condiciones o información relevante sin atribuir al documento contenidos que no se han leído. |
| Prioridad propuesta | **P0:** cotizaciones disponibles; **P1:** adjuntos actualmente admitidos. |
| Ejemplo de uso | Verificar qué incluye una cotización o identificar necesidades descritas en un archivo aportado. |
| Cómo distinguirla | Pregunta qué dice una fuente. Aportar una afirmación de un documento para preparar un complemento de etapa es un reporte documental; leer cualquier archivo guardado en CRM no está garantizado. |
| Preguntas de prueba | «¿Qué incluye la cotización de Alfa?»; «¿Qué exclusiones contiene?»; «Resume este archivo»; «¿Qué dice el contrato guardado?». |
| Actual | Implementado dentro del alcance: contrato documental tipado, candidatos y versiones autorizados sin elección silenciosa, consultas estructuradas deterministas y síntesis con citas/auditoría. Adjuntos actuales con extracción, límite de 12.000 caracteres, procedencia y cobertura persistentes. Continuidad y ordinales revalidados. No existe lector genérico de documentos CRM; aceptación con proveedor real pendiente. |
| Datos necesarios | Cotización autorizada y secciones disponibles, o texto extraído y nombre/procedencia del adjunto. |
| Objetivo | Contestar desde la fuente correcta y señalar información ausente. Atribuir al documento lo que dice, sin certificarlo como hecho CRM. |
| Aclaración y límites | Identificar oportunidad o documento si hay ambigüedad. No prometer lectura de contrato, PDF u otro formato si el canal no lo admite. |
| Aceptación específica | Productos, cantidades y condiciones coinciden con fuente; costos, margen y notas internas no se exponen; texto truncado no se presenta como documento completo; cotización aceptada no demuestra compra o entrega. |
| Decisión propuesta | Validar cotización y revisión exactas, múltiples candidatos, cantidades por partida, condiciones y exclusiones explícitas, permisos, errores, recorte de texto/presentación, citas y auditoría, continuidad y cambio de fuente. Confirmar que no se expongan costos/márgenes internos ni se certifiquen compra o entrega. Ampliar documentos solo con lector autorizado y demanda probada. |

##### Q10 — Requisitos para avanzar de etapa (`query.stage_readiness`)

| Campo | Definición |
| --- | --- |
| Definición | Revisar los requisitos y respuestas de la etapa actual para mostrar qué está cubierto, qué falta y qué no puede comprobarse. |
| Necesidad | Entender la preparación de la oportunidad antes de intentar avanzar en el proceso comercial. |
| Prioridad propuesta | **P0:** conecta el seguimiento del vendedor con los criterios del proceso. |
| Ejemplo de uso | Revisar las preguntas pendientes antes de pedir una revisión de la oportunidad. |
| Cómo distinguirla | Describe requisitos configurados, no inventa nuevos. Recomendar cómo resolverlos es orientación; cambiar la etapa es una acción distinta. |
| Preguntas de prueba | «¿Qué falta para pasar de etapa?»; «¿Qué preguntas están sin contestar?»; «¿Ya cumple Alfa los requisitos?». |
| Actual | Disponible para preparación y requisitos de etapa expuestos. |
| Datos necesarios | Etapa vigente, criterios/preguntas y respuestas autorizadas de la oportunidad. |
| Objetivo | Separar cumplido, pendiente y no comprobable; explicar cada brecha con el criterio correspondiente. |
| Aclaración y límites | Las respuestas vacías son parte del resultado, no motivo para impedir mostrar lo que falta. Consultar readiness no cambia la etapa. |
| Aceptación específica | Preguntas y respuestas concuerdan con fixture; no inventar criterios; identificar ausencia de datos; no afirmar que el servidor autorizó una transición solo por una recomendación. |
| Decisión propuesta | Validar como capacidad central y conectar el análisis con siguientes pasos útiles. |

##### Q11 — Ayuda para usar el sistema (`query.system_help`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar instrucciones sobre dónde encontrar o cómo utilizar una función de la aplicación. |
| Necesidad | Completar una tarea en el CRM sin tener que conocer previamente su navegación o procedimiento. |
| Prioridad propuesta | **P2:** desarrollar ayuda documental; **P0:** reconocer su ausencia sin inventar instrucciones. |
| Ejemplo de uso | Pedir dónde editar un contacto o cómo cambiar una configuración. |
| Cómo distinguirla | Explicar el significado de un concepto comercial no es ayuda de navegación. Una capacidad reconocida no implica disponer de documentación fiable del sistema. |
| Preguntas de prueba | «¿Cómo cambio las notificaciones?»; «¿Dónde edito el contacto?»; «¿Cómo confirmo esta propuesta?». |
| Actual | No disponible como herramienta de documentación del sistema. Esto no impide que una respuesta de flujo explique un control que realmente conoce. |
| Datos necesarios | Para ampliar: documentación versionada y autorizada, vinculada a versión y permisos de la interfaz. |
| Objetivo | Por ahora reconocer el límite. Una futura ayuda debe ofrecer pasos y destinos verificados, sin inventar pantallas o botones. |
| Aclaración y límites | Pedir pantalla o tarea si fuese necesario en una futura ayuda; no simular navegación ni configuraciones. |
| Aceptación específica | Solicitud reconocida sin consulta CRM irrelevante; no dar pasos no verificables; si se deriva, usar únicamente destinos conocidos y autorizados. |
| Decisión propuesta | Mantener límite inicial y evaluar demanda antes de construir búsqueda documental. |

##### Q12 — Consultar notas de oportunidad (`query.opportunity_notes`)

| Campo | Definición |
| --- | --- |
| Definición | Leer el historial de notas individuales de una oportunidad identificada y autorizada. |
| Necesidad | Recuperar reportes ya registrados sin confundirlos con actividades o respuestas de etapa. |
| Prioridad propuesta | **P1:** consulta de solo lectura y acotada a una oportunidad de la cuenta fija. |
| Ejemplo de uso | «¿Qué notas tiene Hardware Refresh?»; «¿Qué se registró sobre el presupuesto?». |
| Cómo distinguirla | Solo responde sobre notas persistidas. La ausencia de notas no demuestra que el vendedor o el cliente no hayan reportado algo fuera del sistema. |
| Actual | Disponible para una oportunidad identificada; se muestran hasta 50 notas recientes y se informa si existen notas anteriores. |
| Datos necesarios | Permiso de lectura, cuenta activa autorizada, oportunidad perteneciente a esa cuenta y lectura completa del historial solicitado. |
| Objetivo | Presentar texto, atribución, certeza, autoría y fecha conservando matices. |
| Aclaración y límites | Ante destino ambiguo pide selección; no elige silenciosamente entre oportunidades. Errores de acceso no se presentan como historial vacío. |
| Aceptación específica | Solo notas de la oportunidad confirmada; historial vacío explícito; atribución e incertidumbre intactas; no mezcla tareas, actividades o respuestas de etapa. |
| Decisión propuesta | Consultar en modo read-only; persistencia CRM no pertenece a esta categoría. |

#### B. Orientación: 8 categorías

##### G01 — Diagnóstico de la situación comercial (`guidance.situation_assessment`)

| Campo | Definición |
| --- | --- |
| Definición | Interpretar la información disponible para explicar cómo se encuentra una cuenta u oportunidad y en qué se basa esa evaluación. |
| Necesidad | Pasar de conocer datos aislados a entender su significado comercial y las incertidumbres importantes. |
| Prioridad propuesta | **P0:** capacidad central de acompañamiento del vendedor. |
| Ejemplo de uso | Evaluar si una oportunidad muestra avance, falta de información o señales de estancamiento. |
| Cómo distinguirla | Un resumen enumera lo registrado; el diagnóstico explica qué puede significar. No es una probabilidad de cierre ni una certificación de salud del cliente. |
| Preguntas de prueba | «¿Cómo ves Alfa?»; «¿Está avanzando o se estancó?»; «Evalúa esta cuenta». |
| Actual | Disponible con evidencia autorizada; la orientación de cuenta y de oportunidad usa rutas de lectura distintas. |
| Datos necesarios | Estado/etapa, respuestas disponibles, actividad y señales recuperables según el objeto. |
| Objetivo | Diagnóstico breve con hechos, interpretación y brechas separados; no un juicio genérico o una predicción de cierre. |
| Aclaración y límites | Si falta información, explicar cómo afecta el diagnóstico y qué investigar. No exigir responder todas las preguntas de etapa para orientar. |
| Aceptación específica | Cada motivo remite a un dato o brecha real; evitar «saludable» por falta de eventos; no asignar probabilidad de éxito inventada; objeto evaluado correcto. |
| Decisión propuesta | Validar utilidad y fundamento en escenarios con información incompleta. |

##### G02 — Riesgos e información faltante (`guidance.risks_and_gaps`)

| Campo | Definición |
| --- | --- |
| Definición | Señalar condiciones que podrían dificultar el avance y datos que todavía se necesitan para evaluar o gestionar mejor el caso. |
| Necesidad | Identificar a tiempo qué validar, prevenir o atender, sin confundir una duda con un problema confirmado. |
| Prioridad propuesta | **P0:** necesaria para orientar decisiones sin ocultar incertidumbre. |
| Ejemplo de uso | Preparar una negociación cuando no están claros presupuesto, responsables o próximos pasos. |
| Cómo distinguirla | Un riesgo es una posible dificultad; una brecha es información o preparación faltante. Presupuesto no registrado no significa presupuesto inexistente. |
| Preguntas de prueba | «¿Qué riesgos ves?»; «¿Dónde está débil Alfa?»; «¿Qué información me falta para negociar?». |
| Actual | Disponible: riesgos y brechas desde datos disponibles, diferenciados de hechos. |
| Datos necesarios | Señales de actividad, etapa, campos y criterios relevantes; no requiere conocer hechos que todavía se buscan. |
| Objetivo | Por cada riesgo: señal observada, impacto plausible y acción de validación o mitigación. Distinguir riesgo inferido de problema confirmado. |
| Aclaración y límites | Un presupuesto vacío no prueba que el cliente no tiene dinero; contacto no identificado no prueba que no exista decisor. |
| Aceptación específica | No elevar ausencia a hecho negativo; no inventar umbrales o puntuaciones; priorizar y justificar riesgos; responder con incertidumbre explícita cuando corresponda. |
| Decisión propuesta | Afinar respuestas verificables y accionables antes de añadir más scoring. |

##### G03 — Siguientes pasos recomendados (`guidance.next_steps`)

| Campo | Definición |
| --- | --- |
| Definición | Recomendar acciones concretas y ordenadas que el vendedor puede realizar para avanzar o resolver las brechas del caso. |
| Necesidad | Convertir el contexto disponible en una ruta inmediata de trabajo, con un propósito claro para cada paso. |
| Prioridad propuesta | **P0:** una de las principales fuentes de utilidad comercial del chat. |
| Ejemplo de uso | Decidir qué preguntar, con quién hablar o qué confirmar antes de continuar una oportunidad. |
| Cómo distinguirla | Recomendar «confirma el presupuesto» no significa registrar una tarea ni exigir que ya exista ese dato para poder recomendar obtenerlo. |
| Preguntas de prueba | «¿Qué hago ahora?»; «Dame tres pasos para avanzar»; «No tengo presupuesto confirmado, ¿cómo sigo?». |
| Actual | Disponible: recomienda sin crear actividades implícitas. |
| Datos necesarios | Entidad/foco resuelto y contexto autorizado suficiente para distinguir próximos pasos razonables. |
| Objetivo | Pasos concretos y ordenados, cada uno con objetivo y razón; sugerir preguntas o validaciones para cerrar brechas reales. |
| Aclaración y límites | Diferenciar información imprescindible para elegir objetivo de información que precisamente conviene obtener. |
| Aceptación específica | Tres pasos si se solicitan tres; no repetir datos como si fueran acciones; no convertir cada paso en operación; justificar «por qué» en el siguiente turno. |
| Decisión propuesta | Prioridad máxima de utilidad comercial junto con consultas y continuidad. |

##### G04 — Priorización de oportunidades (`guidance.prioritization`)

| Campo | Definición |
| --- | --- |
| Definición | Ordenar oportunidades autorizadas según criterios explícitos y datos comparables, explicando por qué una requiere atención antes que otra. |
| Necesidad | Distribuir el esfuerzo comercial de forma razonada cuando hay varios casos por atender. |
| Prioridad propuesta | **P1:** productividad posterior a estabilizar consultas y orientación básicas. |
| Ejemplo de uso | Elegir entre oportunidades de la cuenta según cercanía de cierre o urgencia registrada. |
| Cómo distinguirla | Comparar muestra diferencias; priorizar recomienda un orden. No equivale a predecir cuál se ganará ni permite clasificar cualquier tipo de entidad. |
| Preguntas de prueba | «¿Cuál atiendo primero?»; «Ordena Alfa y Beta por urgencia»; «Prioriza por fecha de cierre». |
| Actual | Implementado en el alcance inicial: ranking determinista de oportunidades por importe USD o cierre registrado, conjuntos nombrados/filtrados/listado previo, filtros Q04/Q05, empates, top estricto y cobertura explícita. Continuidad, explicación contra datos vigentes, actualización y ordinales revalidados. Sin scoring predictivo ni ranking genérico de otras entidades; aceptación con proveedor real pendiente. |
| Datos necesarios | Colección comparable, campos disponibles y criterio explícito o declarado en la respuesta. |
| Objetivo | Ranking razonado con criterio, datos utilizados y faltantes; admitir empates o información insuficiente para distinguir. |
| Aclaración y límites | Si la decisión cambia materialmente entre urgencia, valor o esfuerzo y no hay preferencia, aclarar o presentar criterios alternativos. No inventar un score predictivo. |
| Aceptación específica | Todas las oportunidades elegibles aparecen una vez; orden correcto para criterios objetivos; si faltan fechas o montos, explicitar efecto y no asignar valores supuestos. |
| Decisión propuesta | Validar importe y cierre, empates, valores faltantes/cero, fechas vencidas y zona de negocio, conjuntos completos, permisos, recorte de top con empate, cobertura parcial y continuidad ante datos cambiados. Cierre próximo separa fechas desde hoy, vencidas y sin fecha; el top no se amplía por empate. Ampliar scoring solo con especificación propia. |

##### G05 — Comparación de oportunidades (`guidance.comparison`)

| Campo | Definición |
| --- | --- |
| Definición | Examinar dos o más oportunidades bajo las mismas dimensiones para mostrar coincidencias, diferencias y datos faltantes. |
| Necesidad | Comprender alternativas y diferencias relevantes antes de decidir cómo atender cada caso. |
| Prioridad propuesta | **P1:** apoyo a decisiones sobre varias oportunidades de la cuenta. |
| Ejemplo de uso | Comparar monto, etapa y pendientes de Alfa y Beta sin mezclar sus datos. |
| Cómo distinguirla | No tiene que elegir una ganadora ni ordenar por urgencia; eso añade priorización. Comparar productos o competidores no está cubierto por el mero reconocimiento de esta categoría. |
| Preguntas de prueba | «Compara Alfa y Beta»; «¿Cuál está más preparada?»; «Compara sus montos y pendientes». |
| Actual | Implementado en el alcance aprobado: comparación determinista de 2–5 oportunidades de la misma cuenta; importe USD, etapa, estado y cierre por defecto, contacto solo solicitado. Matriz simétrica, cálculos con base explícita, faltantes, cobertura, continuidad, explicación/actualización, ordinales e historial. Sin pendientes, historial comparativo ni comparación universal; aceptación con proveedor real pendiente. |
| Datos necesarios | Dos o más registros autorizados y los mismos campos para cada uno, cuando existan. |
| Objetivo | Tabla o contraste simétrico, con diferencias, coincidencias y límites. Separar valores conocidos de no registrados. |
| Aclaración y límites | Resolver cada entidad sin escoger duplicados. Diferentes monedas, periodos o fuentes impiden comparar cifras directamente sin conversión válida. |
| Aceptación específica | No intercambiar datos entre oportunidades; incluir ambas aunque una esté incompleta; no declarar ganador universal por un solo campo; distinguir pedido de comparación de operación múltiple. |
| Decisión propuesta | Validar los tres casos y variantes de nombres ambiguos, 2–5 identidades distintas, campos incompletos, bases cero, porcentajes/días calendario, contactos restringidos, cobertura cambiada, permisos y continuidad. No recortar conjuntos, elegir pares ni ampliar objetos por similitud de nombre. |

##### G06 — Análisis de evolución histórica (`guidance.trend_analysis`)

| Campo | Definición |
| --- | --- |
| Definición | Analizar evolución comercial de oportunidades, etapas, cierres y pipeline con periodos comparables y estados históricos verificables. No incluye facturación ni cobros. |
| Necesidad | Detectar crecimiento, caída o patrones temporales reales, sin confundir la situación actual con la evolución del negocio. |
| Prioridad propuesta | **P2:** depende primero de disponer de datos históricos adecuados. |
| Ejemplo de uso | Comparar oportunidades registradas por mes, transiciones de etapa y pipeline al cierre de fechas concretas, con cobertura declarada. |
| Cómo distinguirla | Un historial de llamadas relata eventos; una tendencia compara mediciones en el tiempo. Sumar oportunidades actuales no reconstruye ingresos históricos. |
| Preguntas de prueba | «¿Cuántas oportunidades registramos cada mes?»; «¿Por qué etapas pasó Alfa?»; «¿Qué pipeline teníamos al cierre de septiembre?»; límites ante facturación y cobros. |
| Actual | Implementado: auditoría existente reforzada con capturas comerciales transaccionales sin caducidad, baseline idempotente, lector autorizado y motor determinista con continuidad, tablas e historial. No requiere triggers ni cambios de parámetros RDS. Finanzas aún no disponibles; aceptación con proveedor real pendiente. |
| Datos necesarios | Creación, eventos anteriores/posteriores, estados base, catálogos y cobertura. Sin historia suficiente no se certifican cortes ni duraciones. |
| Objetivo | Mostrar series, transiciones, permanencias y fotografías verificables con metodología, límites y periodos comparables. |
| Aclaración y límites | Aclarar qué variable significa «tendencia» cuando sea ambiguo; no convertir una petición histórica clara en resumen de la cuenta. |
| Aceptación específica | No producir variaciones porcentuales sin base; no equiparar monto de oportunidades a ingreso; no afirmar crecimiento por tener más registros recientes. |
| Decisión propuesta | Registrar estado base en auditoría después de desplegar los escritores transaccionales. Validar reconstrucción, rollback ante fallo de auditoría, cobertura y límites financieros. La auditoría previa es antecedente no certificado; cambios directos por SQL fuera de los flujos auditados no están garantizados. |

##### G07 — Análisis de escenarios hipotéticos (`guidance.scenario_analysis`)

| Campo | Definición |
| --- | --- |
| Definición | Explorar posibles consecuencias y alternativas bajo un supuesto expresado, sin tratarlo como un hecho que ya ocurrió. |
| Necesidad | Prepararse ante cambios posibles de presupuesto, plazo o condiciones comerciales. |
| Prioridad propuesta | **P1:** apoyo a planificación y negociación con supuestos claramente separados. |
| Ejemplo de uso | Considerar cómo adaptar la propuesta si el cliente reduce su presupuesto o retrasa el proyecto. |
| Cómo distinguirla | «Si redujeran el presupuesto» plantea un escenario; «el cliente redujo el presupuesto» reporta un hecho atribuido. Ninguno autoriza cambiar un monto CRM sin pedirlo. |
| Preguntas de prueba | «¿Qué pasa si reducen el presupuesto a la mitad?»; «¿Y si retrasan el proyecto un trimestre?»; «¿Qué alternativa propondrías?». |
| Actual | Existente en el alcance aprobado: contrato tipado, lector completo autorizado, motor determinista de importes/fechas/estados y pipeline, orientación cualitativa reglada, alternativas independientes, memoria aislada, continuidad, tablas e historial. No requiere cambios RDS. Aceptación con proveedor real pendiente. |
| Datos necesarios | Supuesto explícito, hechos base y restricciones conocidas. Un cálculo requiere base numérica y unidades verificadas. |
| Objetivo | Separar situación actual, supuesto, consecuencias posibles y alternativas de actuación. |
| Aclaración y límites | Si falta el presupuesto base, pedirlo o discutir cualitativamente. No tratar la mitad del monto de oportunidad como presupuesto del cliente por defecto. |
| Aceptación específica | Supuesto no persiste como hecho ni cambio CRM; cálculos correctos cuando procedan; sin probabilidades inventadas; retorno al contexto real al cambiar de tema. |
| Decisión propuesta | Validar los casos G07 y variantes con B3 real y revisión comercial. Corrección reemplaza; solo acumulación explícita combina cambios. Fuente cambiada exige actualizar; acción dependiente no puede usar hipótesis como confirmación. Ver [alcance G07](./chat-cliente-existente-alcance.md#escenarios-hipotéticos-verificables-g07) para reglas, selección, límites y aislamiento. |

##### G08 — Estrategia comercial y de negociación (`guidance.strategy`)

| Campo | Definición |
| --- | --- |
| Definición | Proponer un enfoque comercial con objetivo, secuencia y alternativas, adaptado a lo que se conoce de la cuenta u oportunidad. |
| Necesidad | Organizar una gestión que requiere varias conversaciones o decisiones, más allá de una siguiente tarea aislada. |
| Prioridad propuesta | **P1:** requiere validar tanto fundamento factual como utilidad comercial. |
| Ejemplo de uso | Preparar una negociación sin reducir precio o recuperar el interés de un cliente. |
| Cómo distinguirla | Los siguientes pasos orientan la acción inmediata; una estrategia explica el enfoque y la secuencia. No concede autoridad para descuentos ni garantiza resultados. |
| Preguntas de prueba | «¿Cómo negocio sin bajar precio?»; «¿Cómo recupero el interés?»; «Propón una estrategia para Alfa». |
| Actual | Disponible desde contexto autorizado; no garantiza conocimiento completo de oferta, competencia o restricciones contractuales. |
| Datos necesarios | Objetivo, contexto de oportunidad, brechas y restricciones conocidas. |
| Objetivo | Estrategia con secuencia, preguntas para validar supuestos y alternativas; distinguir prácticas generales de conclusiones sobre el cliente. |
| Aclaración y límites | No inventar descuentos autorizados, facultades del contacto, ventajas competitivas o garantías técnicas. |
| Aceptación específica | Cada recomendación vinculada al objetivo; supuestos explícitos; no prometer resultados; no proponer concesiones como ya autorizadas. |
| Decisión propuesta | Evaluar utilidad con revisión comercial humana, además de auditoría factual. |

#### C. Contenido: 9 categorías

##### C01 — Redacción de un correo (`content.email_draft`)

| Campo | Definición |
| --- | --- |
| Definición | Crear el texto de un correo a partir de un propósito, instrucciones del vendedor y contexto permitido. |
| Necesidad | Comunicar con claridad y ahorrar tiempo de redacción sin inventar acuerdos o datos del cliente. |
| Prioridad propuesta | **P1:** productividad comercial con revisión del vendedor. |
| Ejemplo de uso | Solicitar una reunión, dar seguimiento a una cotización o retomar una conversación. |
| Cómo distinguirla | Redactar entrega texto; enviar lo comunica a un destinatario y es otra categoría. Pedir una reunión por correo tampoco la deja programada. |
| Preguntas de prueba | «Redacta un correo para pedir reunión sobre Alfa»; «Dale seguimiento a la cotización sin presionar»; «No lo envíes». |
| Actual | Disponible como borrador, nunca envío. Puede incorporar contexto autorizado de oportunidad. |
| Datos necesarios | Propósito, material aportado y hechos CRM disponibles; destinatario solo si se puede verificar o lo aporta el usuario con atribución. |
| Objetivo | Asunto y cuerpo si se solicitan, tono adecuado y una llamada a la acción clara. Marcadores para datos no proporcionados. |
| Aclaración y límites | No bloquear un ejemplo por no tener una fecha; usar un marcador. No inventar que hubo una reunión o acuerdo previo. |
| Aceptación específica | Entregar correo, no resumen; sin envío ni actividad nueva; no atribuir al destinatario promesas ausentes; permitir «hazlo más corto» sin perder el propósito. |
| Decisión propuesta | Validar fidelidad al contexto, tono y edición multi-turno. |

##### C02 — Redacción de un mensaje breve (`content.message_draft`)

| Campo | Definición |
| --- | --- |
| Definición | Crear un texto corto, adecuado al canal y tono solicitados, para que el vendedor lo revise y lo use. |
| Necesidad | Mantener una comunicación ágil y pertinente sin perder profesionalismo ni precisión. |
| Prioridad propuesta | **P1:** apoyo a comunicaciones breves del trabajo diario. |
| Ejemplo de uso | Preparar un mensaje de WhatsApp para retomar contacto o solicitar una respuesta. |
| Cómo distinguirla | Se diferencia del correo por el formato solicitado, no por tener permiso para enviarlo. El chat prepara el texto, no opera la mensajería. |
| Preguntas de prueba | «Dame un WhatsApp para retomar contacto»; «En dos líneas, sin sonar insistente»; «Ahora más formal». |
| Actual | Disponible para mensaje breve, sin envío. |
| Datos necesarios | Objetivo, tono y hechos permitidos; no requiere acceso real a WhatsApp. |
| Objetivo | Texto breve, natural y pertinente, sin inventar familiaridad, acuerdos o urgencia del cliente. |
| Aclaración y límites | No afirmar integración con mensajería. Si falta nombre, emplear saludo neutro o marcador en vez de inventarlo. |
| Aceptación específica | Respetar cantidad/extensión cuando se pide; conservar hechos al cambiar tono; cero envíos y cero operaciones implícitas. |
| Decisión propuesta | Validar borrador y continuidad; mantener envío fuera del alcance inicial. |

##### C03 — Preparación de una reunión (`content.meeting_preparation`)

| Campo | Definición |
| --- | --- |
| Definición | Preparar agenda, guion, temas y resultados deseados para una reunión comercial. |
| Necesidad | Aprovechar la conversación con el cliente y enfocar el tiempo en lo que necesita aclararse o decidirse. |
| Prioridad propuesta | **P1:** preparación comercial basada en contexto disponible. |
| Ejemplo de uso | Organizar una reunión de descubrimiento o una revisión de propuesta de 30 minutos. |
| Cómo distinguirla | Preparar qué se hablará no programa la cita, confirma asistentes ni verifica su disponibilidad. |
| Preguntas de prueba | «Prepárame para la reunión de Alfa»; «Dame agenda y guion de 30 minutos»; «Incluye preguntas sobre presupuesto». |
| Actual | Disponible para agenda o guion; no programa reuniones. |
| Datos necesarios | Objetivo, etapa, brechas y contexto autorizado. Asistentes y duración solo si están disponibles o fueron aportados. |
| Objetivo | Objetivo de reunión, agenda, preguntas clave y resultado deseado. Duraciones consistentes si se solicita reparto de tiempo. |
| Aclaración y límites | Participantes sugeridos no son asistentes confirmados; agenda no es cita. |
| Aceptación específica | Duraciones suman el total solicitado; preguntas reflejan brechas reales; no inventar disponibilidad; no crear actividad ni enviar invitación. |
| Decisión propuesta | Afinar pertinencia; comprobar separación entre preparar y programar. |

##### C04 — Preguntas para conocer mejor la necesidad (`content.discovery_questions`)

| Campo | Definición |
| --- | --- |
| Definición | Redactar preguntas que el vendedor puede hacer al cliente para comprender necesidad, impacto, presupuesto, participantes o proceso de decisión. |
| Necesidad | Obtener información útil para calificar y avanzar, en vez de repetir preguntas genéricas o ya respondidas. |
| Prioridad propuesta | **P1:** apoyo a conversaciones de descubrimiento y cierre de brechas. |
| Ejemplo de uso | Preparar cinco preguntas para entender el presupuesto y la motivación de una oportunidad. |
| Cómo distinguirla | Son preguntas sugeridas para conversar, no requisitos oficiales ni nuevas preguntas configuradas en el proceso comercial. |
| Preguntas de prueba | «Dame cinco preguntas de descubrimiento»; «¿Qué le pregunto para entender el presupuesto?»; «Evita repetir lo que ya sabemos». |
| Actual | Disponible para redactar preguntas desde el contexto. |
| Datos necesarios | Etapa, respuestas existentes y brechas, si están autorizadas. |
| Objetivo | Preguntas concretas y abiertas, priorizadas o agrupadas según lo pedido. Distinguir pregunta sugerida de criterio oficial de etapa. |
| Aclaración y límites | No convertir sugerencias en preguntas configuradas en el CRM; no afirmar que una pregunta sugerida es requisito obligatorio. |
| Aceptación específica | Exactamente cinco si se solicitan cinco; no duplicados semánticos; no pedir datos ya respondidos salvo para confirmar algo relevante; ninguna escritura. |
| Decisión propuesta | Medir relevancia con revisión humana y datos completos/incompletos. |

##### C05 — Resumen de un texto o material (`content.summary`)

| Campo | Definición |
| --- | --- |
| Definición | Reducir la extensión de un contenido identificable conservando su significado y los elementos solicitados. |
| Necesidad | Revisar y comunicar lo importante de notas, documentos o conversaciones sin perder condiciones o incertidumbre. |
| Prioridad propuesta | **P1:** transformación fiel de información disponible. |
| Ejemplo de uso | Obtener dos frases de una nota o extraer decisiones y pendientes de un texto aportado. |
| Cómo distinguirla | Resume una fuente o contenido identificado. Pedir un panorama comercial de la cuenta es Q01; resumir una declaración no la verifica como hecho CRM. |
| Preguntas de prueba | «Resume este texto en dos frases»; «Haz un resumen ejecutivo de la llamada que te adjunto»; «Solo decisiones y pendientes». |
| Actual | Disponible para material aportado o contexto disponible. |
| Datos necesarios | Fuente explícita y contenido accesible; si usa CRM, lecturas autorizadas. |
| Objetivo | Resumen fiel al material y al foco pedido, con atribución si procede de usuario/documento. |
| Aclaración y límites | Si no hay texto ni antecedente identificable, pedir el material. No completar fragmentos truncados como si se hubieran leído. |
| Aceptación específica | Preservar cifras, negaciones, condiciones y responsables mencionados; no agregar decisiones; respetar dos frases cuando se pide; no sustituir por resumen de cuenta. |
| Decisión propuesta | Validar fidelidad y procedencia, especialmente con adjuntos. |

##### C06 — Explicación de conceptos o fundamentos (`content.explanation`)

| Campo | Definición |
| --- | --- |
| Definición | Explicar con lenguaje comprensible un concepto, fragmento o razonamiento relevante para el trabajo comercial. |
| Necesidad | Entender qué significa algo o por qué se recomendó un enfoque, para tomar decisiones con criterio. |
| Prioridad propuesta | **P1:** claridad y aprendizaje dentro del alcance comercial. |
| Ejemplo de uso | Entender qué es retorno de inversión o pedir el fundamento de una recomendación previa. |
| Cómo distinguirla | Explicar ROI no calcula el ROI del cliente; explicar una recomendación no la ejecuta; explicar un concepto no implica conocer cómo navegar todas las pantallas. |
| Preguntas de prueba | «Explícame retorno de inversión»; «¿Qué significa este término de la cotización?»; «¿Por qué me recomendaste eso?». |
| Actual | Disponible para explicación de términos y contenido; no consulta externa libre ni ayuda documental general del sistema. |
| Datos necesarios | Término/texto a explicar o respuesta previa; evidencia si se explican hechos de un registro. |
| Objetivo | Explicación clara con ejemplo identificado como ilustrativo; si se pide fundamento, relacionarlo con la recomendación previa y sus fuentes. |
| Aclaración y límites | No calcular ROI real sin costos/beneficios; no inventar funcionalidades de un producto o reglas del sistema. |
| Aceptación específica | Concepto correcto; ejemplo no atribuido al cliente; «por qué» no ejecuta ni repite mecánicamente la propuesta; pendientes previos se conservan. |
| Decisión propuesta | Validar utilidad y diferencia entre explicación, justificación y consulta factual. |

##### C07 — Reescritura y ajuste de un borrador (`content.rewrite`)

| Campo | Definición |
| --- | --- |
| Definición | Modificar la forma de un texto existente —tono, claridad, estructura o extensión— manteniendo su contenido, salvo cambios explícitos. |
| Necesidad | Adaptar una comunicación al destinatario sin alterar cifras, compromisos o condiciones por accidente. |
| Prioridad propuesta | **P1:** edición útil y confiable de material comercial. |
| Ejemplo de uso | Acortar un correo, hacerlo más formal o quitar un tono insistente. |
| Cómo distinguirla | Requiere un texto de partida. Crear desde cero es redacción; cambiar un importe en un borrador no actualiza el importe de la oportunidad. |
| Preguntas de prueba | «Hazlo más breve»; «Reescribe esto formalmente»; «Quita la presión comercial, conserva el monto». |
| Actual | Disponible para material aportado y edición del contenido identificable. |
| Datos necesarios | Texto fuente y cambios pedidos; antecedente inequívoco para «hazlo». |
| Objetivo | Nueva versión que preserve significado, cifras, negaciones y condiciones, salvo cambios explícitos del vendedor. |
| Aclaración y límites | Si existen varios borradores plausibles, aclarar cuál editar. Editar una promesa en texto no la vuelve hecho CRM. |
| Aceptación específica | No alterar monto/fecha/contacto por estilo; respetar extensión verificable; no recuperar borrador de otra cuenta; no enviar ni guardar automáticamente. |
| Decisión propuesta | Priorizar regresiones multi-turno de modificación de borrador. |

##### C08 — Traducción de material (`content.translation`)

| Campo | Definición |
| --- | --- |
| Definición | Expresar un contenido en otro idioma conservando su significado, cifras, nombres y condiciones. |
| Necesidad | Comunicarse con participantes de otros idiomas sin modificar lo que se ofrece o se reporta. |
| Prioridad propuesta | **P1:** soporte lingüístico sujeto a revisión cuando el contenido sea sensible. |
| Ejemplo de uso | Traducir un correo al inglés manteniendo nombres de producto, precios y plazos. |
| Cómo distinguirla | Traducir no resume ni añade términos comerciales; tampoco certifica equivalencia jurídica de un contrato. |
| Preguntas de prueba | «Traduce este correo al inglés»; «Ahora en español, sin cambiar las cifras»; «Mantén los nombres de producto». |
| Actual | Disponible para material aportado; no certificación de traducción contractual. |
| Datos necesarios | Texto fuente, idioma destino y términos que se deban preservar. |
| Objetivo | Traducción completa y fiel; mantener cifras, unidades, nombres, incertidumbre y estructura útil. |
| Aclaración y límites | Pedir idioma si no está definido. No agregar términos comerciales ni certificar equivalencia jurídica. |
| Aceptación específica | Ninguna sección omitida; números y monedas intactos; negaciones preservadas; marcadores sin completar no se vuelven datos inventados. |
| Decisión propuesta | Validar fidelidad con revisión bilingüe en casos representativos. |

##### C09 — Argumento de valor para el cliente (`content.value_argument`)

| Campo | Definición |
| --- | --- |
| Definición | Redactar una explicación de cómo una propuesta podría atender una necesidad conocida, diferenciando beneficios esperados de resultados demostrados. |
| Necesidad | Justificar la relevancia de la propuesta con lenguaje específico del cliente, sin recurrir a promesas o ahorros inventados. |
| Prioridad propuesta | **P1:** apoyo a propuesta y negociación con fundamento verificable. |
| Ejemplo de uso | Explicar por qué una solución puede ayudar a reducir un riesgo que el cliente reportó. |
| Cómo distinguirla | Es un texto persuasivo respaldado, no una garantía, estudio financiero ni autorización para inventar capacidades de producto. |
| Preguntas de prueba | «Dame un argumento de valor para Alfa»; «¿Cómo justifico la inversión?»; «Explica el valor sin inventar ahorros». |
| Actual | Disponible sin métricas inventadas, desde contexto autorizado. |
| Datos necesarios | Necesidad conocida, solución/cotización disponible y capacidades verificables, o supuestos explícitos. |
| Objetivo | Relacionar necesidad, impacto plausible y propuesta; diferenciar beneficio esperado de resultado demostrado. |
| Aclaración y límites | No inventar ahorros, ROI, certificaciones o funcionalidades. Si falta oferta validada, producir estructura con marcadores o pedir material. |
| Aceptación específica | Cada afirmación de producto debe tener fuente o quedar como algo por validar; cifras solo si aportadas o calculables; sin garantías de resultados ni descuentos no autorizados. |
| Decisión propuesta | Validar soporte factual y utilidad comercial por separado. |

#### D. Reportes: 6 categorías

Los reportes aportan información nueva; no tienen que existir previamente en
CRM. Validar el destino no certifica la veracidad del contenido. En el flujo
actual, la asociación prepara un complemento revisable de una pregunta de etapa;
no es un diario general de notas ni un guardado automático.

##### R01 — Información comunicada por el cliente (`report.client_statement`)

| Campo | Definición |
| --- | --- |
| Definición | Recibir información que el vendedor atribuye al cliente, conservando lo dicho y si se presenta como certeza, sospecha o información pendiente de confirmar. |
| Necesidad | Aprovechar información nueva de conversaciones sin exigir que ya exista en CRM ni convertirla en un hecho verificado por el sistema. |
| Prioridad propuesta | **P0:** recorrido esencial de captura y revisión de información comercial. |
| Ejemplo de uso | Compartir que el cliente busca reducir fugas de información o sospecha un problema que aún no ha confirmado. |
| Cómo distinguirla | «El cliente sospecha» sigue siendo un reporte del cliente; «yo supongo» es una hipótesis del vendedor. Informar no equivale a autorizar guardar. |
| Preguntas de prueba | «El cliente dice que busca reducir fugas»; «Sospechan que envían información por correo»; «Eso corresponde a Alfa». |
| Actual | Disponible: atribución al cliente, incluida sospecha; puede preparar complemento de etapa con destino autorizado y revisión. |
| Datos necesarios | Texto del reporte, atribución/certeza, oportunidad editable y preguntas candidatas disponibles. |
| Objetivo | Conservar texto y grado de certeza; asociarlo a una pregunta inequívoca o pedir destino específico. |
| Aclaración y límites | No exigir que CRM pruebe un reporte nuevo. No confundir sospecha del cliente con hipótesis propia del vendedor. |
| Aceptación específica | Fragmento original preservado; selección posterior no lo reemplaza por «la primera»; respuesta vigente de etapa se conserva; cero guardados antes de revisión. |
| Decisión propuesta | Validar como recorrido crítico, incluidas corrección, selección y persistencia del borrador. |

##### R02 — Observación directa del vendedor (`report.seller_observation`)

| Campo | Definición |
| --- | --- |
| Definición | Recibir algo que el vendedor afirma haber observado directamente, preservando que esa es la fuente de la información. |
| Necesidad | Incorporar contexto de primera mano sin atribuírselo al cliente ni darlo por verificado por el CRM. |
| Prioridad propuesta | **P0:** mantener correctamente la fuente y el significado de la información nueva. |
| Ejemplo de uso | Reportar lo observado durante una reunión o visita y corregir después si no fue una observación directa. |
| Cómo distinguirla | Observar es distinto de inferir. Si el vendedor aclara que solo lo supuso, debe tratarse como hipótesis, no como observación confirmada. |
| Preguntas de prueba | «Observé que no había un responsable asignado»; «Vi que aún no terminaron la evaluación»; «Corrijo: eso lo supuse, no lo observé». |
| Actual | Disponible como observación atribuida al vendedor; posible complemento de etapa bajo el flujo de revisión. |
| Datos necesarios | Texto, fuente declarada y destino autorizado si se prepara complemento. |
| Objetivo | Conservar observación sin elevarla a hecho confirmado por el sistema. Cambiar atribución/certeza si el vendedor corrige su fuente. |
| Aclaración y límites | No deducir resultados técnicos o comerciales más allá de lo observado. Si no hay destino editable, explicar la limitación. |
| Aceptación específica | Fuente vendedor visible en complemento; no cambiar «observé» por «cliente confirmó»; corrección actual prevalece; ninguna escritura automática. |
| Decisión propuesta | Evaluar atribución, correcciones y continuidad junto con R01. |

##### R03 — Resultado informado de una conversación (`report.interaction_outcome`)

| Campo | Definición |
| --- | --- |
| Definición | Recibir el resultado narrado de una interacción, como una llamada, reunión o demostración, sin asumir que se pidió registrarla como actividad. |
| Necesidad | Dar contexto sobre avances, rechazos o asuntos pendientes derivados de una conversación. |
| Prioridad propuesta | **P0:** evitar confundir relatos comerciales con órdenes de escritura. |
| Ejemplo de uso | Informar que el cliente rechazó una demostración o que una reunión terminó sin presupuesto confirmado. |
| Cómo distinguirla | «La llamada terminó así» informa; «registra la llamada» solicita una acción. El chat debe respetar expresamente «solo te informo». |
| Preguntas de prueba | «El cliente rechazó la demo; solo te informo»; «Terminamos la reunión y falta el presupuesto»; «No registres una actividad». |
| Actual | Disponible como reporte; no registra automáticamente una actividad. Puede requerir destino de etapa para un complemento revisable. |
| Datos necesarios | Resultado aportado y contexto de oportunidad; preguntas editables si se usa el complemento. |
| Objetivo | Reconocer el resultado sin convertir el verbo narrado en orden operativa. Explicar si solo queda en conversación o si hay un borrador preparado. |
| Aclaración y límites | No afirmar «actividad registrada» ni inventar hora, asistentes o estado. Registrar explícitamente es otra solicitud. |
| Aceptación específica | Negativa «no registres» respetada; cero operaciones; si no existe asociación de etapa, no prometer una nota persistida; reporte conservado al aclarar destino. |
| Decisión propuesta | Validar frontera entre narrar un resultado y registrar actividad completada. |

##### R04 — Compromiso comunicado (`report.commitment`)

| Campo | Definición |
| --- | --- |
| Definición | Recibir un compromiso informado: quién dijo que haría qué y, si se conoce, en qué plazo, conservando su grado de confirmación. |
| Necesidad | Mantener el contexto de acuerdos o promesas para orientar el seguimiento sin dar por hecho que ya se cumplieron. |
| Prioridad propuesta | **P0:** separación confiable entre lo acordado, lo pendiente y lo registrado. |
| Ejemplo de uso | Compartir que el cliente enviará el presupuesto el viernes o revisará la propuesta la siguiente semana. |
| Cómo distinguirla | Un compromiso reportado no es una actividad programada ni un resultado cumplido. Preparar un recordatorio requiere otra solicitud explícita. |
| Preguntas de prueba | «El cliente prometió enviar presupuesto el viernes»; «Quedó en revisarlo la próxima semana; solo te informo»; «Todavía no está confirmado». |
| Actual | Disponible como compromiso informado; no programa reunión ni actividad por sí mismo. |
| Datos necesarios | Quién se comprometió, a qué y cuándo según lo aportado; destino autorizado si se prepara complemento. |
| Objetivo | Preservar compromiso como reportado y distinguir fecha comunicada de fecha de actividad guardada. |
| Aclaración y límites | Una referencia temporal imprecisa no autoriza inventar fecha/hora exactas; no tratar intención tentativa como acuerdo firme. |
| Aceptación específica | No crea seguimiento automáticamente; conserva «tentativo» o «por confirmar»; si luego se pide programar, usar el flujo de propuesta y sus campos pendientes. |
| Decisión propuesta | Validar especialmente reporte seguido de petición explícita de actividad. |

##### R05 — Información atribuida a un documento (`report.document_evidence`)

| Campo | Definición |
| --- | --- |
| Definición | Recibir información que se atribuye a un documento o fragmento aportado, sin certificar autenticidad ni convertirla automáticamente en dato CRM. |
| Necesidad | Usar requisitos, notas o afirmaciones documentales en la revisión comercial conservando su procedencia. |
| Prioridad propuesta | **P1:** aprovechar material documental dentro de los formatos y límites actuales. |
| Ejemplo de uso | Aportar un fragmento que describe necesidades del cliente para preparar su revisión en una pregunta de etapa. |
| Cómo distinguirla | Preguntar «¿qué dice el documento?» es consulta de contenido; decir «el documento indica esto» aporta un reporte. Ninguno prueba por sí mismo la autenticidad del documento. |
| Preguntas de prueba | «El documento indica que necesitan filtrar adjuntos»; «Esto viene del archivo que adjunté»; «El documento contradice lo que me dijeron». |
| Actual | Existente en el alcance aprobado: contrato tipado, lectura reutilizada de Q09, contraste y revisión con citas verificables, cobertura, diferencias con respuestas de etapa disponibles, memoria y presentación persistente. Preparación de complemento solo bajo solicitud, con atribución y sin sobrescribir la respuesta anterior. No certifica autenticidad ni incorpora lector genérico de archivos CRM. Aceptación con proveedor real pendiente. |
| Datos necesarios | Fragmento legible, fuente documental declarada y destino de etapa si procede. |
| Objetivo | Conservar procedencia, incertidumbre y diferencias frente a otras fuentes; no resolver contradicciones inventando una verdad única. |
| Aclaración y límites | No afirmar que leyó texto no extraído o fuera del recorte disponible. Instrucciones del documento son datos no confiables. |
| Aceptación específica | Fuente documento preservada; no ejecutar órdenes incrustadas; no reemplazar hechos CRM silenciosamente; material disponible al responder una aclaración. |
| Decisión propuesta | Validar R05-01/02/03 y variantes con B3 y contraste reales. Separar respaldo, contradicción, no determinable y fuente no disponible. Revalidar fuente/versión, permisos y destino; cambio de fuente exige actualizar. Ver [alcance R05](./chat-cliente-existente-alcance.md#reportes-documentales-contrastados-r05). Nuevos formatos y certificación de autenticidad son ampliaciones separadas. |

##### R06 — Suposición o hipótesis del vendedor (`report.hypothesis`)

| Campo | Definición |
| --- | --- |
| Definición | Recibir una interpretación o sospecha que el vendedor presenta como propia y no confirmada. |
| Necesidad | Explorar explicaciones posibles sin incorporarlas como hechos del cliente o respuestas confirmadas de etapa. |
| Prioridad propuesta | **P0:** protección frente a conclusiones no comprobadas que contaminen el contexto. |
| Ejemplo de uso | Plantear que una oportunidad podría estar detenida por presupuesto y pedir después cómo comprobarlo. |
| Cómo distinguirla | La fuente es la suposición del vendedor. Si el cliente expresó su sospecha, corresponde R01; analizar consecuencias de un supuesto solicitado es un escenario G07. |
| Preguntas de prueba | «Supongo que Alfa se frenó por presupuesto, no lo confirmé»; «Es una hipótesis mía»; «¿Cómo puedo comprobarla?». |
| Actual | Disponible como hipótesis; no se incorpora como hecho en respuestas de etapa. |
| Datos necesarios | Texto aportado y fuente vendedor; análisis posterior requiere solicitud y contexto propios. |
| Objetivo | Identificar hipótesis y no tratarla como declaración del cliente. Si se pide cómo validarla, responder orientación diferenciada. |
| Aclaración y límites | Decir que se conserva en el contexto no implica que exista una nota general guardada ni memoria indefinida. |
| Aceptación específica | Cero complemento de etapa factual y cero operaciones por la hipótesis; turnos posteriores no la convierten en hecho; «el cliente sospecha» debe seguir R01, no R06. |
| Decisión propuesta | Proteger esta separación como criterio crítico. |

#### E. Acciones: 11 categorías

En todas las acciones, «completed» del componente significa solicitud atendida
o propuesta preparada, no escritura CRM completada. La ejecución depende del
flujo autorizado, sus permisos, estado, versión y confirmación.

##### A01 — Preparación de un registro nuevo (`action.create_record`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar que se prepare la creación de un contacto u oportunidad, con los datos proporcionados y los campos que todavía deban completarse. |
| Necesidad | Llevar información de la conversación a un borrador revisable sin recapturarla, manteniendo los controles del módulo de destino. |
| Prioridad propuesta | **P1:** solo para tipos habilitados y con los permisos correspondientes. |
| Ejemplo de uso | Preparar un contacto nuevo del cliente o una oportunidad detectada durante la conversación. |
| Cómo distinguirla | Crear añade un registro; actualizar modifica uno existente. Reconocer la petición no significa que el registro ya se haya creado ni que puedan crearse cuentas en este canal. |
| Preguntas de prueba | «Crea un contacto llamado Elena»; «Quiero una oportunidad nueva, Gamma»; «Crea otra cuenta». |
| Actual | **Existente dentro del alcance aprobado:** borrador tipado de contacto u oportunidad, valores con procedencia literal, pendientes, continuidad, coincidencias y traslado al módulo existente. Política, permisos de creación/solicitud, cuenta y revisión vigente se revalidan al continuar. Crear oportunidad requiere habilitación explícita; no crea cuentas ni guarda desde el chat. Aceptación con proveedor real y vendedores pendiente. Véase [alcance A01](./chat-cliente-existente-alcance.md#borradores-de-contacto-y-oportunidad-a01). |
| Datos necesarios | Tipo soportado, cuenta padre, campos requeridos, permisos y política; comprobaciones propias del módulo al guardar. |
| Objetivo | Preparar borrador revisable con datos aportados y campos pendientes, o explicar deshabilitación/no disponibilidad. |
| Aclaración y límites | Una oportunidad nueva no exige identificar una oportunidad existente. No inventar correo, importe, etapa o fecha para completar requisitos. |
| Aceptación específica | Tipo y cuenta correctos; datos faltantes visibles; crear cuenta no se convierte en crear contacto; no prometer ausencia de duplicados sin validación del módulo; cero creación antes de confirmación. |
| Decisión propuesta | Mantener el alcance implementado y validar contacto y oportunidad por separado con proveedor real. No habilitar globalmente operaciones como efecto secundario; conservar controles y aprobación del módulo. |

##### A02 — Preparación de cambios en datos (`action.update_fields`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar una propuesta para cambiar uno o más datos permitidos de una cuenta, contacto u oportunidad identificados. |
| Necesidad | Corregir o actualizar información mostrando qué valor existe y cuál se propone, antes de guardar. |
| Prioridad propuesta | **P1:** actualización controlada de campos permitidos, no edición universal o masiva. |
| Ejemplo de uso | Cambiar el monto de una oportunidad o corregir el teléfono de un contacto mediante revisión. |
| Cómo distinguirla | Consultar un dato no pide modificarlo. Cambios de etapa, estado y respuestas del proceso tienen categorías y controles propios; no deben eludirse con edición genérica. |
| Preguntas de prueba | «Cambia el monto de Alfa a 25000 dólares»; «Actualiza el teléfono de Elena»; «Cambia el monto de todas». |
| Actual | **Existente dentro del alcance aprobado:** contrato tipado, campos A02 de cuenta/contacto/oportunidad, procedencia literal, destino autorizado único, antes/después real, cola y continuidad. Revalidación en propuesta/revisión/ejecución, invalidación de revisión, idempotencia y auditoría transaccional. Sin actualización arbitraria o masiva. Aceptación con proveedor real y vendedores pendiente. Véase [alcance A02](./chat-cliente-existente-alcance.md#actualizaciones-controladas-de-campos-a02). |
| Datos necesarios | Registro único, campo permitido, valor vigente, valor solicitado y autorización. |
| Objetivo | Mostrar propuesta con antes/después, unidades, objetivo y revisión necesaria. Pedir datos indispensables que falten. |
| Aclaración y límites | Colección exige elegir un objetivo. Ambigüedad de moneda o importe no se resuelve inventando conversión; no usar propuesta desactualizada tras cambio concurrente. |
| Aceptación específica | Valores exactos; solo campo permitido; importe válido conforme al módulo; registro terminal o permiso denegado se bloquean; sin escritura antes de confirmar. |
| Decisión propuesta | Mantener el catálogo garantizado documentado; ampliar campos o tipos únicamente con controles y aceptación específicos. |

##### A03 — Preparación de una respuesta de etapa (`action.update_stage_answer`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar explícitamente una propuesta para actualizar la respuesta de una pregunta del proceso comercial en una oportunidad. |
| Necesidad | Mantener actualizada la información de calificación y avance, dejando claro qué pregunta y respuesta se revisarán. |
| Prioridad propuesta | **P0:** actualización revisable de información central del proceso. |
| Ejemplo de uso | Pedir que se añada una motivación confirmada sin borrar la respuesta previa o que se corrija el presupuesto informado. |
| Cómo distinguirla | Un reporte aporta información y puede preparar un complemento; aquí existe una petición explícita de actualización. Responder una pregunta de etapa no cambia automáticamente la etapa. |
| Preguntas de prueba | «Actualiza la motivación de Alfa a reducir fugas»; «Agrega esta información sin borrar lo anterior»; «Cambia la respuesta de presupuesto». |
| Actual | Disponible como propuesta de respuesta de etapa con revisión/confirmación. Se distingue del complemento preparado desde un reporte. |
| Datos necesarios | Oportunidad editable, pregunta válida, respuesta vigente, intención de reemplazar o complementar y texto nuevo. |
| Objetivo | Mostrar claramente qué pregunta y texto se revisarán. Respetar la diferencia entre reemplazar y añadir, según permita el flujo. |
| Aclaración y límites | Si hay varias preguntas plausibles, pedir selección. No editar otra etapa o pregunta por similitud ni completar otras respuestas implícitamente. |
| Aceptación específica | Pregunta/entidad correctas; respuesta previa conservada cuando se pidió añadir; operación incompatible con estado bloqueada; guardar requiere flujo autorizado y validación vigente. |
| Decisión propuesta | Validar este recorrido y el de reportes como controles independientes. |

##### A04 — Preparación de un vínculo contacto-oportunidad (`action.link_records`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar una propuesta para asociar un contacto autorizado a una oportunidad concreta. |
| Necesidad | Mantener claro qué persona participa en qué caso comercial y revisar ambos extremos antes de guardar la relación. |
| Prioridad propuesta | **P1:** requiere habilitación explícita y permisos. |
| Ejemplo de uso | Preparar la asociación de Elena a Alfa después de identificar a la persona que participará en el seguimiento. |
| Cómo distinguirla | Consultar quién está asociado es lectura; vincular pide un cambio. No significa crear el contacto ni asociar libremente cualquier par de registros. |
| Preguntas de prueba | «Vincula Elena a Alfa»; «Asocia el segundo contacto»; «Relaciona a un contacto de otra cuenta». |
| Actual | **Existente dentro del alcance aprobado:** contrato tipado y borrador versionado, resolución autorizada de ambos extremos, relación actual/propuesta y sustitución explícita, continuidad y traslado revalidado. Guardado exclusivo de asociación en Oportunidades con control de concurrencia, auditoría/historia G06 y finalización transaccional. Sigue siendo opt-in; no relaciones universales ni múltiples contactos asociados. Aceptación con proveedor real y vendedores pendiente. Véase [alcance A04](./chat-cliente-existente-alcance.md#vínculos-contacto-oportunidad-a04). |
| Datos necesarios | Ambas entidades autorizadas, cuenta/vínculo permitido, relación actual, permisos y política habilitada. |
| Objetivo | Presentar contacto y oportunidad concretos antes de confirmar; informar si ya existe el vínculo o hay una relación que revisar. |
| Aclaración y límites | Resolver ambos extremos; no elegir contacto por orden de consulta sin selección válida; no crear uno nuevo como sustituto. |
| Aceptación específica | Dos IDs correctos; sin relaciones cruzadas indebidas; no sobrescritura silenciosa; rechazo explícito de vínculo no soportado o deshabilitado. |
| Decisión propuesta | Mantener opt-in y el modelo de un contacto asociado; ampliar relaciones solo con contrato, modelo de datos y aceptación específicos. |

Validación técnica A04: **1.552 pruebas aprobadas y 7 live omitidas en 51
archivos**, incluidos **30 casos A04 en MySQL aislado**. Cinco pruebas de navegador
verifican traslado desde chat, preservación del flujo legacy, confirmación,
conflicto concurrente y rechazo de respuestas incompletas. Build web aprobado.
La comprobación separada del baseline legacy conserva exactamente los 15 fallos
preexistentes (103 pruebas aprobadas), sin fallos adicionales.
Sin proveedor real de IA, escrituras CRM productivas ni cambios RDS; la
habilitación administrativa y aceptación con vendedores permanecen pendientes.

##### A05 — Preparación de una actividad futura o realizada (`action.schedule_activity`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar un borrador de actividad de una oportunidad: una gestión futura o el registro de una gestión que ya ocurrió. |
| Necesidad | Organizar y documentar el seguimiento con datos conocidos, completando lo faltante sin inventar fechas o acuerdos. |
| Prioridad propuesta | **P0:** recorrido operativo principal de la primera versión. |
| Ejemplo de uso | Preparar una reunión de seguimiento o registrar una llamada realizada ayer con su resultado. |
| Cómo distinguirla | El código técnico incluye actividades realizadas aunque diga schedule. Preparar una agenda de reunión solo genera contenido; reprogramar una actividad ya guardada es otra categoría. |
| Preguntas de prueba | «Programa una reunión sobre Alfa»; «Mejor el viernes a las cuatro»; «Registra la llamada que tuve ayer»; «La próxima semana, aún sin hora». |
| Actual | Disponible: borrador de actividad; también se usa para actividad completada de oportunidad, pese al nombre de la categoría. Fecha/hora faltantes permanecen pendientes. |
| Datos necesarios | Oportunidad autorizada, tipo, timing futura/realizada, datos aportados, vínculos de contacto si aplica, zona horaria del negocio y permisos requeridos. |
| Objetivo | Borrador con datos conocidos y faltantes; distinguir programada de realizada; preservar notas y resultado al completar datos por turnos. |
| Aclaración y límites | «La próxima semana» no es fecha/hora exacta. Si no se sabe si la llamada ya ocurrió, preguntar. No afirmar acuerdo del cliente ni disponibilidad. |
| Aceptación específica | Fecha relativa resuelta con reloj/zona fijos; ningún día/hora inventado; estado coherente con timing; selección de cuenta/entidad revalidada; se requieren permisos de calendario y oportunidad más ejecución del canal. |
| Decisión propuesta | Consolidar preparación, aclaraciones, descarte y entrega a Calendario antes de añadir reprogramación. |

##### A06 — Reprogramación de una actividad guardada (`action.reschedule_activity`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar el cambio de fecha u hora de una actividad que ya está guardada, conservando su identidad. |
| Necesidad | Ajustar el seguimiento sin crear una segunda actividad ni perder el registro original. |
| Prioridad propuesta | **P2:** función nueva por evaluar; **P0:** reconocer el límite sin simular el cambio. |
| Ejemplo de uso | Mover una llamada programada del martes al viernes. |
| Cómo distinguirla | Cambiar fecha en un borrador aún no guardado es edición del borrador. Reprogramar modifica un registro existente y no puede sustituirse creando otro. |
| Preguntas de prueba | «Mueve la reunión del martes al viernes»; «Reprograma la llamada ya guardada»; «Cámbiala a las cinco». |
| Actual | **Existente dentro del alcance aprobado:** una actividad pendiente de oportunidad de la cuenta fija, resolución autorizada, memoria/revisión independiente, programación anterior/propuesta, zona horaria y confirmación transaccional en Calendario. Habilitación explícita de `reschedule_activity`; aceptación con proveedor real y vendedores pendiente. |
| Datos necesarios | Actividad única verificada, oportunidad abierta autorizada, programación/estado vigente, nueva fecha/hora, zona del negocio, permisos y política habilitada. |
| Objetivo | Conservar el mismo ID y cambiar solo programación después de revisar y confirmar en Calendario. No crear una actividad sustituta. |
| Aclaración y límites | Una modificación de borrador debe reconocerse por el contexto; no etiquetarla automáticamente como reprogramación no disponible. |
| Aceptación específica | Mismo ID y cero actividades nuevas; fecha/hora verificables; campos ajenos conservados; sin escritura al proponer/trasladar; conflicto concurrente rechazado; reintentos idempotentes; auditoría/finalización atómicas; distinguir A05 de A06 y rechazar estados o fuentes fuera de alcance. |
| Decisión propuesta | Mantener opt-in y alcance de una actividad pendiente de oportunidad. Ampliar lead, independientes, lotes o recurrencias solo con reglas y validación específicas. |

Véase el [alcance A06](./chat-cliente-existente-alcance.md#reprogramación-de-actividad-guardada-a06)
para formatos temporales, permisos, límites de lectura y controles de guardado.

Validación técnica A06: **1.669 pruebas aprobadas y 7 live omitidas en 54
archivos**, incluidos **35 casos A06 en MySQL aislado**. Trece pruebas de navegador
aprobadas cubren A06 (traslado completo, confirmación, conflicto y respuesta
incompleta) y regresiones A04/A05/Calendario. Build web y lint dirigido aprobados.
La comprobación separada del baseline legacy conserva los mismos 15 fallos
preexistentes y 103 pruebas aprobadas, sin fallos adicionales.
Sin proveedor real de IA, escrituras CRM productivas ni cambios RDS.

##### A07 — Preparación del resultado de llamada de un lead (`action.record_outcome`)

| Campo | Definición |
| --- | --- |
| Definición | Solicitar una propuesta para registrar un resultado admitido de llamada en un lead o interacción autorizado por el módulo. |
| Necesidad | Mantener el seguimiento del lead actualizado con el resultado correcto y las validaciones de su estado. |
| Prioridad propuesta | **P1:** recorrido específico que debe probarse separado de actividades de oportunidad. |
| Ejemplo de uso | Preparar el resultado «no contestó» para la llamada de un lead identificado. |
| Cómo distinguirla | Informar el resultado no autoriza guardarlo. Una llamada realizada sobre una oportunidad usa el flujo de actividad A05, no se convierte en resultado de lead por contener la palabra llamada. |
| Preguntas de prueba | «Registra en el lead que no contestó»; «El resultado fue interesado»; «Registra la llamada realizada de Alfa». |
| Actual | **Existente dentro del alcance aprobado:** un lead de la cuenta fija, catálogo real compartido con Interacciones, selección verificada, requisitos condicionales, memoria versionada, revisión completa y confirmación transaccional en Mi Coach. Una llamada sobre oportunidad sigue siendo A05. Aceptación con proveedor real y vendedores pendiente. |
| Datos necesarios | Lead/interacción autorizada, vínculo con cuenta, estado y valores de resultado admitidos por su módulo. |
| Objetivo | Propuesta con lead correcto y resultado compatible; distinguir reporte narrado de orden de registro. |
| Aclaración y límites | Si no se distingue lead de actividad, pedir precisión; no forzar un resultado arbitrario de catálogo ni alterar otros estados implícitamente. |
| Aceptación específica | Tipo/ID y combinación correctos; persona/área/fecha/comentario según regla; cero escritura de dominio al preparar o revisar; revisión obsoleta rechazada; auditoría, evento y finalización atómicos; misma confirmación idempotente, nueva llamada explícita con otra identidad. |
| Decisión propuesta | Conservar el ejecutor controlado y el flujo legacy. Sin resultados masivos, contactos/reuniones/tareas implícitos, resolución o materialización de leads. |

El catálogo vigente no contiene una equivalencia inequívoca para «no contestó»:
el chat ofrece las combinaciones admitidas y pide seleccionar, **sin traducirlo
silenciosamente a otra razón o acción**. Una mención narrativa no autoriza registro.
Los cambios se corrigen en el chat y obligan a revisar la propuesta vigente.
Véase el [alcance A07](./chat-cliente-existente-alcance.md#resultado-de-llamada-de-lead-a07).

Validación técnica A07: **1.800 pruebas aprobadas y 7 live omitidas en 58
archivos**, incluidos **30 casos A07 en MySQL aislado** y todas las reglas del
catálogo para cada estado admitido. **16 pruebas de navegador aprobadas** cubren
revisión/confirmación A07, conflicto, respuesta incompleta y regresiones
A04/A05/A06/Calendario. Build web y lint dirigido aprobados.
El baseline legacy separado conserva exactamente los mismos **15 fallos
preexistentes y 103 pruebas aprobadas**, con nombres de fallo idénticos.
Sin proveedor real de IA, escrituras CRM productivas ni cambios RDS.

##### A08 — Solicitud de cambio de etapa o estado (`action.change_status`)

| Campo | Definición |
| --- | --- |
| Definición | Pedir una transición de etapa, estado comercial o activación que debe cumplir las reglas del módulo correspondiente. |
| Necesidad | Reflejar un avance o cambio de situación del negocio sin omitir requisitos y controles de transición. |
| Prioridad propuesta | **P0:** traslado controlado a la validación existente; ningún avance directo desde el chat. |
| Ejemplo de uso | Solicitar validar el avance de Alfa a su siguiente etapa. Marcar ganada sigue fuera del alcance A08. |
| Cómo distinguirla | Consultar la etapa o revisar requisitos no la cambia. Tampoco basta con editar un campo genérico para autorizar una transición. |
| Preguntas de prueba | «Marca Alfa como ganada»; «Pásala a negociación»; «Activa esa oportunidad». |
| Actual | **Existente dentro del alcance aprobado:** preparación determinista versionada, selección autorizada, revisión y traslado a Oportunidades, inicio explícito y seguimiento persistente del trabajo existente. Habilitación opt-in; aceptación con proveedor real y vendedores pendiente. |
| Datos necesarios | Cuenta fija, oportunidad, etapa/estado vigentes y siguiente destino; token y revisión vigentes. El validador original recupera sus respuestas/documentos guardados y verifica sus propios requisitos. |
| Objetivo | Preparar sin ejecutar y devolver el resultado real del validador, sin convertir respuestas completas en aprobación automática del chat. |
| Aclaración y límites | No modificar reglas, prompts, permisos, decisiones ni avance automático del módulo. «Solo evalúa, sin cambiar» no inicia un validador que puede avanzar; orientar a consulta de requisitos Q10. Cierres, activación, retrocesos, bypass, saltos y lotes fuera. |
| Aceptación específica | Cero trabajo IA al proponer, revisar o abrir el módulo. POST explícito con token/revisión; misma solicitud conserva el trabajo vinculado al recargar. No atribuir avance sin resultado del trabajo y comprobación de etapa persistida. Errores/rechazo/cautela no se convierten en éxito ni reintento automático. |
| Decisión propuesta | Reutilizar el validador actual sin cambiar su funcionamiento; no usar transición directa ni una aprobación alternativa. |

El panel ofrece abrir el formulario existente para revisar respuestas; evalúa
solo información guardada. Guardar ese formulario no completa la solicitud A08:
la finalización depende del resultado del trabajo vinculado. Cerrar la vista
no cancela una validación ya iniciada. Un fallo de vinculación se informa;
al reintentar se reutiliza el trabajo pendiente del servicio existente, sin
prometer una transacción única entre creación del trabajo y vínculo.

Validación técnica A08: **1.873 pruebas aprobadas y 7 live omitidas en 62
archivos**, incluidos **26 casos A08 en MySQL aislado** y cuatro casos que
ejecutan la función original de validación con IA simulada: aprobación con
avance automático, cautela, no preparada y fallo del proveedor. **27 pruebas
de navegador aprobadas**, de las cuales once son A08, con traslado completo,
recarga sin reiniciar, resultados y errores; regresiones A04/A05/A06/A07.
Build web y lint dirigido aprobados. El baseline legacy separado conserva los
mismos **15 fallos preexistentes y 103 pruebas aprobadas**. Pruebas con datos
sintéticos, sin escrituras CRM productivas, cambios RDS ni aceptación real de IA.

##### A09 — Solicitud de eliminación, cancelación o desactivación (`action.remove_record`)

| Campo | Definición |
| --- | --- |
| Definición | Pedir que se elimine, cancele o desactive un registro que ya existe en el CRM, según corresponda al tipo de registro. |
| Necesidad | Retirar o dejar sin efecto información o gestiones mediante el flujo autorizado y sin afectar otros registros por accidente. |
| Prioridad propuesta | **Límite inicial:** no ejecutar desde el chat; **P0:** evitar acciones o afirmaciones destructivas indebidas. |
| Ejemplo de uso | Pedir cancelar una actividad guardada o desactivar un contacto. |
| Cómo distinguirla | «Descarta el borrador» abandona una preparación, no elimina CRM. Eliminar, cancelar y desactivar tampoco son efectos equivalentes: dependen del módulo. |
| Preguntas de prueba | «Elimina Alfa»; «Desactiva el contacto»; «Cancela la reunión guardada»; «Descarta el borrador». |
| Actual | No disponible para eliminar, cancelar o desactivar registros desde este flujo. Descartar un borrador es un control conversacional diferente. |
| Datos necesarios | No se necesitan lecturas destructivas para reconocer el límite; una futura integración requeriría entidad, estado, dependencias y política propia. |
| Objetivo | Explicar que no se modificó CRM. Distinguir abandono de tarea de cancelación de registro persistido. |
| Aclaración y límites | «Cancela» puede referirse al borrador actual o a una actividad guardada: usar contexto, aclarar si es ambiguo. |
| Aceptación específica | Ninguna eliminación/desactivación; descarte solo afecta preparación autorizada; no afirmar que un registro guardado desapareció; confirmación textual no habilita la acción. |
| Decisión propuesta | Mantener límite explícito y validar negativas/descarte como casos críticos. |

##### A10 — Solicitud de envío de una comunicación (`action.send_communication`)

| Campo | Definición |
| --- | --- |
| Definición | Pedir que un contenido se transmita realmente a un destinatario por correo u otro canal externo. |
| Necesidad | Completar una comunicación comercial con control de destinatario, contenido y autorización, no solo preparar el texto. |
| Prioridad propuesta | **Límite inicial:** no enviar desde este chat; **P0:** reconocer la petición y no afirmar un envío inexistente. |
| Ejemplo de uso | Pedir enviar al contacto un correo ya revisado o un mensaje de seguimiento. |
| Cómo distinguirla | Redactar y enviar son tareas distintas. Si el vendedor pide enviar, entregar un borrador sin explicar que no se envió no cumple su solicitud. |
| Preguntas de prueba | «Envía ahora el correo a Elena»; «Mándale el WhatsApp»; «Sí, envíalo»; «Solo redacta, no envíes». |
| Actual | No disponible: el chat no envía comunicaciones. Pedir envío no debe reclasificarse silenciosamente como redacción. |
| Datos necesarios | Para futura integración: canal, remitente/destinatario autorizados, contenido revisado, consentimiento y controles propios de envío. |
| Objetivo | Reconocer que se pidió envío, explicar que no se ejecutó y ofrecer preparar texto como alternativa explícita, no como cumplimiento del envío. |
| Aclaración y límites | No afirmar que una integración existe ni que la comunicación se entregó; «sí» no concede permisos. |
| Aceptación específica | Cero envío, cero afirmación de entrega y cero actividad creada como sustituto; si pide solo redacción, clasificar C01/C02 y producir borrador. |
| Decisión propuesta | Mantener envío fuera del alcance inicial; diseñarlo aparte si se aprueba. |

##### A11 — Registrar nota de oportunidad (`action.record_note`)

| Campo | Definición |
| --- | --- |
| Definición | Preparar una nota comercial individual para una oportunidad ya identificada. |
| Necesidad | Guardar reportes de vendedor con atribución e incertidumbre preservadas, sin sobrescribir notas anteriores. |
| Prioridad propuesta | **P1:** escritura controlada con revisión textual y confirmación explícita. |
| Ejemplo de uso | «Guarda como nota en Hardware Refresh que el cliente quizá apruebe el presupuesto, pero no lo confirmó». |
| Cómo distinguirla | Contar un hecho no equivale a pedir guardarlo. Una nota es append-only; corregir un registro anterior implica añadir otra nota. |
| Actual | La propuesta se guarda como operación pendiente; solo la confirmación del vendedor inserta en `opportunity_notes`. |
| Datos necesarios | Cuenta fija activa, oportunidad única de esa cuenta, `oportunidades.update`, `mi_coach.execute`, canal/operación habilitados y texto revisable. |
| Objetivo | Mostrar oportunidad, texto literal, atribución y certeza antes de guardar; mostrar éxito solo después de respuesta confirmada del servidor. |
| Aclaración y límites | Destino o texto ambiguo requiere aclaración. Cancelar no escribe. El texto persistido no se edita ni borra desde el chat. B11 no escribe notas CRM. |
| Aceptación específica | Sin operación automática por un reporte; cancelación sin cambios; permiso revocado bloquea revisión/ejecución; idempotencia evita duplicados; auditoría omite el texto comercial. |
| Decisión propuesta | Persistencia transaccional e idempotente mediante la operación controlada y el almacenamiento existente de notas. |

### 4. Matriz de datos y condiciones transversales

No es necesario ejecutar el producto cartesiano completo para todas las
categorías. Sí registrar combinaciones elegidas, justificar exclusiones y cubrir
todas las condiciones críticas aplicables.

| Dimensión | Variantes a preparar | Comprobación |
| --- | --- | --- |
| Cuenta | Una seleccionada, otra nombrada, cambio de cuenta, regreso. | No mezcla datos ni recupera pendientes de la cuenta equivocada. |
| Resolución | Registro único, nombres iguales, referencia parcial, inexistente, «esa». | ID esperado o aclaración; nunca selección arbitraria. |
| Oportunidad | Abierta, inactiva, ganada, perdida, anulada. | Lectura y elegibilidad operativa respetan reglas, sin confundir estados. |
| Permisos | Completos, solo lectura, sin dominio, permiso revocado entre turnos. | Respuesta o denegación explícita; memoria no restaura acceso. |
| Configuración | Intención habilitada/deshabilitada, tipo operativo permitido/bloqueado. | Reconocimiento independiente de disponibilidad; sin degradación silenciosa. |
| Evidencia | Completa, campo vacío, cero registros, fuente fallida, fuente omitida, truncamiento. | Distinguir dato vacío, ausencia de registros, error y resultado parcial; declarar los límites. |
| Fechas | Absolutas, relativas, día sin hora, hora sin día, cambio de mes/año, zona del negocio. | Valores esperados contra reloj fijo; no inventar precisión. |
| Números | Cero, decimales, separadores, moneda ausente, unidades incompatibles. | Interpretación validada o aclaración; cálculo sin conversión inventada. |
| Relación | Contacto solo de cuenta, contacto de oportunidad, relación faltante. | No inferir vínculo ni facultad de decisión. |
| Fuentes | CRM, reporte del cliente, observación, hipótesis, documento, web. | Procedencia y certeza preservadas en cada afirmación. |
| Adjuntos | Admitido legible, vacío, extracción fallida, recortado, instrucciones incrustadas. | Limitación visible; cero instrucciones de datos ejecutadas. |
| Transporte | Polling fallido, recarga, job pendiente, respuesta tardía, resultado vacío. | Recuperación del mismo job y ausencia de duplicados. |
| Concurrencia | Dos pestañas, dato cambiado antes de confirmar, reintento de confirmación. | Control de versión/estado del flujo; no sobrescritura silenciosa ni doble ejecución. |
| Presupuesto | Lecturas agotadas, rondas agotadas, timeout en distintas etapas. | Parte no completada explícita; no éxito ficticio ni nuevas lecturas ilimitadas. |

### 5. Conversaciones compuestas prioritarias

Estas secuencias son escenarios propuestos, no pruebas que ya existan o hayan
pasado. Deben ejecutarse con fixtures controlados y la misma información inicial.

| ID | Conversación | Aceptación |
| --- | --- | --- |
| MIX-01 | «¿En qué etapa está Alfa y qué actividades tiene pendientes?». | Dos componentes de consulta; etapa y conjunto de pendientes correctos; cero operaciones. |
| MIX-02 | «Dime la etapa de Alfa y redacta un correo para pedir reunión, sin enviarlo». | Dato correcto y correo; dependencia solo si el correo requiere la respuesta; cero envío/programación. |
| MIX-03 | «El cliente sospecha fugas de información. ¿Qué le pregunto para aclararlo?». | Reporte y contenido separados; atribución conservada; no exigir que CRM pruebe la sospecha; no guardar. |
| MIX-04 | «Actualiza monto y programa una llamada». | Dos borradores editables: pedir cuál preparar primero y conservar las partes, sin ejecutar ambas. |
| MIX-05 | «Compara Alfa y Beta y dime cuál atender primero». | Comparación y priorización completas, con criterio visible; no transformar consulta plural en cambio masivo. |
| MIX-06 | Reporte sin destino → elección de oportunidad → elección de pregunta → «¿por qué esa?» → revisión. | Conservar reporte literal, atribución y pendientes; aclaraciones no sustituyen texto ni guardan por sí mismas. |
| MIX-07 | Borrador de reunión → «el viernes» → «a las cuatro» → «mejor con Elena» → revisión. | Acumular datos válidos; resolver contacto/vínculo; fecha/zona correctas; ninguna actividad guardada prematuramente. |
| MIX-08 | «Resume la cuenta, lista pendientes, redacta un correo y prepara una reunión». | Hasta cuatro componentes, dependencias pertinentes y presupuesto compartido; si una parte falla, no declarar todas completas. |
| MIX-09 | Mensaje con cinco solicitudes independientes. | Pedir dividir sin omitir la quinta ni ejecutar una selección arbitraria de cuatro. |
| MIX-10 | Preparación de llamada → «cancela» → consulta de actividad guardada. | Descarte del borrador no elimina actividad existente; consulta posterior refleja CRM real. |
| MIX-11 | Hipótesis de presupuesto → consulta de monto → «¿cuál es el presupuesto confirmado?». | No confundir monto de oportunidad, supuesto y presupuesto confirmado. |
| MIX-12 | Lista vacía por error → «entonces no hay oportunidades, ¿verdad?». | Corregir la premisa: fallo de lectura no demuestra ausencia; no aceptar conclusión falsa. |

### 6. Ficha mínima de un caso ejecutable

Cada fila funcional debe traducirse en casos con estos campos, sin depender de
que la respuesta repita literalmente una frase dorada:

| Campo | Contenido |
| --- | --- |
| Identificación | ID estable, versión del corpus, categoría principal y categorías secundarias. |
| Condiciones | Cuenta, usuario/permisos, políticas habilitadas, estado de entidades, reloj y zona horaria. |
| Entrada | Mensaje exacto, historial necesario, contexto validado inicial y material aportado. |
| Interpretación esperada | Resolución, objetos, componentes, referencias y dependencias. |
| Recuperación esperada | Entidades resueltas, filtros y hechos mínimos; herramientas admitidas y prohibidas cuando sea relevante. |
| Respuesta esperada | Elementos obligatorios, cantidades/formato solicitados, atribución, límites y siguiente paso útil. |
| Resultado operativo | Sin operación, borrador, propuesta o ejecución confirmada por el flujo; no equiparar estados. |
| Prohibiciones | Datos ajenos, hechos inventados, pérdida de partes, envío/escritura implícitos o afirmaciones falsas de ejecución. |
| Evidencia de ejecución | Revisión de código, versión efectiva de prompts/reglas, modelo/proveedor, parámetros, traza, resultado por etapa, latencia y costo si aplica. |
| Revisión | Aprobado/fallido/no evaluable con motivo y responsable; no contar como éxito un caso sin evidencia suficiente. |

Para contenido y orientación, evaluar el significado y las afirmaciones, no
igualdad textual. Para campos, IDs, filtros, cifras, estados y fechas, exigir
valores exactos según fixture y reglas.

### 7. Criterios propuestos para aprobar una versión

#### Calidad funcional y comercial

Puntuar cada dimensión aplicable por separado: **0** incorrecta/ausente,
**1** parcial o necesita corrección importante, **2** correcta y utilizable.
Usar «no aplica» justificado; no reemplazarlo por una puntuación perfecta.

| Dimensión | Para obtener 2 |
| --- | --- |
| Comprensión | Propósito, objeto y todas las partes correctos. |
| Resolución | Entidad, contexto y filtros correctos, o aclaración indispensable bien planteada. |
| Evidencia | Hechos respaldados o atribuidos; fuentes, límites y errores correctamente descritos. |
| Completitud | Responde todas las partes posibles; identifica pendientes sin ocultarlos. |
| Utilidad | Dato directo, acción recomendada concreta o contenido listo para revisar, según la petición. |
| Claridad | Formato, idioma, cantidad y extensión adecuados; estados de operación inequívocos. |

Los umbrales agregados de esta rúbrica, precisión por familia, aclaraciones
innecesarias, latencia p95 y costo máximo deben acordarse **antes** de comparar
versiones y ejecutar la nueva evaluación.

No aprobar una versión solo porque un segundo modelo considere buena su
respuesta. Combinar aserciones deterministas, revisión de evidencia y revisión
humana de utilidad comercial; documentar discrepancias del evaluador.

### 8. Orden de ejecución recomendado

1. **Revisar y aprobar alcance:** confirmar prioridades, objetos/campos
   garantizados y límites; especialmente creación, envío, estados y eliminación.
2. **Preparar datos y respuestas esperadas:** comenzar con P0, sin cambiar aún
   el comportamiento del chat.
3. **Ejecutar línea base:** distinguir pruebas deterministas, interfaz y proveedor
   real. Registrar los resultados y analizar cualquier discrepancia sin asumir
   a priori que la expectativa o la implementación es la correcta.
4. **Clasificar los fallos:** comprensión, contexto, recuperación, capacidad,
   redacción, operación, transporte o datos. No llamar «falta de función» a todo.
5. **Intervenir por causa:** ajustar interpretación, fuente o flujo solo con
   evidencia; desarrollar capacidad nueva únicamente si el alcance aprobado la
   requiere y no existe.
6. **Reevaluar sin contaminar la medición:** mantener un conjunto de evaluación
   separado de los ejemplos usados para ajustar prompts; versionar cambios y
   comparar contra la misma base de datos.
7. **Aceptación y lanzamiento:** revisar tareas completas con vendedores en el
   entorno de pruebas, registrar y resolver los problemas detectados y
   comprobar el alcance aprobado antes de autorizar el lanzamiento. Conservar
   un mecanismo de reversión y seguimiento del funcionamiento en producción.

La evaluación con proveedor real requiere autorización de gasto y datos de
prueba apropiados. Esta documentación no inicia llamadas live ni modifica
modelos, prompts, permisos o parámetros.

## Documentación y fuentes técnicas

- [Alcance funcional, permisos y capacidades](./chat-cliente-existente-alcance.md)
- [Arquitectura conversacional por bloques](./arquitectura-chat-conversacional.md)
- [Catálogo de categorías](../apps/api/src/commercial-intelligence/turn-contract.js)
- [Ejecución del contrato, capacidades y continuidad](../apps/api/src/commercial-intelligence/turn-contract-runtime.js)
- [Verificación y presupuesto de evidencia](../apps/api/src/commercial-intelligence/customer-chat-evidence.js)
