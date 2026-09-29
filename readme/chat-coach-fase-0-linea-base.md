# Mi Coach - Fase 0: linea base y matriz de evaluacion

Este documento implementa la Fase 0 del plan de arquitectura de Chat Coach. Su objetivo es fijar el alcance funcional, registrar preguntas representativas del vendedor y definir resultados esperados antes de migrar el orquestador o agregar nuevas herramientas.

## 1. Fecha y alcance

- Fecha de la linea base: 2026-09-29.
- Modulo: Mi Coach, tab Coach.
- Alcance: cuentas, contactos, leads, oportunidades, pipeline, proceso comercial, actividades, operaciones guiadas, handoffs y continuidad de sesion.
- Fuera de alcance: Analisis de situacion comercial como modulo independiente, Cliente existente, Cuenta nueva, investigacion publica, biblioteca, reportes y administracion de gobierno, salvo dependencias directas del chat.

## 2. Objetivos medibles

La nueva arquitectura debe poder demostrar que:

- Identifica correctamente la entidad principal solicitada.
- No confunde leads, cuentas, contactos y oportunidades.
- Busca oportunidades por cuenta, etapa, estado y nombre cuando corresponda.
- Respeta permisos, ownership y estados de activacion.
- Separa pipeline abierto, historial terminal y oportunidades no activas.
- Pide aclaracion cuando hay varias coincidencias.
- Deduplica candidatos por tipo e ID.
- Mantiene contexto compatible entre turnos.
- Nunca ejecuta una escritura sin confirmacion.
- Conserva o cierra correctamente sesiones y operaciones pendientes.
- Devuelve respuestas estructuradas que el frontend pueda renderizar sin reinterpretarlas.

## 3. Taxonomia de escenarios

| Codigo | Categoria | Intencion principal |
| --- | --- | --- |
| ENT | Entidades y busqueda | Identificar cuenta, contacto, lead u oportunidad |
| PIPE | Pipeline y etapas | Consultar estado, etapa, riesgo y preparacion |
| CTX | Contexto y continuidad | Mantener o cambiar entidad activa |
| ACT | Acciones | Preparar y confirmar operaciones |
| SEC | Seguridad y alcance | Aplicar permisos, ownership y estados |
| RES | Resiliencia | Duplicados, respuestas tardias y sesiones |

## 4. Matriz de preguntas del vendedor

Estado inicial de los escenarios funcionales: **pendiente de ejecutar contra datos de negocio controlados**. La columna de cobertura indica la prueba existente que debe reutilizarse o ampliarse.

