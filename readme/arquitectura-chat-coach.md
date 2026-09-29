# Arquitectura del Chat Coach

Este documento define la arquitectura objetivo para que Mi Coach funcione como un asesor comercial confiable para el vendedor. Describe la diferencia frente a la implementación actual, las responsabilidades de cada capa, los límites del agente y una ruta de evolución incremental.

## 1. Objetivo

Mi Coach debe ayudar al vendedor a:

- Entender la situación de una cuenta, contacto, lead u oportunidad.
- Avanzar una oportunidad con disciplina a través de las etapas del proceso comercial.
- Identificar riesgos, bloqueos, necesidades, información faltante y próximos pasos.
- Consultar información de cuentas, contactos, leads y oportunidades.
- Preparar reuniones, llamadas, demostraciones, negociaciones y seguimientos.
- Iniciar la creación de cuentas, contactos, oportunidades, leads, mapeos de contactos, cotizaciones, propuestas y actividades.
- Proponer actualizaciones de campos de los registros permitidos.
- Proponer respuestas para preguntas de etapa cuando una afirmación del vendedor coincide claramente con una pregunta existente.
- Mantener el contexto de la conversación sin mezclar cuentas, oportunidades o usuarios.
- Pedir una aclaración útil cuando existan varias coincidencias.

El objetivo no es construir un chat que tenga acceso indiscriminado al CRM. El objetivo es construir un agente comercial que razone sobre resultados confiables obtenidos mediante herramientas controladas.

### 1.1 Alcance funcional

La arquitectura debe soportar el alcance funcional definido para Mi Coach:

- Consultar cuentas, contactos, leads, oportunidades, actividades y pipeline.
- Entender la situación de una entidad y detectar riesgos, bloqueos e información faltante.
- Preparar llamadas, reuniones, demostraciones, negociaciones y seguimientos.
- Evaluar si una oportunidad está lista para avanzar en el proceso comercial.
- Proponer la creación o actualización de registros sin guardar cambios automáticamente.
- Transferir al vendedor a los módulos oficiales para completar formularios, validaciones y aprobaciones.
- Recuperar contexto y operaciones pendientes cuando el vendedor regrese a la conversación.

Mi Coach orienta y prepara; no sustituye el criterio del vendedor ni la responsabilidad de los módulos CRM.

### 1.2 Proceso comercial como marco de asesoría

Las recomendaciones deben relacionarse con la etapa actual, sus preguntas, resultados esperados y evidencia disponible. El proceso comercial contempla:

1. Contacto Inicial.
2. Identificación de Oportunidad.
3. Desarrollo.
4. Cotización.
5. Demostración.
6. Negociación.
7. Waiting.

Una evaluación de preparación de etapa debe distinguir:

- Avances confirmados.
- Preguntas o datos pendientes.
- Riesgos y bloqueos.
- Contactos o roles todavía no identificados.
- Siguiente paso, responsable, fecha objetivo y criterio de éxito.
- Recomendación de avanzar, avanzar con cautela o permanecer en la etapa.

La existencia de una actividad, cotización o solicitud del vendedor no demuestra por sí sola que la oportunidad esté lista para avanzar.

## 2. Principios de diseño

### 2.1 El CRM es la fuente de verdad

El modelo de IA no consulta MySQL directamente, no decide permisos y no determina por sí mismo si un registro está activo, desactivado, ganado, perdido o en una etapa específica.

La aplicación debe ser responsable de:

- Autenticación y autorización.
- Ownership y alcance comercial.
- Estados y etapas del proceso.
- Relaciones entre cuentas, oportunidades, contactos y leads.
- Escrituras, transacciones e idempotencia.
- Auditoría.

### 2.2 El modelo razona; las herramientas verifican

El modelo debe interpretar el lenguaje del vendedor y elegir la herramienta correcta. Las herramientas deben consultar datos reales y devolver resultados estructurados.

No se debe enviar un snapshot indiscriminado esperando que el modelo descubra todas las relaciones comerciales por texto libre.

### 2.3 La interfaz no debe reinterpretar al agente

El backend debe devolver respuestas estructuradas. React debe renderizar esas respuestas, no reconstruir una aclaración distinta ni volver a clasificar candidatos como cuentas, oportunidades o leads.

### 2.4 Consultar y modificar son flujos diferentes

Las consultas pueden resolverse directamente con datos autorizados. Las modificaciones siempre requieren:

