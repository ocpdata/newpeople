# Evaluación live de Cliente existente

## Propósito y alcance

Esta evaluación verifica la interpretación estructurada de Cliente existente con un proveedor de IA real. Es distinta de la [evaluación sintética](./chat-cliente-existente-evaluacion-sintetica.md), que usa fixtures deterministas y no llama a un proveedor de IA.

La evaluación live cubre dos niveles:

- **Controles críticos:** nueve casos enfocados en clasificación, objeto, composición y asociación del turno.
- **Recorridos de integración:** siete escenarios que ejecutan B3 real y su adaptador, y ejercitan B6/B9/B10 y las ramas aplicables.

Los escenarios usan snapshots CRM sintéticos y políticas controladas. El proveedor de IA es real, por lo que las llamadas pueden generar costo. No se realizan escrituras CRM reales. Estas pruebas evalúan el comportamiento de los evaluadores; no forman parte del flujo normal de cada conversación ni del CI configurado actualmente.

## Cuándo ejecutarla

La ejecuta manualmente desarrollo o QA cuando necesita comprobar cambios que puedan afectar la interpretación o el procesamiento de Cliente existente, por ejemplo cambios al catálogo, las instrucciones de B3, el planificador o el modelo. No es necesario correrla por cada cambio de documentación ni por cada conversación.

Ambos comandos son opt-in y desde la raíz del repositorio se ejecutan así:

```bash
npm run test:customer-chat:contract:live --workspace=apps/api -- --output /ruta/contrato.json
npm run test:customer-chat:pipeline:live --workspace=apps/api -- --output /ruta/pipeline.json
```

Antes de ejecutarlos, confirma que el entorno tenga configurado el proveedor de IA previsto y que la ruta de salida sea adecuada para los reportes.

## Controles críticos

Son nueve casos críticos del evaluador, no nueve permisos ni una auditoría exhaustiva. Siete reutilizan casos del catálogo y dos añaden comprobaciones de composición y asociación. El resultado exigido es **9/9**, no un promedio.

| # | Control | Entrada o escenario sintético | Comprobación |
| --- | --- | --- | --- |
| 1 | `report.client_statement` | El cliente atribuye su motivación a sospechas de envío de datos privados por correo. | Reconocer reporte del cliente y objeto correcto, no consejo ni orden de agendar. |
| 2 | `query.field_value` | Preguntar la etapa de Renovación Alfa. | Reconocer consulta de campo y objeto correcto, no reporte o recomendación. |
| 3 | `action.schedule_activity` | «Quiero programar una reunión». | Reconocer acción y objeto `activity`; no confundir con redactar una agenda. |
| 4 | `guidance.next_steps` | «¿Qué me recomiendas para avanzar?». | Reconocer orientación y objeto correcto, no ejecución de la recomendación. |
| 5 | `query.record_list` | Pedir la lista de oportunidades. | Reconocer consulta de colección y objeto correcto. |
| 6 | `action.create_record` | Pedir una oportunidad nueva. | Reconocer creación y objeto correcto aunque después la política la deshabilite. |
| 7 | `content.email_draft` | Pedir un ejemplo de correo sin enviarlo. | Reconocer contenido y objeto correcto, no envío ni creación de actividad. |
| 8 | `compound` | Preguntar etapa y además pedir un correo para solicitar reunión, sin envío. | Obtener dos componentes en orden: `query.field_value` y `content.email_draft`. |
| 9 | `report_destination` | Asociar el reporte del cliente a la oportunidad sintética autorizada. | Preparar el complemento para la pregunta de motivación `9201`, sin operaciones CRM. |

Estos controles verifican interpretación y asociación. Las garantías de permisos, confirmaciones, persistencia y límites también tienen pruebas deterministas y de navegador; el 9/9 no significa que se hayan ejecutado escrituras reales.

## Recorridos de integración

Cada escenario pasa por B3 real y su adaptador, y utiliza B6/B9/B10 y las ramas que correspondan. El snapshot CRM es sintético y las políticas están controladas; el proveedor de IA sí es real. No todos los escenarios recorren todas las etapas: por ejemplo, una operación deshabilitada debe detenerse antes de planificarla. Los siete verifican que haya una sola interpretación `customer_account_turn_contract` y que no se invoque el antiguo clasificador `customer_account_seller_report`.

| # | Recorrido | Mensaje sintético | Resultado comprobado |
| --- | --- | --- | --- |
| 1 | Reporte del cliente | «El cliente me dijo que su motivación en Renovación Alfa es que sospechan que envían datos privados por correo». | Categoría `report.client_statement`, estado `completed`, complemento para la pregunta `9201` y ninguna operación. |
| 2 | Consulta de etapa | «¿En qué etapa está la oportunidad Renovación Alfa?». | Categoría `query.field_value`, estado `completed`, sin operaciones. |
| 3 | Orientación | «¿Qué me recomiendas para avanzar en Renovación Alfa?». | Categoría `guidance.next_steps`, estado `completed`, sin crear operaciones implícitas. |
| 4 | Lista de oportunidades | «Dame una lista de las oportunidades de esta cuenta». | Categoría `query.record_list`, estado `completed`, sin operaciones. |
| 5 | Borrador de correo | «Dame un ejemplo de correo para pedir reunión sobre Renovación Alfa; no lo envíes». | Categoría `content.email_draft`, estado `completed`, sin envío ni operaciones. |
| 6 | Propuesta de reunión | «Quiero programar una reunión sobre Renovación Alfa». | Categoría `action.schedule_activity`, estado `completed`, propuesta `activity` con `scheduledAt` vacío; no reunión guardada. |
| 7 | Creación no habilitada | «Quiero crear una oportunidad nueva llamada Proyecto Gamma». | Categoría `action.create_record`, estado `disabled` por la política de la prueba y ninguna operación. |

## Resultados de referencia

Los siguientes números son resultados **históricos**, no una medición del estado actual. La referencia identifica el proveedor/modelo `gpt-4.1-mini`, pero no registra fecha ni revisión del código, por lo que no se puede atribuir a una versión concreta.

| Evaluación | Resultado observado | Umbral exigido |
| --- | --- | --- |
| Categoría y objeto, 44 casos | 43/44 (97,7%) | Al menos 95% |
| Movimiento, 13 casos | 12/13 (92,3%) | Al menos 90% |
| Controles críticos | 9/9 | 100% |
| Recorridos completos sintéticos | 7/7 | 100% |

Quedaron dos discrepancias: en una consulta de cotización el objeto fue `opportunity` en lugar de `quotation`, aunque conserva el lector autorizado de cotizaciones; el cambio de foco fue `new_request` en lugar de `change_focus`, ambos sin reutilizar el reporte pendiente. Estos resultados no son garantía de interpretación perfecta ni certificación sobre datos reales.

## Fuentes y pruebas relacionadas

- [Corpus de las 44 categorías](../apps/api/test/fixtures/customer-turn-cases.js).
- [Evaluador de catálogo, movimientos y controles críticos](../apps/api/scripts/evaluateCustomerTurnContract.js).
- [Pruebas de integración y siete recorridos reales opt-in](../apps/api/test/customer-turn-pipeline.test.js).
- [Ejecutor de evaluación del pipeline](../apps/api/scripts/evaluateCustomerTurnPipeline.js).
- [Pruebas del contrato y continuidad](../apps/api/test/customer-turn-contract.test.js).
- [Pruebas de activación por entorno](../apps/api/test/customer-turn-config.test.js).

La evaluación sintética determinista, que no usa proveedor externo, tiene su propio [corpus, alcance y comando de ejecución](./chat-cliente-existente-evaluacion-sintetica.md).
