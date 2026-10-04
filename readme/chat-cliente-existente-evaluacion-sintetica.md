# Evaluación sintética: Chat de Cliente existente

Este conjunto proporciona una línea base reproducible para mejorar el chat. Todos los nombres, IDs, importes, contactos e interacciones del fixture son ficticios; no se cargan datos de producción ni se llama a un proveedor de IA.

## Ejecución

Desde la raíz del repositorio:

```sh
npm --prefix apps/api run test:customer-chat:evaluation
```

La evaluación ejecuta planes estructurados deterministas y el read model con snapshots controlados. Comprueba intención, herramientas habilitadas y ejecutadas, IDs de evidencia, aislamiento de cuenta, propuesta de operación confirmable, contenido comercial de cotización y rangos temporales respecto de un reloj fijo. No invoca ni compara el clasificador anterior.

## Corpus

El corpus está versionado en `apps/api/test/fixtures/customer-account-chat-evaluation-v1.js`; el runner está en `apps/api/test/customer-account-chat-evaluation.test.js`.

La versión `1.1.1` cubre:

- Resumen de cuenta, lista de oportunidades, estado de oportunidad, contactos e historial, actividades por periodo y contenido de cotización.
- Propuesta de cambio de importe sin escritura directa.
- Registros de una segunda cuenta como controles negativos y filtrado de herramientas no disponibles.
- Fechas relativas de seis meses, doce meses y dos años calculadas con fecha fija.
- Escenarios objetivo para preguntas compuestas, referencias de seguimiento, entidades ambiguas, otra cuenta, resultados vacíos o truncados, soporte fuera de alcance, investigación pública y paráfrasis.
- Cobertura de respuesta para resultado vacío, aviso visible de truncamiento, dominio de soporte fuera de alcance y opt-in de investigación pública. Los dos últimos también se validan en la integración API.
- Planes estructurados sintéticos para preguntas compuestas, seguimientos, referencias ambiguas, otra cuenta y paráfrasis, ejecutados por el normalizador y read model de producción.

Las etiquetas `covered`, `planner_implemented` y `response_tested` clasifican la cobertura del corpus. Las notas y valores `baseline` que aún aparecen en algunos casos son referencias históricas; las aserciones de enrutamiento activas usan planes estructurados. Los casos `response_tested` cuentan con cobertura de respuesta en el adaptador o integración API, incluida la divulgación de truncamiento, el rechazo de dominios fuera de alcance y el valor opt-in de investigación pública. No hay casos `known_gap` pendientes en esta versión del corpus; una brecha futura debe conservar ese estado hasta que tenga una aserción ejecutable.

## Alcance de la evaluación

El runner no evalúa la calidad de redacción de una respuesta real de IA ni sustituye pruebas de integración con permisos y base de datos. Mide el enrutamiento estructurado y la evidencia que los componentes deterministas entregan al modelo. Los campos `baseline` del corpus conservan observaciones históricas; no se ejecutan como ruta ni como comparación. Las pruebas existentes del adaptador siguen siendo necesarias para casos adicionales de contrato y permisos.

El plan seleccionado puede autorizar varias herramientas para cubrir una consulta compuesta. `buildCustomerReadModel` ejecuta las herramientas permitidas por el plan y por el servidor; esa intersección es la que valida el corpus.

Los planes estructurados de la evaluación se suministran como fixtures para que el test no dependa de una llamada externa al modelo. Prueban el contrato, la intersección de herramientas, los filtros, las consultas y las aclaraciones; no miden la calidad estadística del proveedor al generar el plan.

## Planificación de consultas

Cliente existente solicita un plan JSON estructurado antes de preparar su read model. El plan especifica el objetivo, uno o varios códigos de consulta, referencias textuales, filtros, modalidad y ambigüedad. La lista de códigos proviene solo de los intents habilitados por gobierno.

El motor valida el plan contra el catálogo estático y la configuración de canal. Une las herramientas de las consultas seleccionadas y las intersecta con las herramientas que ya superaron permisos y políticas de dominio en el servidor. El plan no puede enviar nombres de herramientas ni IDs ejecutables, ampliar la cuenta seleccionada, habilitar dominios fuera del contrato ni ejecutar operaciones. Las referencias propuestas por el modelo se aceptan solo si aparecen literalmente en la pregunta o el historial; los candidatos enviados al planificador son etiquetas de registros de la cuenta autorizada, sin IDs, correos ni importes. La llamada del planificador se registra en el presupuesto y uso de IA bajo la función `commercial_intelligence.account_chat`.

El planificador estructurado es la única ruta de interpretación de Cliente existente y se ejecuta para todos los turnos. Si el planificador no está disponible, falla o devuelve un plan inválido, el turno se cierra con una aclaración segura y cero lecturas CRM; nunca se deriva a un clasificador anterior. `diagnostics.planner` registra disponibilidad del plan, motivo categorizado, intents y herramientas seleccionadas. Una baja confianza, otra cuenta, un dominio fuera de alcance, contexto insuficiente o ambigüedad produce aclaración sin ejecutar herramientas.

