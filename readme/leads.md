# Leads

## Alcance

Este documento describe el modulo de leads/interacciones del CRM, incluyendo:

- creacion del lead con evidencia documental;
- analisis manual de documentos y notas;
- captura y ajuste de sinopsis comercial;
- resolucion de sugerencias hacia cuenta, contactos, vendedor y oportunidad;
- descalificacion con razon obligatoria;
- seguimiento comercial posterior a la llamada;
- restricciones operativas, estados y acciones visibles.

No cubre en detalle la logica interna de cuentas, contactos u oportunidades fuera
de lo que impacta directamente la conversion del lead.

Documento relacionado:

- [Definiciones funcionales de tableros de leads v1](./tableros-leads-v1.md)

## Logica de negocio

### Naturaleza del lead

- El lead centraliza evidencia de entrada: correos, minutas, cotizaciones,
  audios, imagenes, texto pegado y otros soportes documentales.
- El lead no crea automaticamente entidades comerciales finales al momento del alta.
- La resolucion del lead sirve para decidir que informacion se vincula con el CRM
  y que informacion se ignora.

### Analisis documental

- La carga documental esta desacoplada del analisis.
- Crear el lead solo guarda evidencia y fuente; no completa por si mismo la
  cuenta, contactos u oportunidad.
- El usuario debe abrir el lead y ejecutar `Analizar documentos para llenar
  informacion` para refrescar sinopsis, sugerencias y relaciones detectadas.
- Si se agregan nuevos archivos despues, deben subirse primero y luego volver a
  ejecutar el analisis para que las sugerencias se actualicen.

### Estados estructurales del lead

- `Creado`: falta cuenta o falta al menos un contacto.
- `Lead no asignado`: ya hay cuenta y al menos un contacto, pero aun no tiene
  vendedor asignado.
- `Lead asignado`: ya hay cuenta, contacto y vendedor, pero aun no tiene
  oportunidad vinculada o creada.
- `Lead calificado`: ya tiene cuenta, contacto, vendedor y oportunidad.
- `Lead descalificado`: se determino que no es una oportunidad comercial viable.

Regla rapida:

- La progresion normal es `Creado -> Lead no asignado -> Lead asignado -> Lead calificado`.
- Un lead tambien puede terminar como `Lead descalificado`.

### Resolucion comercial

- La cuenta sugerida puede resolverse como:
  - vincular una cuenta existente,
  - crear una cuenta nueva,
  - ignorar la sugerencia.
- Cada contacto sugerido puede resolverse como:
  - vincular contacto existente,
  - crear contacto nuevo,
  - ignorar.
- Cada oportunidad sugerida puede resolverse como:
  - vincular oportunidad existente,
  - crear oportunidad nueva,
  - ignorar.
- La oportunidad solo debe resolverse cuando ya existe cuenta resuelta, al menos
  un contacto resuelto y un vendedor comercial definido.
- El sistema muestra revision de duplicados durante el guardado antes de cerrar
  la conversion del lead.

### Asignacion comercial

- La asignacion del vendedor depende de la politica comercial calculada por el backend.
- Si la cuenta vinculada ya tiene owners vendedores, el vendedor del lead debe
  salir de ese conjunto cuando la politica lo exige.
- En algunos escenarios el usuario actual puede autoasignarse como owner vendedor
  para continuar con la conversion del lead.
- Un lead con oportunidad ya vinculada no debe reabrir asignaciones que rompan
  la consistencia comercial ya persistida.

### Descalificacion

- Un lead no finalizado puede marcarse como descalificado.
- La razon de descalificacion es obligatoria.
- La razon queda persistida en el lead y puede consultarse desde el badge de
  `Lead descalificado` dentro del modal de detalle.
- Un lead ya `calificado` o ya `descalificado` no debe volver a descalificarse.

### Seguimiento comercial

- Ademas del estado estructural, el lead puede registrar un resultado comercial
  de llamada.
- El seguimiento comercial guarda:
  - situacion del lead,
  - motivo principal,
  - accion obligatoria,
  - fecha compromiso cuando aplica,
  - persona referida cuando aplica,
  - area objetivo cuando aplica,
  - comentario comercial.