| ID | Pregunta o solicitud representativa | Tipo esperado | Resultado esperado | Invariante | Cobertura actual |
| --- | --- | --- | --- | --- | --- |
| ENT-01 | "Como esta la cuenta Totalplay?" | Consulta de cuenta | Situacion de cuenta con datos autorizados y pendientes relevantes | No seleccionar una oportunidad automaticamente | Parcial: contexto |
| ENT-02 | "Que contactos importantes tiene esta cuenta?" | Consulta de contactos | Contactos relacionados, roles y datos visibles | Solo contactos de la cuenta autorizada | Parcial: E2E contextual |
| ENT-03 | "Que leads tiene esta cuenta?" | Consulta de leads | Leads accesibles de la cuenta | No devolver oportunidades como leads | Parcial: resolver entidades |
| ENT-04 | "Cual es el importe de esta oportunidad?" | Consulta de oportunidad | Importe exacto de la oportunidad activa | La oportunidad seleccionada prevalece sobre agregados | Automatizada: operations |
| ENT-05 | "Que oportunidades abiertas tiene Totalplay?" | Consulta de oportunidades | Oportunidades activadas y abiertas de la cuenta | Excluir desactivadas e historicas del pipeline | E2E: agrupacion |
| ENT-06 | "Cual es la oportunidad de Totalplay que esta en waiting?" | Busqueda por cuenta y etapa | Oportunidades de Totalplay filtradas por etapa `waiting` | No ofrecer leads como candidatos | Caso critico por reproducir |
| ENT-07 | "Busca la oportunidad Proyecto A" cuando hay varias | Aclaracion de oportunidad | Lista diferenciada por ID, cuenta, monto o fecha | No seleccionar arbitrariamente | Parcial: contexto ambiguo |
| ENT-08 | "Totalplay" cuando coincide con cuenta, oportunidad y lead | Aclaracion de entidad | Preguntar que tipo de registro busca | La intencion explicita define el dominio | Caso critico por reproducir |
| PIPE-01 | "Que me falta para pasar esta oportunidad a Desarrollo?" | Preparacion de etapa | Etapa actual, avances, pendientes, riesgos y siguiente paso | No afirmar avance solo por una actividad | Automatizada: stage readiness |
| PIPE-02 | "Esta lista para cotizar?" | Preparacion de etapa | Recomendacion de avanzar, cautela o permanecer | Explicar evidencia y criterio de decision | Automatizada: stage readiness |
| PIPE-03 | "Que oportunidades estan en riesgo?" | Diagnostico de pipeline | Oportunidades abiertas activas con riesgos | No incluir terminales ni desactivadas | Parcial: analysis |
| PIPE-04 | "Que actividad debo hacer antes de la demostracion?" | Preparacion de interaccion | Objetivo, preguntas, responsable y criterio de exito | La recomendacion debe ser accionable | Parcial: operations |
| PIPE-05 | "La oportunidad esta ganada, pero desactivada" | Consulta de estado | Explicar por separado activacion y estado comercial | No mezclar historial con pipeline | Automatizada: lifecycle |
| PIPE-06 | "No hay oportunidades abiertas, que existe en la cuenta?" | Consulta con categorias | Separar abiertas, terminales y no activas | No afirmar que no existe ningun registro | Automatizada: status matrix |
| CTX-01 | Seleccionar cuenta, preguntar por una oportunidad y luego decir "esa oportunidad" | Seguimiento contextual | Resolver por ID activo | Mantener contexto compatible | Automatizada: context |
| CTX-02 | Preguntar por una oportunidad distinta con nombre inequivo | Cambio contextual | Adoptar la nueva oportunidad y conservar mensajes | Validar ID y cuenta relacionada | Automatizada: context |
| CTX-03 | Mencionar entidades de cuentas incompatibles | Conflicto relacional | Solicitar aclaracion | No cambiar contexto en silencio | Automatizada: context |
| CTX-04 | Cambiar de cuenta con conversacion activa | Reinicio contextual | Confirmar, cerrar sesion anterior y limpiar borradores | Cancelar conserva contexto actual | E2E: governance |
| CTX-05 | Volver al chat despues de cerrar el formulario de un modulo | Recuperacion | Recuperar sesion, handoff y campos pendientes | No perder intencion original | E2E: handoff |
| ACT-01 | "Registra una llamada para esta oportunidad" | Crear actividad | Propuesta editable con fecha, objetivo y criterio de exito | No guardar automaticamente | Automatizada: operations |
| ACT-02 | "Crea una oportunidad para esta cuenta por 45,000 USD" | Creacion guiada | Handoff al modulo de oportunidades con campos permitidos | El modulo ejecuta validaciones y guardado | E2E: creation journeys |
| ACT-03 | "Actualiza el importe a 50,000" | Actualizacion guiada | Mostrar valor actual y nuevo valor antes de confirmar | Validar permiso y version | Automatizada: operations |
| ACT-04 | "Registra esta respuesta de etapa" | Respuesta de etapa | Proponer reemplazo o agregado a pregunta existente | Solo asociar a pregunta valida | Automatizada: stage answer |
| SEC-01 | Consultar una oportunidad fuera del ownership | Control de alcance | No revelar datos y explicar alcance | No inferir que no existe globalmente | Automatizada: inaccessible entities |
| SEC-02 | Actualizar una cuenta sin permiso | Control de escritura | Rechazar propuesta o ejecucion | Consultas y comandos validan permisos por separado | Automatizada: operation policy |
| SEC-03 | Consultar una oportunidad desactivada sin pedirla | Estado de activacion | Excluirla del pipeline normal | Mostrarla solo en categoria apropiada si corresponde | E2E: inactive pipeline |
| RES-01 | Cinco registros con el mismo nombre visible | Deduplicacion | Una opcion por `entityType` e ID con datos diferenciadores | No mostrar botones identicos | Caso critico por reproducir |
| RES-02 | Respuesta tardia despues de cambiar cuenta | Condicion de carrera | Ignorar respuesta vieja | No contaminar el contexto nuevo | Debe agregarse a E2E |
| RES-03 | Limpiar conversacion con operaciones pendientes | Cierre de sesion | Confirmar descarte, cancelar operaciones y cerrar sesion | No reaparecer al recargar | E2E: cleanup |

## 5. Reglas de resultado esperado

Cada caso debe evaluarse con datos estructurados, no solo con similitud textual. Como minimo se deben registrar:

- Intencion detectada.
- Tipo de entidad principal.
- IDs de candidatos o entidad resuelta.
- Herramientas utilizadas.
- Filtros aplicados.
- Estado de permisos y ownership.
- Estado de activacion y estado comercial.
- Tipo de respuesta: informativa, aclaracion, recomendacion, propuesta o error.
- Si hubo escritura, confirmacion y resultado auditado.

Un caso falla aunque la redaccion sea correcta si ocurre cualquiera de estos eventos:

- Se devuelve una entidad de tipo incorrecto.
- Se incluye un registro fuera del alcance.
- Se mezcla una oportunidad desactivada con el pipeline activo.
- Se presenta un candidato duplicado.
- Se ejecuta una accion sin confirmacion.
- Se pierde o contamina el contexto de la sesion.

## 6. Cobertura automatizada existente

La linea base parte de estas suites existentes:

### API

```bash
npm exec --prefix apps/api vitest run test/mi-agent-coach-analysis.test.js
npm exec --prefix apps/api vitest run test/mi-agent-coach-context.test.js
npm exec --prefix apps/api vitest run test/mi-agent-coach-operations.test.js
npm exec --prefix apps/api vitest run test/coach-entity-resolver.test.js
npm exec --prefix apps/api vitest run test/coach-stage-readiness.test.js
npm exec --prefix apps/api vitest run test/coach-operation-policy.test.js
```

### Frontend E2E

```bash
cd apps/web
./node_modules/.bin/playwright test e2e/mi-agent-governance.spec.js
```

La suite E2E debe ampliar o conservar escenarios para:

- Cambio de contexto.
- Handoff y regreso al Coach.
- Oportunidades no activas.
- Gobierno del Coach.
- Limpieza de conversacion.
- Respuestas de contexto autorizado.

## 7. Ejecucion automatizada de la linea base

Ejecucion realizada el 2026-09-29 sobre el commit `6c330f9`.

### API

Comando ejecutado:

```bash
cd apps/api && npm exec vitest run --maxWorkers=1 test/coach-*.test.js test/mi-agent-coach-*.test.js
```

Resultado:

- 12 archivos pasan.
- 130 pruebas pasan.
- 0 pruebas fallan.

El fallo inicial de persistencia estaba en el mock de prueba: no devolvía una sesión activa cuando el servicio la verificaba antes de insertar operaciones. Se corrigió el fixture en `test/coach-operation-persistence.test.js`; no fue necesario cambiar la lógica productiva.

Estado de la suite API: **pass**.

### Frontend E2E

Comando ejecutado:

```bash
cd apps/web && ./node_modules/.bin/playwright test e2e/mi-agent-governance.spec.js
```

Resultado:

- 22 pruebas pasan.
- 0 pruebas fallan.

Estado de la suite E2E de gobierno: **pass**.

### Cobertura pendiente

La ejecución automatizada no sustituye la matriz de preguntas del vendedor. Todavía falta ejecutar con datos controlados los escenarios `ENT-06`, `ENT-08`, `RES-01`, `RES-02`, `SEC-03` y `RES-03`, además de revisar los escenarios de consulta de cuentas, oportunidades, leads y preparación de etapa con respuestas observadas del Coach.

Resultado automatizado acumulado: **152 de 152 pruebas pasan** entre API y frontend E2E.

## 8. Linea base inicial

La linea base no debe registrar como resuelto un caso solo porque existe una prueba relacionada. Cada escenario de la matriz debe ejecutarse con un dataset controlado y guardar:

- Fecha y commit probado.
- Usuario y permisos utilizados.
- Datos sembrados.
- Pregunta exacta.
- Respuesta estructurada.
- Resultado esperado y resultado observado.
- Estado `pass`, `fail` o `blocked`.
- Evidencia del fallo y referencia de prueba.

Los primeros casos que deben ejecutarse antes de migrar el agente son `ENT-06`, `ENT-08`, `RES-01`, `RES-02`, `SEC-03` y `RES-03`, porque representan las fallas que más fácilmente producen respuestas plausibles pero incorrectas.

## 9. Criterio de salida de la Fase 0

La Fase 0 se considera completa cuando:

- La matriz está revisada por producto y ventas.
- Cada caso tiene datos de entrada y resultado esperado.
- Existe un dataset controlado para cuentas, oportunidades, leads y contactos.
- Se identificaron los casos ya automatizados y los faltantes.
- Se ejecutó la línea base y cada caso tiene estado `pass`, `fail` o `blocked`.
- Los fallos conocidos tienen evidencia reproducible.
- Se aprobó el alcance de la Fase 1: contratos y catálogo CRM.

La Fase 0 no cambia el comportamiento del Coach. Su resultado es una referencia verificable para medir la arquitectura nueva contra el comportamiento actual.