1. Propuesta estructurada.
2. Confirmación explícita del vendedor.
3. Validación de permisos y versión.
4. Ejecución idempotente.
5. Auditoría.

### 2.5 Los errores deben ser visibles y recuperables

Cuando el agente no pueda resolver una entidad, debe explicar qué falta y mostrar opciones diferenciadas. No debe seleccionar una entidad parecida por su cuenta ni cambiar silenciosamente de oportunidad a lead.

### 2.6 El vendedor conserva el control

Toda creación o actualización debe seguir el flujo `pregunta -> propuesta -> revisión editable -> confirmación -> resultado`. El vendedor puede corregir o cancelar la propuesta antes de que el servicio de comandos la ejecute.

## 3. Arquitectura actual

La implementación actual ya contiene piezas útiles, pero varias responsabilidades están concentradas en pocos módulos:

- `apps/web/src/MiAgentPage.jsx` administra interfaz, estado del chat, contexto, restauración de sesiones, aclaraciones y operaciones.
- `apps/api/src/routes.mi-agent.js` concentra construcción de contexto, consultas del CRM, ejecución de jobs, interacción con IA, normalización de respuestas y rutas de operaciones.
- `apps/api/src/coach/entity-resolver.js` intenta resolver cuentas, oportunidades, contactos y leads a partir del texto.
- `apps/api/src/coach/service.js` persiste sesiones y operaciones pendientes.
- `apps/api/test` y `apps/web/e2e` cubren varios flujos, pero la cobertura de preguntas reales todavía debe ampliarse.

### 3.1 Limitaciones actuales

- La resolución de entidades depende demasiado de coincidencias textuales.
- Las oportunidades se buscan principalmente por su nombre, aunque el vendedor suele referirse a la cuenta asociada.
- Leads y oportunidades pueden competir como candidatos aunque la pregunta mencione explícitamente una oportunidad.
- Un snapshot grande mezcla datos de varios dominios y estados.
- La consulta, el razonamiento, la normalización y la ejecución están acoplados en la misma ruta.
- El frontend puede generar aclaraciones propias a partir del estado local.
- La sesión persiste en backend, pero el navegador también conserva el identificador y participa en la restauración.
- Las operaciones pendientes complican acciones simples como limpiar una conversación.
- Los casos de ambigüedad, duplicados, ownership y estados inactivos requieren pruebas específicas para no regresar.

## 4. Arquitectura objetivo

![Diagrama de la arquitectura objetivo del Chat Coach](./arquitectura-chat-coach.png)

```mermaid
flowchart TB
    SELLER[Vendedor]
    UI[Chat integrado en React]

    subgraph APP[Aplicacion NewPeople]
        GATEWAY[Agent Gateway]
        SESSION[Servicio de sesiones]
        INTENT[Clasificacion de intencion y entidad]
        POLICY[Politicas de seguridad y alcance]
        REGISTRY[Registro de herramientas]
        TOOLS[Herramientas CRM]
        COMMANDS[Servicio de comandos]
        CRM[Servicios de dominio CRM]
        AUDIT[Auditoria]
        DB[(MySQL)]
    end

    subgraph AI[Proveedor de IA]
        MODEL[Modelo LLM]
    end

    EVAL[Evaluacion y observabilidad]

    SELLER --> UI
    UI --> GATEWAY
    GATEWAY --> SESSION
    GATEWAY --> INTENT
    GATEWAY --> POLICY
    GATEWAY --> MODEL
    MODEL -->|Tool calling o MCP| REGISTRY
    INTENT --> REGISTRY
    POLICY --> REGISTRY
    REGISTRY --> TOOLS
    TOOLS --> CRM
    CRM --> DB
    MODEL -->|Propuesta confirmable| COMMANDS
    COMMANDS --> POLICY
    COMMANDS --> CRM
    COMMANDS --> AUDIT
    AUDIT --> DB
    GATEWAY --> EVAL
    MODEL --> EVAL
    TOOLS --> EVAL
    GATEWAY --> UI
```

## 5. Componentes

### 5.1 Chat integrado

La interfaz debe ser una proyección del estado del agente. Sus responsabilidades son:

- Capturar la pregunta.
- Mostrar mensajes y resultados.
- Mostrar candidatos de una aclaración estructurada.
- Mostrar propuestas de acción.
- Solicitar confirmación.
- Mostrar errores, estado de carga y operaciones pendientes.

La interfaz no debe:

- Consultar directamente tablas del CRM.
- Decidir si una coincidencia es una oportunidad o un lead.
- Deducir estados comerciales.
- Rehacer la lógica de resolución del backend.