- Las combinaciones validas dependen del estado estructural actual del lead y de
  reglas de transicion definidas por backend.
- Algunas combinaciones pueden mantener el estado actual y otras pueden llevar a
  `Lead descalificado`.
- La UI del seguimiento comercial ya no usa selects simples para la decision principal.
- La captura guiada usa tarjetas clicables con criterio visible para:
  - situacion del lead,
  - motivo principal,
  - accion obligatoria.
- La misma guia tambien puede consultarse fuera del modal desde el bloque de
  seguimiento comercial en el detalle del lead.

#### Significado de cada opcion de `Situacion del lead`

Nota operativa:

- El selector no es un catalogo libre de uso indiscriminado.
- En la version actual, cada opcion visible se combina con un motivo y una
  accion obligatoria ya definida por el sistema.
- Por eso, documentar `cuando usarla` es mas importante que memorizar el codigo.

##### Intento de contacto pendiente

Que significa:

- Todavia no se logro una conversacion util con el prospecto.
- Puede ser un primer intento o un reintento despues de no obtener respuesta.

Cuando usarla:

- Cuando aun falta contactar realmente al lead.
- Cuando hubo un acercamiento incompleto y necesitas recopilar mas contexto
  antes de avanzar.
- Cuando la evidencia del lead existe, pero todavia no hay validacion comercial suficiente.

Cuando no usarla:

- Si el prospecto ya pidio una reunion.
- Si ya confirmo interes concreto.
- Si ya te refirio a otra persona o a otra area.

Configuracion actual asociada:

- Motivo: `Falta más información`.
- Accion obligatoria: `Completar contexto`.
- No exige fecha compromiso.

##### Reunión solicitada

Que significa:

- El contacto mostro interes inicial y el siguiente paso natural es agendar una reunion.
- Aun no existe una confirmacion cerrada de fecha o espacio.

Cuando usarla:

- Cuando el prospecto acepta avanzar a una conversacion mas profunda.
- Cuando ya validaste interes, pero todavia dependes de coordinar agenda.

Cuando no usarla:

- Si la reunion ya quedo confirmada.
- Si el prospecto solo pidio que le escribas despues sin comprometerse a reunion.

Configuracion actual asociada:

- Motivo: `Interés confirmado`.
- Accion obligatoria: `Agendar reunión`.
- Exige fecha compromiso.

##### Reunión confirmada

Que significa:

- El siguiente contacto ya no es tentativo; ya existe un acuerdo concreto para reunirse.

Cuando usarla:

- Cuando ya hay fecha pactada o confirmacion expresa del siguiente encuentro.
- Cuando el lead ya salio de la fase de exploracion inicial y entrara a descubrimiento o validacion.

Cuando no usarla:

- Si apenas estas proponiendo reunirte.
- Si solo hay interes verbal, pero no compromiso real de agenda.

Configuracion actual asociada:

- Motivo: `Aceptó siguiente reunión`.
- Accion obligatoria: `Agendar reunión`.
- Exige fecha compromiso.

##### Seguimiento posterior

Que significa:

- El prospecto no rechaza el tema, pero pide retomarlo despues.
- El lead sigue vivo, pero no debe trabajarse activamente en este momento.

Cuando usarla:

- Cuando el cliente pide volver a hablar en otra fecha.
- Cuando existe interes latente, pero no disponibilidad inmediata.
- Cuando conviene dejar un recordatorio formal en lugar de seguir presionando.

Cuando no usarla:

- Si el problema real es presupuesto del siguiente ciclo.
- Si el tema no es prioridad y no hay fecha clara para retomarlo.
- Si ya decidiste descalificar temporal o definitivamente.

Configuracion actual asociada:

- Motivo: `Pidió hablar después`.
- Accion obligatoria: `Definir fecha de recontacto`.
- Exige fecha compromiso.

##### Restricción de presupuesto

Que significa:

