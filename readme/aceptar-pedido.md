# Aceptación de pedidos

## Objetivo

Formalizar la aceptación administrativa de cotizaciones ganadas y dar seguimiento al cierre documental y al procesamiento operativo del pedido.

## Alcance

- Bandeja de cotizaciones en estado `ganada` y `aceptada`.
- Validacion/consulta de documentos de cierre asociados.
- Accion de aceptacion y notificacion al vendedor.
- Seguimiento posterior a la aceptación por etapas, con documentos y evidencias.
- Generación de resúmenes con IA y envío de convocatorias de kick off, según los permisos asignados.

## Permisos y acceso

- `cotizaciones.administracion`: acceso administrativo al flujo de aceptación de cotizaciones.
- `aceptar_pedido.procesamiento.read`: consultar etapas, estados y documentos del procesamiento posterior a la aceptación.
- `aceptar_pedido.procesamiento.update`: editar la información de las etapas y gestionar documentos y evidencias.
- `aceptar_pedido.procesamiento.ia`: generar resúmenes con IA a partir de evidencias disponibles.
- `aceptar_pedido.procesamiento.convocar`: enviar convocatorias y notificaciones de kick off.

## Ruta de UI

- `/accept-order`

## Especificacion funcional de procesamiento

- Ver documento: `aceptar-pedido-procesamiento-especificacion.md`

## Endpoints principales

- `GET /api/quotations?latestStatusCodes=ganada,aceptada`
- `GET /api/quotation-versions/:versionId/won-documents`
- `POST /api/quotation-versions/:versionId/won-documents`
- `POST /api/quotation-versions/:versionId/transition` (accion `aceptar`)

## Reglas operativas

- Solo cotizaciones en estado ganado/aceptado participan en esta bandeja.
- La aceptación se considera acción administrativa de cierre comercial.
- La trazabilidad documental de orden de compra/cotizaciones proveedor debe quedar guardada.
- Cargar un archivo en la cotizacion no lo clasifica automaticamente como orden
  de compra. Si no hay una orden seleccionada para cierre, el modal de
  Procesamiento operativo muestra los archivos ya cargados en la cotizacion
  (incluidas sus otras versiones) y la oportunidad. Se puede seleccionar uno y
  usar Registrar orden de compra sin subirlo nuevamente.
- Esta seleccion conserva las cotizaciones de proveedor registradas y no cambia
  la aceptacion. No se asigna un archivo automaticamente por nombre o extension.
- En Procesamiento operativo > Documentos de cierre > Cotizaciones de proveedores
  se pueden agregar archivos ya cargados en la cotizacion, incluidas sus otras
  versiones. El selector no incluye archivos exclusivos de la oportunidad ni
  documentos ya registrados como cotizaciones de proveedor u ordenes de compra
  del cierre.
- El selector de ordenes de compra tampoco ofrece documentos registrados como
  cotizaciones de proveedor. Ambos selectores actualizan estas exclusiones al
  agregar o quitar documentos del cierre.
- Agregar cotizacion de proveedor asocia el archivo al cierre sin volver a
  subirlo, reemplazar documentos existentes ni modificar ordenes y sus valores.
  La lista y el contador se actualizan al guardar y se conservan al reabrir.
  Se permite en la version actual ganada, con permiso de actualizacion
  del procesamiento; la consulta y descarga siguen disponibles en solo lectura.
  La operacion se audita y no cambia la aceptacion ni agrega campos monetarios.
- Cada cotizacion de proveedor permite Quitar del cierre, con confirmacion y
  permiso de actualizacion. Solo se elimina la asociacion; el archivo original,
  las otras cotizaciones de proveedor, las ordenes y la aceptacion se conservan.
  Los archivos de cotizacion retirados vuelven a estar disponibles en el selector.
  Usa el mismo formato de tarjeta de las ordenes: archivo y descarga arriba,
  con Quitar del cierre como accion roja en la parte inferior.
- Quitar orden de compra del cierre requiere confirmacion y permiso de
  actualizacion de procesamiento. Elimina la seleccion y su valor/moneda,
  conservando el archivo original, las cotizaciones proveedor y la aceptacion.
  El archivo queda disponible para seleccionarlo nuevamente, sin valor heredado.
- Solo en Procesamiento operativo se pueden registrar varias ordenes de compra
  del cliente para la misma version. Cada archivo se registra una sola vez y
  tiene su propio valor y moneda. Agregar o quitar una orden no modifica las
  demas ni sus valores. Se admiten archivos ya cargados en cotizacion u oportunidad.
- Cada orden se presenta en una tarjeta con archivo y descarga, importe y moneda,
  Guardar valor y Quitar del cierre. Los campos aparecen en dos columnas en
  escritorio y se apilan en movil. Agregar otra orden mantiene separada la
  seleccion de archivos de la edicion de las ordenes registradas.