### 5.2 Agent Gateway

Es el punto de entrada único para las conversaciones del Coach. Debe:

- Cargar la sesión del usuario.
- Recibir la pregunta y el contexto explícito.
- Validar el formato de entrada.
- Coordinar la resolución de intención y entidades.
- Entregar al modelo únicamente herramientas disponibles para ese usuario.
- Validar la respuesta estructurada del modelo.
- Guardar el turno y el contexto resultante.
- Devolver un contrato estable al frontend.

El Gateway no debe convertirse en una nueva ruta monolítica. La consulta, resolución, comandos y persistencia deben estar separados por servicio.

### 5.3 Clasificación de intención y entidad

Antes de consultar datos se deben identificar:

- Tipo de solicitud: consulta, preparación, recomendación o acción.
- Entidad principal: cuenta, oportunidad, contacto, lead, actividad o pipeline.
- Entidades relacionadas.
- Filtros: etapa, estado, monto, fecha, riesgo o vendedor.
- Necesidad de aclaración.

Regla obligatoria:

> Si el vendedor menciona "oportunidad", no se deben ofrecer leads como sustitutos silenciosos.

Para una pregunta como "¿Cuál es la oportunidad de Totalplay que está en waiting?", el proceso esperado es:

1. Entidad principal: oportunidad.
2. Cuenta relacionada: Totalplay.
3. Etapa solicitada: waiting.
4. Alcance: oportunidades visibles para el vendedor.
5. Estado de activación: activada, salvo que se solicite lo contrario.
6. Resultado: una oportunidad o una lista diferenciada de oportunidades.

### 5.4 Herramientas CRM

Las herramientas deben ser pequeñas, explícitas y comprobables. Ejemplos:

- `searchAccounts`.
- `searchOpportunities`.
- `getOpportunity`.
- `getOpportunityActivities`.
- `getSellerPipeline`.
- `searchContacts`.
- `searchLeads`.
- `prepareActivity`.
- `createActivity`.

Cada herramienta debe:

- Recibir parámetros tipados.
- Aplicar permisos y ownership en el servidor.
- Aplicar filtros de activación y estado de forma explícita.
- Devolver IDs y relaciones completas.
- No devolver duplicados.
- Indicar si el resultado está vacío, es único o es ambiguo.

### 5.5 Servicio de comandos

Todas las escrituras pasan por un servicio separado del flujo de consulta.

Responsabilidades:

- Validar permisos nuevamente.
- Validar que la entidad siga vigente.
- Validar versión o control de concurrencia.
- Ejecutar dentro de transacción cuando corresponda.
- Aplicar idempotencia.
- Registrar auditoría.
- Devolver el resultado real de la operación.

El modelo puede proponer un comando, pero nunca ejecutarlo directamente.

### 5.6 Servicio de sesiones

El servidor debe ser la fuente de verdad de la conversación.

Una sesión debe conservar:

- Usuario.
- Contexto seleccionado.
- Historial normalizado.
- Entidades resueltas.
- Pregunta pendiente.
- Aclaración activa.
- Operaciones pendientes.
- Versión y timestamps.
- Estado activo o cerrado.

El `localStorage` puede conservar una referencia auxiliar, pero no debe poder restaurar una sesión que el servidor considera cerrada.

El contexto de sesión es tipado y relacional. Puede contener cuenta, oportunidad, contacto o lead, pero una entidad mencionada de forma clara y única solo reemplaza el contexto anterior después de validar sus IDs y relaciones. Las referencias como "esa oportunidad" o "el contacto" usan el contexto activo compatible; una nueva entidad explícita inicia un tramo contextual nuevo sin borrar los mensajes visibles.

Al cambiar de cuenta, se debe confirmar el cierre de la conversación, limpiar sus borradores y establecer el nuevo contexto. Las operaciones pendientes deben completarse o descartarse antes del cambio. La opción de conversación general aplica el mismo reinicio sin seleccionar una cuenta.

## 6. Contrato funcional del asesor

Además del contrato técnico de respuestas, el asesor debe diferenciar estos tipos de interacción:

- **Consulta de contexto:** informa datos registrados sin generar cambios.
- **Preparación de etapa:** explica qué está cubierto, qué falta y qué impide avanzar.
- **Diagnóstico y recomendación:** explica riesgo, impacto, mitigación y resultado esperado.
- **Preparación de interacción:** organiza objetivo, participantes, preguntas y compromiso esperado.
- **Creación guiada:** prepara un registro y entrega el control al módulo oficial.
- **Actualización guiada:** propone un cambio mostrando valor actual, nuevo valor y motivo.
- **Aclaración:** solicita únicamente el dato necesario para continuar con seguridad.