- El caso podria ser valido, pero hoy no existe presupuesto utilizable.
- No es una negativa total; es una restriccion temporal de compra.

Cuando usarla:

- Cuando el cliente confirma interes, pero el presupuesto queda para otro trimestre o ciclo.
- Cuando el proyecto existe, pero financieramente no puede moverse ahora.

Cuando no usarla:

- Si el prospecto simplemente no ve prioridad.
- Si no hay iniciativa real y el caso esta practicamente cerrado.
- Si lo correcto es documentar una descalificacion temporal o definitiva.

Configuracion actual asociada:

- Motivo: `Presupuesto en otro ciclo`.
- Accion obligatoria: `Definir fecha de recontacto`.
- Exige fecha compromiso.

##### No es prioridad ahora

Que significa:

- El tema tiene encaje potencial, pero no esta en el foco actual del prospecto.
- La barrera principal es prioridad, no interes tecnico ni presupuesto exclusivamente.

Cuando usarla:

- Cuando el cliente dice que lo revisara mas adelante por carga operativa o agenda ejecutiva.
- Cuando reconoce valor, pero no lo considera urgente hoy.

Cuando no usarla:

- Si la objecion central es falta de presupuesto.
- Si el cliente pidio explicitamente no ser contactado.
- Si existe un referido claro a otra persona o area.

Configuracion actual asociada:

- Motivo: `El momento no es adecuado`.
- Accion obligatoria: `Definir fecha de recontacto`.
- Exige fecha compromiso.

##### Contacto incorrecto detectado

Que significa:

- La persona con la que hablaste no es dueña del problema o no puede mover la oportunidad.

Cuando usarla:

- Cuando confirmas que el interlocutor no es el responsable correcto.
- Cuando necesitas reemplazar al contacto actual por otro mas pertinente.

Cuando no usarla:

- Si el mismo contacto si es valido, pero te pide sumar a otra persona.
- Si el ajuste real es hacia otra area completa, no solo otro individuo.

Configuracion actual asociada:

- Motivo: `No es la persona correcta`.
- Accion obligatoria: `Contactar a la persona referida`.
- Exige capturar `Persona referida`.

##### Se necesita contacto alternativo

Que significa:

- El lead sigue teniendo potencial, pero hace falta sumar o ubicar otro contacto mejor posicionado.

Cuando usarla:

- Cuando el interlocutor actual te refiere a otro nombre.
- Cuando el contacto actual coopera, pero no es suficiente para desarrollar la oportunidad.

Cuando no usarla:

- Si ya comprobaste que el contacto actual es incorrecto y debe sustituirse por completo.
- Si la redireccion es hacia otra area y no solo hacia otra persona.

Configuracion actual asociada:

- Motivo: `Refirió a otro contacto`.
- Accion obligatoria: `Contactar a la persona referida`.
- Exige capturar `Persona referida`.

##### La cuenta tiene potencial adicional

Que significa:

- El caso original no necesariamente madura con el interlocutor o uso actual,
  pero existe otra area o necesidad dentro de la misma cuenta que vale explorar.

Cuando usarla:

- Cuando detectas otra unidad de negocio, area o frente donde la propuesta podria encajar mejor.
- Cuando no conviene abandonar la cuenta, sino redirigir la conversacion.

Cuando no usarla:

- Si solo necesitas otro contacto dentro de la misma misma area.
- Si el lead ya debe cerrarse como descalificado.

Configuracion actual asociada:

- Motivo: `La cuenta tiene potencial en otro caso de uso`.
- Accion obligatoria: `Explorar otra área`.
- Exige capturar `Área objetivo`.
- Exige comentario comercial.

##### Valor no alineado con este contacto

Que significa:

- La propuesta no resuena con el interlocutor actual, aunque podria tener valor en otra area o con otro enfoque interno.

Cuando usarla:

- Cuando el contacto actual no ve relevancia, pero la cuenta no debe descartarse todavia.
- Cuando el problema no es rechazo global de la cuenta, sino falta de encaje con este frente especifico.

Cuando no usarla:

- Si el lead realmente ya no tiene potencial en la cuenta.
- Si solo hace falta reagendar contacto mas adelante.

