# Arquitectura por bloques exclusiva de Coach

## Alcance y aislamiento

Coach utiliza el motor conversacional existente mediante dependencias inyectadas. La planificación, verificación y auditoría adicionales viven en `apps/api/src/coach/block-pipeline.js`; tiempos, límites y trazas viven en `block-runtime.js`. Solo `coach-adapter.js` y `agent-gateway.js` conectan estos módulos.

Cliente existente y Cuenta nueva no reciben la clasificación de políticas de Coach ni cambian sus políticas, servicios, interfaz, historiales o sesiones. El motor compartido acepta el contexto opcional de intención solo desde el adaptador Coach; los otros canales no lo envían. Los contratos de operaciones y sus destinos mantienen sus validaciones actuales.

## Activación

`COACH_BLOCK_PIPELINE_ENABLED` se consulta exclusivamente en el adaptador y gateway de Coach. El valor predeterminado es `true`. Para regresar explícitamente al recorrido anterior, iniciar la API con `COACH_BLOCK_PIPELINE_ENABLED=false`; no hace falta modificar ningún archivo de los otros canales. Las dependencias de pruebas pueden establecer `coachBlockPipelineEnabled` como booleano.

No existe fallback silencioso ante fallos de planificación, verificación o auditoría. Un bloque fallido produce error o aclaración sin operaciones ejecutables. Desactivar el pipeline es una decisión operativa explícita, no una respuesta automática a un error del modelo.

## Recorrido

| Bloque | Implementación Coach                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1     | Interfaz existente y consulta asíncrona del job, sin cambios de frontend.                                                                                                                                     |
| B2     | Rutas HTTP existentes, autenticación y entrega del resultado.                                                                                                                                                 |
| B3     | Gateway Coach clasifica objetivo y tema CRM, carga el override de `seller_coaching`, `brief_context` u `operation`, o usa `default`; mantiene sesión, job y persistencia. La clasificación se limita a Coach. |
| B4     | Adaptador Coach; inyecta los hooks exclusivos y conserva el canal `coach`.                                                                                                                                    |
| B5     | Motor conversacional compartido; recibe el modo clasificado por B3 únicamente desde Coach y conserva los comportamientos propios de los demás canales.                                                        |
| B6     | IA propone intención, modo y lecturas; se validan catálogo, confianza, filtros y herramientas. No se aceptan IDs CRM del modelo en los filtros.                                                               |
| B7     | Resolución de contexto autorizada existente; las lecturas se derivan del plan, no de palabras clave.                                                                                                          |
| B8     | Herramientas CRM existentes con alcance, permisos y reglas del servidor. Los IDs provienen del contexto validado.                                                                                             |
| B9     | Evaluación estructurada de suficiencia, lecturas adicionales acotadas y dictamen seguro.                                                                                                                      |
| B10    | Síntesis conservando instrucciones, políticas y reglas de Coach, seguida de auditoría de la respuesta normalizada.                                                                                            |
| B11    | Persistencia existente de operaciones, historial, contexto, resultado y observabilidad del job Coach.                                                                                                         |

Los bloques se ejecutan según la necesidad del turno. Una consulta conceptual puede usar guía autorizada sin B8; una aclaración o derivación no necesita síntesis factual. Una respuesta determinista también se verifica y audita antes de entregarse.

## Políticas e invariantes

- El catálogo de intenciones de Coach y las reglas administrativas y de negocio siguen siendo la autoridad del canal.
- Las herramientas del plan se intersectan con las herramientas de la intención y las autorizadas por el motor. El verificador no puede añadir herramientas fuera de ese alcance.
- B7 resuelve entidades con el contexto CRM autorizado; filtros estructurados no permiten IDs inventados.
- Las consultas factuales necesitan evidencia CRM. Guías y reglas autorizadas sustentan orientación comercial, pero no prueban datos de un cliente.
- Campos futuros pendientes de una propuesta no se convierten en hechos CRM faltantes. La verificación no concede permisos de escritura.
- `no_results` exige una lectura exitosa y vacía; errores, truncamientos y fuentes omitidas no demuestran ausencia.
- `sufficient` con campos o fuentes pendientes no se acepta. `supported` con afirmaciones no respaldadas tampoco se acepta.
- Una auditoría negativa o no disponible retira operaciones y entrega una respuesta segura.
- Exploración profunda mantiene la derivación vigente a su espacio especializado; Coach no lee su historial completo.

## Límites y trazas

El turno dispone de 45 segundos para llamadas de los bloques, hasta 8 lecturas y hasta 2 rondas de lectura adicional. Cada llamada al proveedor sigue utilizando el registro de uso IA de Coach. Los límites pertenecen exclusivamente a este pipeline.

`result.coachArchitecture` contiene versión `coach_blocks_v1`, canal, planificación, dictamen de evidencia, auditoría y `executionTrace`. La observabilidad del job conserva también los eventos B2–B11, con secuencia, llamada/retorno, tiempos y conteos saneados. Las trazas no incluyen filas CRM, prompts, credenciales ni historial completo. No se modifica el renderer del chat para mostrar estas trazas.

## Respuestas completas, reparación y reintentos

- **Lista anunciada y no entregada:** si el texto termina en dos puntos y la respuesta trae hechos verificados, el servidor los añade como lista antes de auditar. La auditoría revisa el texto que lee el vendedor.
- **Reparación:** cuando la auditoría rechaza una respuesta, Coach hace **una** reescritura que conserva solo lo respaldado por la evidencia y la audita de nuevo. Si la nueva auditoría la acepta, se entrega y el turno registra `coach_answer_repaired`; si no, se entrega el mensaje de fallo. No se reescriben turnos de operación ni preguntas fuera de alcance, y solo se intenta si quedan al menos 10 segundos del turno. `diagnostics.repair` conserva el resultado.
- **Reintentos:** una llamada al proveedor que falla por un error transitorio (HTTP 5xx o 429 que no sea de cuota, red, respuesta que no es JSON válido) se repite una vez si queda tiempo. También se repite una vez la verificación o auditoría cuya respuesta no cumple su esquema. Los rechazos por cuota y el vencimiento del turno no se reintentan. Los reintentos se anotan en la traza y en `diagnostics.retries`.
- **Mensajes de fallo:** cada fallo dice qué ocurrió y qué intentar a continuación (`failure-messages.js`). Una pregunta sin respaldo del CRM sigue respondiéndose como fuera de alcance, no como error.

## Validación

- `coach-block-pipeline.test.js`: planificación, herramientas inventadas, alcance, lectura adicional, errores, ceros, guía, auditoría y límites.
- `coach-block-adapter.test.js`: integración con el motor real, políticas del modo, auditoría negativa y desactivación explícita.
- `coach-block-gateway.test.js`: persistencia de sesión y trazas B2–B11, sin propuestas rechazadas.
- `npm run test:coach --prefix apps/api`: regresiones de Coach.
- Comprobación SHA-256 de archivos protegidos antes y después de implementar: los demás canales y el motor compartido deben permanecer idénticos.
- Turno con proveedor real mediante la ruta HTTP de Coach: planificación, guía, evidencia suficiente, síntesis, auditoría y persistencia sin operaciones CRM.