- El editor de cotizacion y la aceptacion conservan su seleccion individual;
  volver a guardar desde esos flujos no elimina las ordenes adicionales
  registradas en procesamiento.
- En Procesamiento operativo > Documentos de cierre > Orden de compra se captura
  el valor y se elige la moneda del archivo recibido del cliente. El boton
  Guardar valor de orden persiste ambos campos independientemente de las etapas.
- El valor admite cero o importes positivos con hasta dos decimales; no es
  obligatorio para ordenes existentes. La moneda se selecciona del catalogo activo.
- El importe se guarda por documento, origen y version de cotizacion; no se
  comparte entre ordenes diferentes ni con las ordenes emitidas a proveedores.
- Guardar nuevamente los documentos de cierre conserva el importe y moneda
  del mismo documento. Cambiar el documento no hereda el valor anterior.
- La edicion requiere los permisos habituales de actualizacion del procesamiento;
  los usuarios de consulta ven los campos deshabilitados. Los cambios se auditan.

### Bloqueo despues de aceptar

- El estado real Aceptada bloquea el paso Aceptar cotizacion: Aceptar pasa a
  Aceptada deshabilitado, Correo vendedor no esta disponible y los documentos
  de cierre quedan en consulta (sin agregar, quitar ni editar importe/moneda).
  Fecha de aceptacion y notas del paso tambien quedan en solo lectura.
- Consultas, descargas y las demas etapas operativas se mantienen disponibles.
- Mientras se acepta, los controles se bloquean. No se puede aceptar mientras
  haya un cambio documental o envio de correo en curso.
- La API rechaza con HTTP 409 los cambios de cierre y el correo de cotizaciones
  aceptadas, incluso desde las rutas compartidas de seleccion documental.
  Las operaciones y la transicion de aceptacion coordinan un bloqueo transaccional
  de la version actual para evitar cambios simultaneos.
- Antes de aceptar se guardan los datos del paso. La aceptacion conserva la fecha
  original del registro dentro de su transaccion, sin completar aun la etapa.
  Si falla completar la etapa, la cotizacion permanece aceptada y bloqueada.
  Completar registro reintenta solo el registro operativo, sin repetir la
  aceptacion ni editar la fecha. La opcion persiste al reabrir el modal.
- Cotizaciones aceptadas antiguas sin registro operativo pueden completar ese
  registro usando la fecha documental guardada o la fecha disponible de la version.

- `POST /api/quotations/:quotationId/processing/complete-acceptance` requiere
  actualizacion de procesamiento y cotizacion aceptada accesible. Completa
  solamente la etapa de aceptacion usando los datos guardados; es idempotente.
  Las actualizaciones normales de esa etapa se rechazan despues de aceptar.

### API de valores de orden de compra

- `DELETE /api/quotation-versions/:versionId/won-documents/provider-quotes/:source/:documentId`
  quita solo la asociacion de cotizacion de proveedor y registra auditoria.
  Requiere permiso de actualizacion y version actual ganada accesible.

- `POST /api/quotation-versions/:versionId/won-documents/provider-quotes`
  agrega una cotizacion de proveedor desde procesamiento con
  `{ source: "quotation", documentId }`. Requiere permiso de actualizacion,
  version actual ganada y archivo no eliminado vinculado a cualquier
  version de la misma cotizacion. Rechaza duplicados con HTTP 409 y devuelve los
  documentos y selecciones actualizados, incluidas las ordenes existentes.

- `POST /api/quotation-versions/:versionId/won-documents/purchase-orders`
  agrega una orden desde procesamiento con `{ source, documentId }`, sin
  reemplazar las existentes ni sus valores. Requiere permiso de actualizacion,
  version actual ganada y archivo vinculado a la cotizacion u
  oportunidad. Rechaza duplicados con HTTP 409.
- La consulta de documentos de cierre devuelve `savedSelections.purchaseOrders`
  con todas las ordenes; `savedSelections.purchaseOrder` conserva la primera
  para compatibilidad con los flujos de seleccion individual.

- `DELETE /api/quotation-versions/:versionId/won-documents/:source/:documentId`
  quita solo la orden seleccionada del cierre y su valor/moneda. Requiere permiso
  de actualizacion y una version actual ganada dentro del alcance
  autorizado. No elimina el documento original.

- `GET /api/purchase-order-currencies`
- `PATCH /api/quotation-versions/:versionId/won-documents/:source/:documentId/value`
  con `{amount, currencyCode}`. Solo permite la version actual ganada,
  dentro del alcance autorizado y con un documento de orden de compra registrado.

## Estado actual (2026-07-29)

- Modulo activo en UI.
- Integrado al workflow de cotizaciones y documentos de cierre.