Configuracion actual asociada:

- Motivo: `La oferta no aplica a esta área`.
- Accion obligatoria: `Explorar otra área`.
- Exige capturar `Área objetivo`.
- Exige comentario comercial.

##### Descalificación temporal

Que significa:

- Hoy no hay iniciativa comercial activa, pero existe posibilidad razonable de reabrir el caso despues.

Cuando usarla:

- Cuando el cliente no tiene iniciativa actual, pero la necesidad podria reaparecer.
- Cuando quieres sacar el lead del trabajo activo sin perder el contexto de regreso.

Cuando no usarla:

- Si el prospecto pidio no volver a ser contactado.
- Si confirmaste que no existe encaje real de mercado o solucion.
- Si el cierre es definitivo y no esperas retorno razonable.

Configuracion actual asociada:

- Motivo: `No existe iniciativa actual`.
- Accion obligatoria: `Definir fecha de recontacto`.
- Estado resultante: `Lead descalificado`.
- Exige fecha compromiso.
- Exige comentario comercial.

##### Descalificación definitiva

Que significa:

- El lead debe cerrarse sin expectativa seria de recuperacion.
- La decision ya no es posponer, sino terminar el trabajo comercial sobre ese caso.

Cuando usarla:

- Cuando el prospecto expresa que no hay interes definitivo.
- Cuando solicita explicitamente no ser contactado.
- Cuando la continuidad comercial seria improductiva o inapropiada.

Cuando no usarla:

- Si solo falta presupuesto temporal.
- Si el tema puede retomarse en una fecha futura razonable.

Configuracion actual asociada:

- Opcion 1:
  - Motivo: `No hay interés definitivo`.
  - Accion obligatoria: `Cerrar como descalificado`.
  - Estado resultante: `Lead descalificado`.
  - Exige comentario comercial.
- Opcion 2:
  - Motivo: `Solicita no ser contactado`.
  - Accion obligatoria: `Marcar como no contactar`.
  - Estado resultante: `Lead descalificado`.
  - Exige comentario comercial.

## Superficie funcional

### Punto de entrada

- El modulo se abre desde la seccion `Leads` del CRM.
- El encabezado incluye:
  - titulo `Leads`,
  - icono del modulo,
  - icono `?` con ayuda contextual,
  - subtitulo operativo,
  - boton `+ Crear lead` cuando el usuario puede crear.

### Archivos involucrados

- Frontend:
  - `apps/web/src/InteractionsPage.jsx`
  - `apps/web/src/interactions/LeadCallOutcomeGuides.jsx`
  - `apps/web/src/interactions/leadCallOutcomeGuideData.js`
- Backend:
  - `apps/api/src/routes.interactions.js`
  - `apps/api/src/interactions/schema.js`
  - `apps/api/sql/schema.sql`

## Listado del modulo

### Barra superior

- Filtro multiple por estado:
  - `Creado`
  - `Lead no asignado`
  - `Lead asignado`
  - `Lead calificado`
  - `Lead descalificado`
  - `Todas`
- Busqueda inline por:
  - ID,
  - titulo,
  - cuenta,
  - oportunidad,
  - resumen.
- Filtro por fuente del lead:
  - `Fabricante`
  - `Mayorista`
  - `Empresa de Marketing`
  - `Vendedor`
  - `Campaña`
  - `Web`
  - `Correo`
  - `Redes`
  - `Consultor`
  - `Webinar`
  - `Evento`
  - `Otro`

### Tabla

Columnas visibles:

- `#`
- `Lead`
- `Cuenta`
- `Oportunidad`
- `Vendedor`
- `Archivos`
- `Estado`
- `Creada`
- `Acciones`

Comportamiento:

- El estado puede mostrar el badge estructural y, si sigue en `created`, un
  badge adicional `Sin analizar`.
- El menu kebab concentra las acciones operativas por fila.

### Acciones por fila

- `Editar`
- `Marcar descalificado` cuando el lead no esta finalizado
- `Eliminar lead` cuando el lead no esta finalizado

