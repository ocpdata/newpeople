# Aceptar Pedido - Especificacion funcional de Procesamiento Post-Aceptacion

## 1. Objetivo

Definir de forma implementable el subflujo de procesamiento operativo para cotizaciones en estado `aceptada`, accesible desde el menu kebab del listado del modulo Aceptar Pedido.

Este documento cubre:

- historias de usuario;
- criterios de aceptacion;
- definicion de datos por etapa;
- reglas operativas y de permisos;
- alcance de primera entrega para desarrollo sin ambiguedades.

## 2. Alcance funcional

### 2.1 Trigger de entrada

- En el listado de cotizaciones del modulo Aceptar Pedido:
  - agregar opcion `Procesar` en el menu kebab;
  - mostrarla solo para cotizaciones cuyo estado sea `aceptada`.

### 2.2 Modal de procesamiento

Al hacer clic en `Procesar`, abrir un modal con el flujo completo:

1. Cotizacion Aceptada
2. Kick Off interno
3. Kick Off externo
4. Orden de compra a proveedores
5. Recepcion de productos
6. Preworks
7. Entrega de productos
8. Facturacion
9. Cobranza
10. Recepcion de factura del proveedor
11. Pago a proveedor

### 2.3 Naturaleza del flujo

- El flujo es visible como una sola cadena funcional.
- No es obligatoriamente secuencial.
- Cada etapa es editable de forma independiente.
- Cada etapa tiene seccion propia.

## 3. Roles y permisos

## 3.1 Permisos funcionales (propuestos)

- `aceptar_pedido.procesamiento.read`
- `aceptar_pedido.procesamiento.update`
- `aceptar_pedido.procesamiento.ia`
- `aceptar_pedido.procesamiento.convocar`

## 3.2 Regla de acceso

- Solo usuarios con acceso al modulo Aceptar Pedido pueden ver la opcion `Procesar`.
- Dentro de ese subconjunto, solo usuarios con permiso `...read` pueden abrir el modal.
- Solo usuarios con `...update` pueden editar etapas.
- Solo usuarios con `...ia` pueden ejecutar generacion de resumen IA.
- Solo usuarios con `...convocar` pueden enviar convocatorias de kick off.

## 4. Historias de usuario

## HU-AP-001 - Ver opcion Procesar para cotizaciones aceptadas

Como usuario del modulo Aceptar Pedido,
quiero ver la opcion `Procesar` en el kebab solo cuando una cotizacion este aceptada,
para iniciar el seguimiento operativo post-aceptacion.

### Criterios de aceptacion

1. Dado una cotizacion en estado `aceptada`, cuando abro el kebab, entonces veo la accion `Procesar`.
2. Dado una cotizacion en estado distinto de `aceptada`, cuando abro el kebab, entonces no veo la accion `Procesar`.
3. La accion `Aceptar` mantiene su comportamiento actual para cotizaciones `ganada`.

## HU-AP-002 - Abrir modal de procesamiento

Como usuario autorizado,
quiero abrir un modal de procesamiento,
para visualizar y administrar el flujo completo post-aceptacion.

### Criterios de aceptacion

1. Al hacer clic en `Procesar`, se abre un modal dedicado.
2. El modal muestra todas las etapas del flujo definido.
3. El modal muestra datos de contexto de la cotizacion: cliente, oportunidad, vendedor, preventa (si existe), version de cotizacion.

## HU-AP-003 - Flujo no secuencial

Como usuario operativo,
quiero poder trabajar etapas sin obligatoriedad de orden,
para adaptarme a la realidad de cada proyecto.

### Criterios de aceptacion

1. Puedo editar cualquier etapa sin requerir que la anterior este completada.
2. El sistema no bloquea guardado por orden de etapa.
3. Cada etapa conserva su estado individual.

## HU-AP-004 - Secciones por etapa

Como usuario operativo,
quiero una seccion especifica por etapa,
para registrar informacion y evidencia de forma ordenada.

### Criterios de aceptacion

1. Existen 11 secciones, una por etapa.
2. Cada seccion contiene al menos estado, responsable, fechas, notas y adjuntos/evidencias.
3. Guardar en una etapa no sobrescribe datos de otras etapas.

## HU-AP-005 - Convocatoria de Kick Off interno

Como usuario autorizado,
quiero convocar el Kick Off interno desde su seccion,
para coordinar alineacion entre vendedor y preventa sobre el alcance del proyecto.

### Criterios de aceptacion

1. En la seccion `Kick Off interno` existe boton `Convocar kick off interno`.
2. Al hacer clic, se abre modal de convocatoria.
3. El modal permite seleccionar invitados usuarios de la aplicacion.
4. El modal permite capturar correos externos (no usuarios).
5. El modal incluye campos: fecha, hora, modalidad (`presencial` o `virtual`), ubicacion (si presencial), link (si virtual).
6. El modal trae mensaje prellenado con: nombre de oportunidad, nombre de cliente, fecha/hora, ubicacion o link y objetivo del kick off interno.
7. La convocatoria se puede guardar como borrador y/o enviar.
8. Al enviar, queda registro de destinatarios, contenido enviado, fecha y emisor.