Los casos sintéticos CAC-GAP-001, CAC-GAP-002, CAC-GAP-003, CAC-GAP-004 y CAC-GAP-009 ejercitan el flujo estructurado con planes controlados y aserciones activas sobre el comportamiento esperado. CAC-GAP-005 cubre la redacción para resultado vacío, y CAC-GAP-006/007/008 tienen cobertura de integración o respuesta determinista correspondiente.

## Trazabilidad de turnos

Cada turno de Cliente existente se registra en `coach_turn_quality_traces`, reutilizando el almacén de calidad del motor conversacional. El resultado del job incluye `qualityTraceId`; el detalle se obtiene por los endpoints de trazas existentes, que limitan la lectura al usuario, canal y sesión autorizados.

La traza conserva intención y ruta seleccionada, IDs de entidades resueltas, validación, cantidad de evidencia, latencia, operaciones propuestas, nombres de herramientas y estado/cantidad resumida por herramienta. Los diagnósticos también registran uso de fallback, etapa de fallo y estado/conteo de evidencia de los agentes.

Las métricas por herramienta guardan únicamente `toolName`, `resultCount`, `errorCode` categorizado y `truncated`. No guardan argumentos, registros devueltos ni textos de error. Para las consultas SQL acotadas del snapshot, el servicio solicita una fila centinela más que el límite, la elimina antes de normalizar el snapshot y registra `resultLimit` y truncamiento exacto (`true`/`false`) en `diagnostics.snapshotMetrics`. Si una fuente no expone metadatos de límite, su estado de truncamiento queda como `null`; no se infiere solo porque un conteo coincida con un tope.

La lista preexistente `toolsUsed` mantiene su formato de nombres de herramienta para compatibilidad. Las trazas no incorporan la pregunta literal. Los IDs de entidades se conservan para poder diagnosticar resolución y alcance; el acceso continúa filtrado por usuario y sesión.

## Operación del planificador

Cliente existente usa el planificador estructurado en todos los turnos; no hay modos de despliegue, cohortes ni interruptor de activación. Los errores de interpretación siguen cerrando en seguro, sin fallback al clasificador anterior. Gobierno de Mi Coach conserva las métricas agregadas de calidad: disponibilidad del plan, filtros y referencias estructuradas, herramientas observadas y con evidencia, aclaraciones, errores y truncamientos de recuperación, latencia, costo IA y correcciones de feedback. Los porcentajes sin muestra no se interpretan como éxito. Se guardan códigos y conteos resumidos; no se registra el texto literal de la pregunta en la traza.

## Mantenimiento

- Mantener IDs de caso estables para poder comparar resultados entre versiones.
- Añadir una paráfrasis como caso separado; no reemplazar la frase original.
- Mantener campos `baseline` y `target` separados. `baseline` es referencia histórica y no participa en la ejecución; `target` describe el contrato de [alcance funcional](./chat-cliente-existente-alcance.md).
- Si reaparece una limitación, conservar el estado `known_gap` y describir qué aserción del target falta. No mantener ese estado como etiqueta histórica cuando una prueba activa ya cubre el comportamiento.
- Si cambia deliberadamente la forma o semántica de los fixtures, incrementar `CUSTOMER_ACCOUNT_CHAT_EVALUATION_VERSION` y anotar el motivo en el cambio.
- Incorporar preguntas reales únicamente tras revisión y eliminación de datos personales o comerciales innecesarios. El conjunto inicial es sintético y no representativo.

## Verificación iterativa de evidencia

Cada turno obtiene una primera tanda de lecturas autorizadas, evalúa si la evidencia cubre todas las partes de la pregunta y, cuando falta otra fuente legible, ejecuta consultas adicionales y vuelve a verificar antes de redactar. Las lecturas adicionales se intersectan otra vez con el catálogo y permisos del servidor y no repiten herramientas ya ejecutadas.

Límites por turno: máximo 2 rondas adicionales, 8 lecturas de herramienta en total (la tanda inicial y las adicionales), y 18 segundos desde que empieza la interpretación. El planner, el verificador y la síntesis reciben un `AbortSignal` con el tiempo restante; la espera de las consultas adicionales también vence en el deadline. Las fuentes omitidas cuando se alcanza el límite quedan registradas como no consultadas y evitan declarar la respuesta completa.

Los estados de cierre son `sufficient`, `no_results`, `clarification`, `insufficient_evidence`, `query_error`, `query_limit_reached`, `timeout`, `verification_unavailable` y `verification_error`. El sistema no acepta `sufficient` si no hay al menos un resultado no vacío, si el verificador aún marca hechos faltantes o si una consulta necesaria falló/quedó sin ejecutar. Tampoco acepta `no_results` sin al menos una lectura autorizada completada; los errores del snapshot se conservan separados de las lecturas exitosas y nunca se interpretan como ausencia.

Las respuestas CRM factuales solo se redactan después del estado `sufficient`. Si falta evidencia, se indica la fuente/hecho no verificado o se pide aclaración; si una consulta falla o vence el tiempo, se explica que no pudo comprobarse. `no_results` se reserva para consultas autorizadas completadas que sí devolvieron cero coincidencias. Las respuestas finales mantienen separados hechos, inferencias y elementos pendientes, y toda operación continúa como propuesta confirmable.