## Crear lead

### Objetivo del flujo

- Registrar la evidencia inicial del caso.
- Asociar la fuente del lead.
- Permitir crear el lead con archivos, con texto pegado o con ambos.

### Evidencia soportada

Formatos soportados:

- PDF
- DOCX
- XLSX
- XLS
- CSV
- TXT
- EML
- PNG
- JPG
- JPEG
- MP3
- WAV
- M4A
- MP4

### Secciones del modal

#### 1. Carga de archivos

- Permite adjuntar uno o varios archivos.
- Los archivos se suben de inmediato a una sesion documental temporal del lead.

#### 2. Fuente del lead

- Campo obligatorio para crear el lead.

#### 3. Texto de referencia

- Permite pegar contenido libre.
- El texto se convierte en un archivo `.txt` y se agrega como evidencia.

#### 4. Archivos seleccionados

- Resume la evidencia que quedara vinculada al lead al momento del alta.

### Regla operativa

- Despues de crear el lead, el siguiente paso correcto es abrirlo y ejecutar
  `Analizar documentos para llenar informacion`.

## Modal de detalle del lead

### Encabezado

- Muestra:
  - titulo del lead,
  - fecha de creacion,
  - badge del estado actual,
  - ayuda contextual del flujo de edicion.
- Si el lead esta descalificado y existe razon guardada, el badge se vuelve
  clickable para abrir el modal con la razon.

### Secciones visibles

#### 1. Documentos del lead

- Lista cada archivo con:
  - nombre original,
  - formato detectado o MIME type,
  - tamano,
  - resumen de procesamiento documental.
- Si el usuario puede editar y el lead no esta finalizado, puede:
  - subir mas archivos,
  - eliminar archivos individuales.

#### 2. Seguimiento comercial

- Muestra el ultimo resultado comercial registrado.
- Si el usuario puede operar el lead y este no esta finalizado, aparece el boton
  `Registrar resultado de llamada`.
- El resumen visible puede incluir:
  - situacion,
  - motivo,
  - accion obligatoria,
  - fecha compromiso,
  - persona referida,
  - area objetivo,
  - comentario.
- Debajo del resumen puede abrirse una ayuda inline con los criterios de uso de:
  - situacion del lead,
  - motivo principal,
  - accion obligatoria.
- Esta ayuda inline reutiliza el mismo criterio que usa el modal de captura para
  evitar diferencias entre documentacion, resumen y captura operativa.

#### 3. Sinopsis

- Permite editar:
  - titulo,
  - fuente del lead,
  - notas iniciales,
  - resumen,
  - temas,
  - acciones tomadas,
  - siguientes pasos.
- Incluye el boton `Analizar documentos para llenar informacion` cuando el
  usuario tiene permiso para reanalizar.

#### 4. Cuenta sugerida

- El usuario decide si vincula una cuenta existente, crea una nueva o ignora la sugerencia.
- Si la sugerencia ya genero una cuenta persistida, ciertas rutas de cambio quedan congeladas.

#### 5. Contactos sugeridos

- Cada sugerencia se resuelve individualmente.
- Si no se detectaron contactos, el modulo permite capturar uno manual.

#### 6. Asignacion comercial

- Define el vendedor responsable del lead y, por extension, de la oportunidad a crear o vincular.
- La disponibilidad de usuarios depende de la cuenta resuelta y de la politica comercial.

#### 7. Oportunidades sugeridas

- Cada sugerencia puede vincularse a una oportunidad existente, crear una nueva o ignorarse.
- Si no se detectaron oportunidades, el modulo permite capturar una manual.

### Guardado del lead

- `Guardar lead` persiste:
  - sinopsis editada,
  - resolucion de cuenta,
  - resolucion de contactos,
  - asignacion comercial,
  - resolucion de oportunidades.
- Antes de cerrar la operacion, el sistema valida duplicados y puede mostrar una
  revision adicional dentro del mismo modal.

## Modal de descalificacion

### Regla principal

- La razon es obligatoria.
- Sin razon no debe completarse la descalificacion.

