# Campanas

## Alcance

Este documento describe el modulo de Campanas del CRM, incluyendo:

- catalogos de tipo, subtipo, estado y etapa de ciclo de vida;
- creacion y edicion de campanas;
- politica de compatibilidad tipo/subtipo;
- gestion de audiencia por cuenta y contactos asociados;
- sugerencias de cuentas por etapa de ciclo de vida.

No cubre en detalle la ejecucion de correos de campana ni la publicacion de landing pages, salvo la relacion funcional con esos modulos.

## Logica de negocio

### Modelo funcional

- Una campana define contexto comercial (tipo/subtipo), estado operativo y etapa objetivo.
- La campana puede tener audiencia objetivo por cuenta (`campaign_account_interactions`).
- Cada cuenta de audiencia puede tener contactos asociados (`campaign_account_interaction_contacts`).
- El modulo valida combinaciones de tipo/subtipo mediante una politica de compatibilidad.

### Compatibilidad tipo/subtipo

- Niveles disponibles:
  - `permitido`
  - `permitido_con_aprobacion`
  - `bloqueado`
- Si la combinacion resulta `bloqueado`, la API rechaza la creacion/edicion.
- Si la combinacion esta permitida o permitida con aprobacion, la campana puede guardarse.

### Estados de campana

- `borrador`
- `en_ejecucion`
- `pausada`
- `finalizada`
- `cancelada`

### Etapas de ciclo de vida

- `visitante`
- `lead_nuevo`
- `lead_calificado`
- `oportunidad`
- `cliente_nuevo`
- `cliente_activo`
- `cliente_en_riesgo`
- `cliente_inactivo`

### Audiencia

- La audiencia se administra por cuenta.
- Cada registro de cuenta en audiencia incluye estado de interaccion, notas y ultima interaccion.
- Se pueden asociar contactos validos de esa cuenta para el alcance operativo de campana.
- La API soporta reemplazo masivo de audiencia y actualizacion puntual por cuenta.

## Dependencias funcionales

El modulo depende de:

- Cuentas (`accounts`)
- Contactos (`contacts`)
- Oportunidades y estados comerciales (para sugerencias de cuentas)
- Usuarios y permisos (`users`, `roles`, `permissions`)

Relacion con otros modulos:

- Correos de campana consume campanas y audiencia para encolar destinatarios.
- Landing se usa como subtipo posible (`landing_page`) dentro de una campana.

## Permisos requeridos

Permisos del modulo:

- `campanas.read`: ver catalogos, listados, detalle y audiencia.
- `campanas.create`: crear campanas.
- `campanas.update`: editar campanas y audiencia.

Asignacion automatica actual:

- roles admin/sistema: reciben permisos de campanas;
- roles con `desarrollo_comercial.read` o `desarrollo_comercial.update`: reciben `campanas.read`;
- roles con `desarrollo_comercial.update`: ademas reciben `campanas.create` y `campanas.update`.

## API del modulo

Base privada (requiere autenticacion + permisos): `/api/campaigns`

- `GET /api/campaigns/catalogs`
- `GET /api/campaigns/accounts/suggestions?etapa_ciclo_vida=...`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/:campaignId`
- `PATCH /api/campaigns/:campaignId`
- `GET /api/campaigns/:campaignId/accounts`
- `PUT /api/campaigns/:campaignId/accounts`
- `PATCH /api/campaigns/:campaignId/accounts/:accountId`

## Persistencia principal

Tablas:

- `campaigns`
- `campaign_account_interactions`
- `campaign_account_interaction_contacts`

El schema se asegura en arranque del API.

## Consideraciones operativas

- La etapa de ciclo de vida de campana ayuda a segmentar y sugerir cuentas objetivo.
- La audiencia de campana impacta directamente el modulo de Correos de campana.
- Para campanas con subtipo `landing_page`, conviene mantener slug estable y coordinacion con el modulo de Landing.

## Estado actual de la aplicacion (2026-07)

- Campanas ya opera con backend propio para catalogos, CRUD y audiencia.
- La navegacion de frontend ubica Campanas dentro del grupo `Marketing`.
- El modulo `Gestion de campanas` se retiro del sidebar y su ruta redirige a Campanas.