Las operaciones funcionales pueden incluir actividades, respuestas de etapa, campos de oportunidad, cuenta o contacto, resultados de llamadas, resolución de leads y creación guiada de cuentas, contactos, oportunidades, leads, mapeos, cotizaciones y propuestas. La lista concreta de campos y permisos debe permanecer en los servicios de dominio, no en el prompt.

## 7. Continuidad y handoff a módulos

Cuando una operación requiere un formulario oficial, el agente debe emitir un handoff opaco asociado al usuario, al módulo destino y a la operación. El handoff:

- No autoriza escrituras directas.
- Tiene vigencia limitada.
- Puede conservarse si el vendedor cierra el formulario sin guardar.
- Se completa únicamente después de un guardado exitoso en el módulo destino.
- Mantiene la intención original y los campos pendientes.

El módulo destino conserva sus catálogos, validaciones, controles de duplicados, permisos y aprobación final. Al regresar al Coach, la sesión debe mostrar si la operación fue completada, cancelada o quedó pendiente.

## 8. Contrato de respuestas

El agente debe devolver un tipo de respuesta estable:

- `informational`: respuesta informativa.
- `clarification`: faltan datos o existen varias coincidencias.
- `recommendation`: recomendación comercial sustentada.
- `action_proposal`: propuesta de modificación.
- `error`: error recuperable o no recuperable.

Una aclaración debe contener:

- Mensaje.
- Tipo de entidad esperado.
- Motivo de la ambigüedad.
- Solicitud original.
- Candidatos.
- Identidad completa de cada candidato.
- Acción que continuará después de seleccionar.

Cada candidato debe incluir, según corresponda:

- `entityType`.
- `id`.
- `name`.
- `accountId`.
- `accountName`.
- `stageCode` y `stageName`.
- Estado de activación.
- Estado comercial.
- Monto.
- Fecha de cierre.

Los candidatos se deben deduplicar por `entityType` e `id` antes de enviarlos al frontend.

## 9. Seguridad y alcance

El modelo no debe recibir ni decidir el alcance completo del CRM. Cada herramienta debe aplicar:

- Permisos del usuario.
- Ownership de cuentas y oportunidades.
- Permisos globales de lectura cuando existan.
- Estado activo del registro.
- Restricciones de módulo.
- Campos sensibles permitidos.

El resultado debe distinguir entre:

- Registro inexistente.
- Registro existente pero fuera del alcance.
- Registro desactivado.
- Registro accesible pero ambiguo.

La ausencia de un registro en una herramienta no debe convertirse automáticamente en una afirmación de que el registro no existe en todo el CRM.

## 10. Flujos principales

### 8.1 Consulta única

```mermaid
sequenceDiagram
    actor V as Vendedor
    participant UI as Chat
    participant G as Agent Gateway
    participant M as Modelo
    participant T as Herramienta CRM
    participant D as Base de datos

    V->>UI: Pregunta comercial
    UI->>G: Pregunta + contexto
    G->>G: Valida sesión, permisos e intención
    G->>M: Pregunta + herramientas disponibles
    M->>T: searchOpportunities(filtros)
    T->>D: Consulta con alcance y estados
    D-->>T: Registros autorizados
    T-->>M: Resultado estructurado
    M-->>G: Respuesta tipada
    G->>G: Valida contrato y guarda turno
    G-->>UI: Respuesta o aclaración
    UI-->>V: Resultado
```

### 8.2 Aclaración

Si existen varias coincidencias:

1. El backend devuelve candidatos del tipo correcto.
2. El frontend muestra información diferenciadora.
3. El vendedor selecciona un candidato.
4. El backend actualiza el contexto.
5. El agente continúa la solicitud original.

No se debe reiniciar la conversación ni cambiar la entidad principal durante este flujo.

### 8.3 Acción comercial

1. El vendedor solicita una acción.
2. El agente consulta la entidad y los datos requeridos.
3. El agente propone la acción con valores visibles.
4. El vendedor confirma.
5. El servicio de comandos valida permisos y versión.
6. Se ejecuta la operación.
7. Se registra auditoría.
8. El agente informa el resultado real.

## 11. Estados y reglas CRM

El Coach debe consumir catálogos únicos para:

- Activación de oportunidades.
- Estados comerciales.
- Etapas de venta.
- Estado de actividades.
- Estado de leads.

Las reglas deben ser explícitas:

- Las oportunidades desactivadas no aparecen en el pipeline normal.
- Las oportunidades históricas no se mezclan con oportunidades abiertas.
- Una etapa `waiting` debe tratarse como código, no como coincidencia textual.
- Un lead no es una oportunidad.
- Una cuenta puede ser el criterio de búsqueda de una oportunidad sin convertirse en la entidad principal.
- Los registros con nombres iguales deben diferenciarse por ID, cuenta, monto o fecha.

## 12. Observabilidad y calidad

Cada turno debe poder rastrearse con:

- Usuario.
- Sesión.
- Pregunta original.
- Intención detectada.
- Herramientas utilizadas.
- Parámetros no sensibles.
- IDs consultados.
- Resultado estructurado.
- Latencia.
- Errores.
- Acción ejecutada, si hubo confirmación.

Debe existir un conjunto de evaluación con preguntas reales del vendedor. Como mínimo:

- Oportunidad por cuenta y etapa.
- Cuenta con varias oportunidades.
- Oportunidad desactivada.
- Lead con nombre parecido a una cuenta.
- Usuario sin ownership.
- Registro fuera de alcance.
- Consulta sin resultados.
- Acción con campos faltantes.
- Acción pendiente y limpieza de sesión.
- Respuesta tardía después de cambiar de contexto.

Cada caso debe tener una expectativa estructurada, no solo una comparación textual de la respuesta.

## 13. Diferencia frente a la implementación actual

| Responsabilidad | Implementación actual | Arquitectura objetivo |
| --- | --- | --- |
| Contexto | Snapshot amplio del CRM | Herramientas específicas bajo demanda |
| Resolución | Coincidencias textuales entre varios dominios | Intención y entidad separadas, con reglas de dominio |
| Oportunidades | Principalmente búsqueda por nombre | Búsqueda por nombre, cuenta, etapa y estado |
| Leads | Pueden competir con oportunidades | Solo se consultan cuando la intención lo indica |
| Frontend | Puede construir aclaraciones propias | Renderiza contratos del backend |
| Acciones | Mezcladas con conversación | Servicio de comandos separado |
| Sesión | Backend más referencia en navegador | Backend como fuente de verdad |
| Permisos | Distribuidos entre rutas y consultas | Aplicados dentro de cada herramienta y comando |
| Calidad | Pruebas por funcionalidad | Evaluación continua con preguntas reales |

## 14. Ruta de transición

### Fase 1: estabilizar consultas

- Definir contratos de respuesta.
- Separar oportunidades, cuentas, contactos y leads.
- Implementar herramientas de solo lectura.
- Resolver búsquedas por cuenta, etapa y estado.
- Eliminar aclaraciones reconstruidas en frontend.
- Agregar deduplicación por ID.

La Fase 0 previa a esta transición está documentada en [Mi Coach - Fase 0: línea base y matriz de evaluación](./chat-coach-fase-0-linea-base.md). Define las preguntas representativas, resultados esperados, casos críticos y criterio de salida antes de modificar el orquestador.

### Fase 2: validar con preguntas reales

- Crear un conjunto de preguntas del equipo comercial.
- Ejecutar el Coach actual y la nueva arquitectura en paralelo.
- Medir entidad correcta, filtros correctos, permisos y necesidad de aclaración.
- Corregir primero errores de datos y contratos, no textos del prompt.

### Fase 3: introducir acciones

- Empezar con una sola acción, por ejemplo registrar actividad.
- Requerir confirmación visible.
- Validar permisos y concurrencia.
- Auditar cada ejecución.
- Añadir acciones adicionales únicamente cuando la anterior sea estable.

### Fase 4: incorporar capacidades especializadas

Solo después de estabilizar el agente principal se deben evaluar agentes especializados para prospección, preparación de reuniones o investigación externa. Estos agentes deben utilizar las mismas herramientas, políticas y contratos del CRM.

## 15. Decisión recomendada

La arquitectura recomendada es:

> Un agente coordinador, un proveedor de IA externo, herramientas CRM pequeñas y tipadas, servicios deterministas para permisos y comandos, y una interfaz que solo renderiza contratos estructurados.

No se recomienda reemplazar toda la aplicación por un chat externo. El chat externo puede aportar el motor de razonamiento, pero el CRM debe conservar el control de datos, seguridad, estados, acciones y auditoría.