### Resultado esperado

- El lead cambia a `Lead descalificado`.
- La razon queda visible desde el detalle del lead.
- El seguimiento comercial se alinea con un cierre descalificado definitivo.

## Modal de resultado de llamada

### Objetivo

- Registrar el avance comercial sin necesidad de convertir inmediatamente el lead.
- Guiar al vendedor en la clasificacion correcta del resultado de la conversacion.

### Estructura actual de captura

- `Situacion del lead`
  - ya no se captura con select; se elige con tarjetas clicables.
  - cada tarjeta muestra:
    - nombre de la situacion,
    - pista corta de uso,
    - descripcion o criterio de uso,
    - advertencia breve de cuando evitarla.
- `Motivo principal`
  - tambien se elige con tarjetas clicables.
  - solo se muestran los motivos validos para la situacion elegida.
- `Siguiente accion obligatoria`
  - tambien se elige con tarjetas clicables.
  - solo se muestran las acciones compatibles con la situacion y el motivo elegidos.
- `Fecha compromiso` cuando la regla lo exige.
- `Persona referida` cuando la regla lo exige.
- `Area objetivo` cuando la regla lo exige.
- `Comentario del vendedor`.
- `Estado resultante` como vista previa de la regla elegida.

### Regla funcional

- Las opciones visibles se filtran segun las reglas de transicion autorizadas
  por backend para el estado estructural actual.
- La experiencia de captura esta pensada para reducir ambiguedad:
  - primero se entiende la situacion,
  - despues se justifica con el motivo,
  - finalmente se define la accion obligatoria.
- El contenido de las tarjetas se alimenta desde una fuente compartida de guias,
  por lo que el mismo criterio puede reutilizarse en el modal y en la ayuda inline del detalle.

## API relacionada (resumen)

- `GET /api/interactions`
- `GET /api/interactions/:interactionId`
- `POST /api/interactions`
- `PUT /api/interactions/:interactionId`
- `POST /api/interactions/:interactionId/resolve`
- `POST /api/interactions/:interactionId/disqualify`
- `GET /api/interactions/call-outcome-catalogs`
- `POST /api/interactions/:interactionId/call-outcome`
- `GET /api/interactions/resolution-options`
- `POST /api/interactions/document-upload-sessions`
- `POST /api/interactions/document-upload-sessions/:sessionPublicId/files`
- `POST /api/interactions/:interactionId/documents`
- `DELETE /api/interactions/:interactionId/documents/:documentPublicId`
- `POST /api/interactions/:interactionId/analyze/jobs`
- `GET /api/interactions/:interactionId/analyze/jobs/:jobId`

## Consideraciones operativas

- El analisis no es automatico tras crear o subir archivos; debe ejecutarse manualmente.
- Un lead finalizado no debe permitir nuevas acciones destructivas de resolucion.
- La razon de descalificacion y el seguimiento comercial son piezas distintas:
  una cierra el lead y la otra documenta el avance comercial.
- La resolucion del lead debe conservar consistencia con ownership, vendedor y
  oportunidad ya persistidos.
- El modulo depende fuertemente de la evidencia documental: si la evidencia es
  pobre, la calidad de las sugerencias tambien lo sera.
- La guia de seguimiento comercial ya no vive solo en este README: ahora tiene
  una representacion operativa dentro de la UI para ayudar a clasificar mejor el resultado.
- La logica de ayuda del seguimiento comercial esta modularizada en componentes
  reutilizables del frontend para evitar divergencias entre modal, detalle y documentacion.

## Estado actual de la aplicacion (2026-06)

- La subida de documentos esta desacoplada del analisis.
- El detalle del lead ya permite agregar mas archivos y reanalizar en pasos separados.
- La descalificacion exige razon y la muestra desde el detalle.
- El modulo ya soporta seguimiento comercial con resultado de llamada y resumen
  de la ultima gestion registrada.
- El resultado de llamada ya usa tarjetas guiadas para situacion, motivo y accion.
- El detalle del lead ya expone ayuda inline reutilizando la misma guia del modal.