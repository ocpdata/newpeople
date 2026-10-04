# Integraciones Mi Coach

Este documento describe como los tres canales consumen el motor conversacional comun. No define el objetivo comercial del Coach ni reemplaza el contrato del motor.

## Canales

| Canal             | Adaptador                                                       | Contexto            | Persistencia                 |
| ----------------- | --------------------------------------------------------------- | ------------------- | ---------------------------- |
| Coach             | `apps/api/src/coach/coach-adapter.js`                           | CRM autorizado      | Sesiones e historial Coach   |
| Cliente existente | `apps/api/src/commercial-intelligence/customer-chat-adapter.js` | Cuenta CRM fija     | Jobs `account_chat`          |
| Cuenta nueva      | `apps/api/src/prospect-research/prospect-chat-adapter.js`       | Sesion de prospecto | `prospect_research_sessions` |

## Cliente existente

El alcance, la matriz funcional, los permisos y el comportamiento esperado del canal se definen en [Alcance funcional: Chat de Cliente existente](./chat-cliente-existente-alcance.md). Ese contrato prevalece sobre descripciones resumidas de capacidades en documentos de arquitectura.

Entrada:

- `POST /api/commercial-intelligence/account-chat/jobs`

El adaptador recibe un snapshot CRM autorizado y ofrece herramientas para:

- Consultar la cuenta y buscar oportunidades; obtener el detalle de una oportunidad.
- Consultar actividades, pipeline y readiness de etapa de oportunidades de esa cuenta.
- Buscar contactos y leads relacionados con la cuenta.
- Consultar el contenido de la ultima cotizacion accesible de una oportunidad seleccionada.
- Consultar interacciones de la cuenta mediante `searchInteractions`.
- Incorporar investigacion publica cuando el gobierno y los permisos lo permiten.

Las herramientas comunes de lectura son las del catalogo de Coach: `searchAccounts`, `searchOpportunities`, `getOpportunity`, `getOpportunityActivities`, `getOpportunityQuotation`, `searchContacts`, `searchLeads`, `getSellerPipeline` y `getOpportunityReadiness`. Cliente existente ejecuta ese catalogo sobre un snapshot filtrado a la cuenta fija; `searchInteractions` es adicional del canal.

Cada herramienta sigue requiriendo sus permisos de lectura:

| Herramienta                                                                | Permisos requeridos                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `searchAccounts`                                                           | `cuentas.read`                                              |
| `searchOpportunities`, `getOpportunity`                                    | `oportunidades.read`                                        |
| `getOpportunityActivities`, `getSellerPipeline`, `getOpportunityReadiness` | `oportunidades.read` y `desarrollo_comercial.read`          |
| `getOpportunityQuotation`                                                  | `oportunidades.read` y al menos un permiso `cotizaciones.*` |
| `searchContacts`                                                           | `contactos.read`                                            |
| `searchLeads`                                                              | `interacciones.read`                                        |
| `searchInteractions` (solo Cliente existente)                              | `interacciones.read`                                        |

La lectura de la cotizacion conserva ownership de cuenta (excepto para administracion de cotizaciones) y expone solo contenido comercial, no costo interno, margen ni notas internas.

Cliente existente puede proponer las mismas operaciones controladas que Coach: actividades, respuestas de etapa, resultados de llamadas de lead y cambios de campos de cuenta, contacto u oportunidad. Las propuestas se limitan a entidades del snapshot de la cuenta fija; la API vuelve a comprobar la cuenta, la relación del registro, `mi_coach.execute` y los permisos de dominio. Al revisarlas, se trasladan a un borrador persistido en una sesión de Coach y usan su flujo estándar de revisión, confirmación y ejecución; el chat de Cliente existente no ejecuta escrituras directamente. Una solicitud de correo produce un borrador y nunca lo envía automáticamente.

### Account Intelligence

Además del chat, Cliente existente ofrece análisis e investigación sobre un snapshot CRM autorizado y versionado como `account-intelligence.v1`. Puede generar salud y riesgos de cuenta, contexto comercial, renovación y expansión, briefings y hallazgos sugeridos. El snapshot incluye datos CRM autorizados y partidas comerciales de cotización; una partida aceptada o ganada no demuestra compra ni entrega y conserva `fulfillmentStatus: not_verified`. Los casos de soporte no están disponibles en este contrato.

Los hallazgos conservan evidencia, fuente, confianza y certeza. CRM interno, investigación pública e inferencias se presentan por separado. Los hallazgos que podrían cambiar el CRM requieren confirmación del vendedor; ninguna investigación escribe registros automáticamente. La investigación pública depende de la acción explícita del vendedor, permisos y gobierno de fuentes externas.

Rutas principales bajo `/api/commercial-intelligence`:

- Creación `POST` y consulta `GET .../:jobId` para `/customer-research/jobs`, `/account-internal-analysis/jobs`, `/external-research/jobs`, `/commercial-discovery/jobs`, `/executive-briefing/jobs` y `/agents/jobs`.
- `GET` `/agents/metrics`, `/account-intelligence/snapshot` y `/findings`.
- `POST` `/findings/:findingId/confirm`, `/reject`, `/apply` y `/apply-contact`.

Las rutas requieren `mi_coach.use` y los permisos de inteligencia comercial correspondientes; la investigación externa también requiere `fuentes_externas.execute`. Las acciones sobre hallazgos validan permisos de escritura y confirmación según el destino.

## Cuenta nueva

Entrada conversacional:

- `POST /api/prospect-research/sessions/:sessionId/chat`

La sesión también puede consultarse y enriquecerse mediante las rutas `/api/prospect-research/sessions/:sessionId`, `/run` y `/run-external`. La investigación puede proponer hallazgos, contactos e hipótesis, pero no crea entidades CRM. Las conversiones explícitas a cuenta, contacto, lead u oportunidad requieren confirmación, permisos y auditoría; la revisión de duplicados se realiza antes de convertir. La investigación pública requiere una acción explícita y la política de fuentes externas vigente.

El adaptador trabaja con:

- Perfil ingresado por el vendedor.
- Hallazgos de la sesion.
- Evidencia publica.
- Contactos objetivo.
- Hipotesis de oportunidad.
- Borrador de outreach.

Las entidades CRM permanecen nulas hasta una conversion confirmada. Las operaciones de conversion usan `create_account`, `create_contact` o `create_opportunity` y siempre requieren confirmacion.

## Separacion de datos

```text
Coach              -> sesion Coach + CRM autorizado
Cliente existente  -> cuenta fija + job account_chat
Cuenta nueva       -> sesion prospecto + evidencia publica
```

Ningun canal reutiliza el historial de otro canal. Los datos publicos no se presentan como registros CRM confirmados.

## Operaciones

Todos los canales usan el contrato definido en:

- `apps/api/src/coach/contract.js`
- `apps/api/src/coach/operation-contract.js`

Cada operacion incluye `sourceChannel`:

- `coach`
- `customer_account`
- `prospect`

El motor solo propone. La revision, confirmacion, ejecucion y auditoria pasan por los servicios controlados existentes y por las politicas del canal.

## Pruebas

- `apps/api/test/customer-chat-adapter.test.js`
- `apps/api/test/prospect-chat-adapter.test.js`
- `apps/api/test/operation-contract.test.js`
- `apps/api/test/api.integration.test.js`
- `apps/web/e2e/mi-agent-governance.spec.js`
