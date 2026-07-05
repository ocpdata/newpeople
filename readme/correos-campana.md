# Correos de campana

## Alcance

Este documento describe el modulo de Correos de campana del CRM, incluyendo:

- seleccion de campana origen;
- sugerencia automatica de tipo de correo segun tipo y subtipo de campana;
- edicion base del correo (asunto, preheader, CTA y HTML);
- visualizacion de audiencia asociada a la campana;
- envio de prueba por Google;
- encolado y envio automatico por corrida con limites operativos;
- tablero basico de estado y control (pausa, reanudar, cancelar).

## Logica de negocio

### Modelo funcional

- Cada correo pertenece conceptualmente a una campana.
- La campana seleccionada determina el contexto comercial, la audiencia y la sugerencia del tipo de correo.
- El borrador visual se conserva localmente en el navegador por campana.
- El envio real ya usa persistencia backend por corrida y por destinatario.
- La audiencia visible del correo se deriva de la audiencia guardada en la campana.

### Tabs actuales del modulo

1. `Campana / Correo`

- seleccion de campana;
- asunto;
- tipo de correo sugerido;
- estado operativo del borrador;
- CTA principal y URL.

2. `Editor`

- asunto y preheader;
- HTML editable del correo;
- vista previa embebida del contenido;
- envio de prueba a correos internos.

3. `Programacion`

- fecha de referencia del borrador;
- limites operativos V1 visibles como configuracion fija:
  - maximo 50 envios por hora;
  - maximo 300 envios por dia;
- inicio de corrida de envio;
- acciones de control: pausa, reanudar, cancelar.

4. `Resultados`

- estado de corrida;
- total en cola, enviados, pendientes, fallidos, omitidos;
- enviados en la ultima hora y enviados del dia;
- ultimo error y siguiente reintento;
- tabla basica de destinatarios procesados.

### Sugerencia automatica del tipo de correo

El modulo usa una matriz exacta `tipo_campana + subtipo_campana -> tipo_de_correo_sugerido` para inicializar el campo `send_type`.

Tipos de correo actuales:

- `correo_masivo`
- `secuencia`
- `recordatorio`
- `seguimiento`

Reglas operativas de alto nivel:

- `correo_automatizado` sugiere `secuencia`.
- `correo_masivo` sugiere `correo_masivo`.
- `webinar`, `evento_presencial`, `evento_virtual` y `sms` sugieren `recordatorio`.
- `landing_page`, `whatsapp`, `encuesta`, `anuncios_busqueda` y `redes_sociales_pagadas` suelen sugerir `seguimiento`.
- algunos subtipos de awareness como `redes_sociales_organicas` o `anuncios_display` pueden sugerir `correo_masivo` segun el tipo de campana.

La logica actual se aplica al construir el borrador del correo de una campana.

## Dependencias funcionales

El modulo depende de piezas existentes:

- Campanas: origen del contexto comercial y clasificacion.
- Audiencia de campana: fuente de cuentas y contactos visibles.
- Conexion de Google Mail del usuario autenticado para envio real.

Fuentes en frontend:

- listado de campanas desde `GET /api/campaigns`;
- audiencia de campana desde `GET /api/campaigns/:campaignId/accounts`.

## Permisos actuales

El acceso actual al modulo reutiliza permisos de campanas:

- `campanas.read`
- `campanas.create`
- `campanas.update`

Estos permisos aplican tambien para los endpoints de prueba, envio y control de corridas.

Como evolucion futura, el modulo podria tener permisos propios, por ejemplo:

- `correos.read`
- `correos.create`
- `correos.update`
- `correos.send`
- `correos.analytics.read`

## Estado actual de implementacion

Estado: V1 operativa (frontend + backend de corrida y worker).

### Ya implementado

- pagina independiente del modulo de correos;
- acceso por menu lateral dentro del grupo Marketing;
- ruta dedicada;
- tabs funcionales de composicion, programacion y resultados;
- borrador local por campana usando almacenamiento del navegador;
- sugerencia automatica de tipo de correo segun matriz de campana;
- selector de tipo de correo con descripciones cortas;
- editor HTML con vista previa embebida;
- lectura de audiencia real desde campañas.
- envio de prueba (`/api/campaign-emails/test-send`);
- creacion de corrida en cola (`/api/campaign-emails/send`);
- procesamiento automatico con worker backend;
- limite real de ventana movil por hora (50) y tope diario (300);
- estado de corrida y destinatarios en backend;
- acciones de pausa, reanudar y cancelar.

### Aun no implementado

- versionado funcional de contenido por corrida (historial de ediciones del borrador);
- plantillas reutilizables de correo;
- configuracion avanzada por zona horaria de negocio;
- tracking real de entregas, aperturas, clics, rebotes o bajas;
- analitica comercial consolidada por cuenta/campana;
- permisos granulares propios del modulo.

## API del modulo

Lectura de contexto:

- `GET /api/campaigns`
- `GET /api/campaigns/:campaignId/accounts`

Envio y corridas:

- `POST /api/campaign-emails/test-send`
- `POST /api/campaign-emails/send`
- `GET /api/campaign-emails/runs/:runId`
- `GET /api/campaign-emails/campaign/:campaignId/latest`
- `POST /api/campaign-emails/runs/:runId/pause`
- `POST /api/campaign-emails/runs/:runId/resume`
- `POST /api/campaign-emails/runs/:runId/cancel`

Persistencia backend de V1:

- `campaign_email_dispatches`
- `campaign_email_dispatch_recipients`

La inicializacion del schema ocurre en el arranque del API.

## Consideraciones operativas

- El borrador del correo es local al navegador actual; no debe asumirse como persistencia compartida entre usuarios.
- El envio real requiere conexion Google vigente con permisos de envio.
- La audiencia mostrada depende de que la campana tenga audiencia previamente guardada.
- El limite operativo V1 es fijo: 50 por hora y 300 por dia.
- Si la corrida llega al tope diario, continua automaticamente al siguiente dia.
- El worker reintenta fallos transitorios de destinatario y expone estado en resultados.

## Estado actual de la aplicacion (2026-07)

- El modulo vive en una pagina independiente del frontend y esta conectado al shell principal.
- La navegacion disponible incluye `Campanas`, `Correos` y `Landing` dentro del grupo Marketing.
- La ruta legacy `campaign-management` se retiro del menu y redirige a `campaigns`.
- Existe backend dedicado de corridas para envio automatico con control operativo basico.