## HU-AP-006 - Captura de evidencia en Kick Off externo

Como usuario operativo,
quiero registrar insumos del Kick Off externo,
para consolidar acuerdos y riesgos con evidencia.

### Criterios de aceptacion

1. En la seccion `Kick Off externo` puedo:
   - subir archivo de texto; o
   - subir archivo de audio; o
   - escribir minuta/manual de acuerdos.
2. Se permite coexistencia de varias evidencias en la etapa.
3. El sistema identifica tipo de evidencia y registra autor/fecha.

## HU-AP-007 - Generacion de resumen IA en Kick Off externo

Como usuario autorizado,
quiero generar resumen IA a partir de la evidencia del Kick Off externo,
para detectar riesgos, conflictos y temas por aclarar.

### Criterios de aceptacion

1. Existe boton `Generar resumen IA`.
2. El boton solo se habilita cuando hay al menos una evidencia valida (archivo texto, audio o minuta).
3. El resultado IA incluye, como minimo:
   - resumen ejecutivo;
   - puntos de conflicto;
   - riesgos;
   - puntos por aclarar con cliente.
4. La generacion queda trazada con fecha, usuario y version de salida.
5. Se puede regenerar el resumen y conservar historial de versiones.

## HU-AP-008 - Validacion comercial posterior al Kick Off externo

Como usuario operativo,
quiero validar campos clave con vendedor,
para asegurar acuerdos operativos y financieros antes de etapas posteriores.

### Criterios de aceptacion

1. En `Kick Off externo` existen campos de validacion:
   - fecha estimada de facturacion;
   - fecha estimada de entrega de productos;
   - condiciones de cobranza (dias de credito);
   - alcance operativo (quien ejecuta servicios y en que tiempo);
   - otros puntos relevantes.
2. Los campos pueden guardarse de forma parcial.
3. Para marcar etapa `completada`, los campos minimos obligatorios deben estar capturados.

## HU-AP-009 - Trazabilidad y auditoria

Como administrador/operacion,
quiero trazabilidad de cambios por etapa,
para seguimiento, cumplimiento y soporte.

### Criterios de aceptacion

1. Todo cambio de estado o contenido de etapa queda auditado.
2. Se registra usuario, timestamp, campo cambiado y valor anterior/nuevo (cuando aplique).
3. Convocatorias y ejecuciones de IA quedan auditadas.

## 5. Definicion de datos por etapa

## 5.1 Estructura comun de etapa

Cada etapa debe soportar, como minimo:

- `stageCode` (catalogo fijo);
- `status` (`not_started`, `in_progress`, `blocked`, `completed`, `not_applicable`);
- `ownerUserId` (nullable);
- `targetDate` (nullable);
- `completedAt` (nullable);
- `blockedReason` (nullable);
- `notes` (texto largo nullable);
- `attachments[]` (metadata de archivos);
- `lastUpdatedAt`, `lastUpdatedByUserId`.

## 5.2 Catalogo de etapas

- `quotation_accepted`
- `kickoff_internal`
- `kickoff_external`
- `provider_purchase_order`
- `products_reception`
- `preworks`
- `products_delivery`
- `invoicing`
- `collections`
- `provider_invoice_reception`
- `provider_payment`

## 5.3 Datos especificos por etapa

### Etapa: Cotizacion Aceptada

Campos especificos:

- `acceptedAt`
- `acceptedByUserId`
- `acceptedVersionId`
- `initialScopeSummary`

### Etapa: Kick Off interno

Campos especificos:

- `meetingDate`
- `meetingTime`
- `meetingMode` (`presencial`, `virtual`)
- `meetingLocation` (nullable)
- `meetingLink` (nullable)
- `inviteSubject`
- `inviteBodyTemplate`
- `internalAttendeesUserIds[]`
- `externalAttendeesEmails[]`
- `invitationStatus` (`draft`, `sent`)
- `sentAt` (nullable)
- `invitationLog[]` (historial de envios)

Validaciones:

- Si `meetingMode = presencial`, `meetingLocation` obligatorio.
- Si `meetingMode = virtual`, `meetingLink` obligatorio.
- Debe existir al menos un invitado (interno o externo) para enviar.

### Etapa: Kick Off externo

Campos especificos:

- `externalMeetingDate`
- `externalMeetingMode`
- `evidences[]`
  - `evidenceType` (`text_file`, `audio_file`, `manual_note`)
  - `storageRef` (si archivo)
  - `contentText` (si nota manual)
  - `uploadedByUserId`
  - `uploadedAt`
