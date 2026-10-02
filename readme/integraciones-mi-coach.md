# Integraciones Mi Coach

Este documento describe como los tres canales consumen el motor conversacional comun. No define el objetivo comercial del Coach ni reemplaza el contrato del motor.

## Canales

| Canal | Adaptador | Contexto | Persistencia |
| --- | --- | --- | --- |
| Coach | `apps/api/src/coach/coach-adapter.js` | CRM autorizado | Sesiones e historial Coach |
| Cliente existente | `apps/api/src/commercial-intelligence/customer-chat-adapter.js` | Cuenta CRM fija | Jobs `account_chat` |
| Cuenta nueva | `apps/api/src/prospect-research/prospect-chat-adapter.js` | Sesion de prospecto | `prospect_research_sessions` |

## Cliente existente

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

| Herramienta | Permisos requeridos |
| --- | --- |
| `searchAccounts` | `cuentas.read` |
| `searchOpportunities`, `getOpportunity` | `oportunidades.read` |
| `getOpportunityActivities`, `getSellerPipeline`, `getOpportunityReadiness` | `oportunidades.read` y `desarrollo_comercial.read` |
| `getOpportunityQuotation` | `oportunidades.read` y al menos un permiso `cotizaciones.*` |
| `searchContacts` | `contactos.read` |
| `searchLeads` | `interacciones.read` |
| `searchInteractions` (solo Cliente existente) | `interacciones.read` |

La lectura de la cotizacion conserva ownership de cuenta (excepto para administracion de cotizaciones) y expone solo contenido comercial, no costo interno, margen ni notas internas.

Las operaciones se limitan a actividades de la cuenta y siempre requieren confirmacion. Una solicitud de correo produce un borrador; no envia mensajes automaticamente. Esta paridad de lectura no habilita a Cliente existente para proponer las operaciones de campos o etapa disponibles en Coach.

## Cuenta nueva

Entrada conversacional:

- `POST /api/prospect-research/sessions/:sessionId/chat`

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