- `aiSummaryCurrent`
  - `summary`
  - `conflictPoints[]`
  - `riskPoints[]`
  - `clarificationPoints[]`
  - `generatedAt`
  - `generatedByUserId`
  - `sourceEvidenceIds[]`
- `aiSummaryHistory[]`
- Validacion comercial:
  - `estimatedInvoicingDate`
  - `estimatedDeliveryDate`
  - `collectionsCreditDays`
  - `operationalScope`
  - `operationalOwner`
  - `operationalTimeline`
  - `relevantAdditionalPoints`

Validaciones:

- `Generar resumen IA` requiere al menos una evidencia.
- `status = completed` requiere validacion comercial minima capturada.

### Etapa: Orden de compra a proveedores

Campos base iniciales:

- `poRequestedAt`
- `poConfirmedAt`
- `providersInvolved[]`
- `purchaseOrderReferences[]`

### Etapa: Recepcion de productos

Campos base iniciales:

- `expectedReceptionDate`
- `actualReceptionDate`
- `receptionStatusDetail`
- `receivedItemsSummary`

### Etapa: Preworks

Campos base iniciales:

- `preworksOwner`
- `preworksStartDate`
- `preworksEndDate`
- `preworksSummary`

### Etapa: Entrega de productos

Campos base iniciales:

- `plannedDeliveryDate`
- `actualDeliveryDate`
- `deliveryEvidenceRefs[]`
- `deliveryObservations`

### Etapa: Facturacion

Campos base iniciales:

- `estimatedInvoiceDate`
- `actualInvoiceDate`
- `invoiceNumber`
- `invoiceAmount`

### Etapa: Cobranza

Campos base iniciales:

- `creditDays`
- `expectedCollectionDate`
- `actualCollectionDate`
- `collectionStatusDetail`

### Etapa: Recepcion de factura del proveedor

Campos base iniciales:

- `providerInvoiceDate`
- `providerInvoiceNumber`
- `providerInvoiceAmount`
- `providerInvoiceReceivedAt`

### Etapa: Pago a proveedor

Campos base iniciales:

- `providerPaymentPlannedDate`
- `providerPaymentActualDate`
- `providerPaymentAmount`
- `providerPaymentReference`

## 6. Reglas de negocio

1. `Procesar` solo aplica para cotizaciones `aceptada`.
2. El flujo es no secuencial: no bloquear edicion por orden de etapas.
3. Cada etapa tiene su propio estado y responsable.
4. Se permite trabajo parcial por etapa.
5. Marcar `completed` en una etapa puede exigir campos minimos (definidos por etapa).
6. En Kick Off externo, la salida IA no reemplaza validacion humana con vendedor.

## 7. Reglas de UX

1. Modal de procesamiento independiente al modal de aceptacion.
2. Barra de flujo siempre visible en la parte superior del modal.
3. Navegacion rapida por etapa (click en etapa).
4. Secciones plegables para evitar sobrecarga visual.
5. Indicadores de estado por etapa con color y etiqueta.
6. Confirmacion antes de cerrar modal si hay cambios sin guardar.

## 8. No funcionales

1. Auditoria obligatoria en cambios de etapa, convocatoria e IA.
2. Adjuntos con validacion de tipo y tamano por politica global de archivos.
3. Procesamiento IA asincrono para soportar audio.
4. Reintentos y mensaje claro cuando IA falle.
5. Todas las fechas almacenadas con timezone consistente de negocio.

## 9. Alcance de primera entrega (MVP)

Incluye:

1. Opcion `Procesar` en kebab para cotizaciones aceptadas.
2. Modal de procesamiento con flujo completo visible.
3. Secciones para las 11 etapas con estructura comun.
4. Implementacion completa de:
   - Kick Off interno (convocatoria);
   - Kick Off externo (evidencias + resumen IA + validacion comercial).
5. Resto de etapas con seccion base (estado, responsable, fechas, notas, adjuntos).

No incluye (en esta entrega):

1. Automatizaciones cross-etapa avanzadas.
2. Reglas contables/fiscales profundas de facturacion/cobranza.
3. Integraciones externas con calendarios/correo transaccional corporativo fuera del flujo base.

## 10. Criterios de aceptacion del entregable completo

1. Desde Aceptar Pedido, `Procesar` aparece solo en cotizaciones aceptadas.
2. Al abrir `Procesar`, se visualiza el flujo completo en modal.
3. Cada etapa tiene seccion propia editable e independiente.
4. Kick Off interno permite convocatoria a usuarios y externos por correo con mensaje prellenado.
5. Kick Off externo permite cargar evidencia o minuta manual y generar resumen IA con riesgos/conflictos/aclaraciones.
6. Kick Off externo obliga validacion comercial minima para completar etapa.
7. Todos los cambios quedan auditados.
8. El flujo funciona sin requerir secuencia estricta.
