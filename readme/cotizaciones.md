# Cotizaciones

## Alcance

Modulo de cotizaciones asociado a oportunidades activas.

- Una cotizacion nace desde una oportunidad activada.
- Una cotizacion puede tener multiples versiones.
- Solo la version mayor puede cambiar de estado.
- La UI de cotizaciones vive en un modulo principal independiente, aunque sigue asociada a una oportunidad.
- La vista previa oficial del documento se genera como PDF en backend y puede abrirse con cambios locales sin guardar.

## Estado actual de implementacion

El modulo ya no depende de APIs incrementales de secciones/items para la edicion principal.

- La edicion de una version trabaja localmente en la UI y persiste todo el arbol con `PUT /api/quotation-versions/:versionId/full`.
- La vista previa usa `POST /api/quotations/render-pdf` y abre un PDF inline en una pestaña nueva.
- El branding documental se resuelve en backend desde `config.documents.quotation.company`.
- El PDF soporta secciones, resumen, condiciones comerciales, notas y numeracion de pagina.
- La tabla de edicion soporta bundles de catalogo y bundles manuales por seccion.
- Los bundles pueden colapsarse por seccion sin afectar otras tablas.

## Politicas de impresion

Estas politicas definen el comportamiento oficial del documento de cotizacion:

- El documento oficial de vista previa e impresion es el PDF generado por backend.
- La vista previa debe poder generarse con cambios locales sin guardar en la version abierta.
- El PDF debe abrirse inline en una pestaña nueva, no descargarse por defecto.
- El branding del documento se resuelve en backend o configuracion central, no desde datos editables del frontend.
- La fidelidad esperada es funcional: estructura, importes, secciones, resumen, bundles y notas deben ser correctos aunque no exista paridad pixel-perfect con una vista HTML previa.
- La numeracion de pagina debe renderizarse dentro del area imprimible y no debe crear paginas vacias adicionales.

Reglas visibles dentro del preview PDF:

- Cada seccion conserva sus filas y totales sin contaminar otras secciones.
- El padre de un bundle siempre debe aparecer en el preview.
- Si el bundle esta expandido, el preview incluye padre y componentes.
- Si el bundle esta colapsado, el preview incluye solo el padre.
- La numeracion visible de filas en la tabla de edicion debe mantenerse consecutiva cuando hay componentes ocultos por colapso.

## Permisos funcionales

El modulo usa permisos nuevos dentro de `permissions`:

- `cotizaciones.operacion`
- `cotizaciones.revision`
- `cotizaciones.ingreso`
- `cotizaciones.administracion`
- `cotizaciones.externo`

`cotizaciones.administracion` puede modificar cualquier version en cualquier estado y es la unica via de administracion global del modulo.

## Catalogos

El backend persiste y expone estos catalogos:

- `quotation_statuses`
- `quotation_actions`
- `quotation_activation_statuses`
- `quotation_section_inclusion_types`

La matriz `estado + accion + permiso` se persiste en `quotation_action_permissions`.

## Modelo funcional

### Cotizacion

- oportunidad origen
- version mayor actual
- estado de activacion
- auditoria de creacion y modificacion

### Version de cotizacion

- numero de version
- contacto
- nombre de propuesta
- fecha de cotizacion
- introduccion
- estado de cotizacion
- estado de activacion
- auditoria de creacion y modificacion

### Seccion

- titulo
- inclusion por catalogo (`incluida`, `no_incluida`, `opcional`)
- estado de activacion
- orden

### Item

- proveedor
- codigo de producto
- descripcion
- cantidad
- moneda original del proveedor
- precio de lista unitario original del proveedor
- precio de lista unitario convertido a la moneda de la cotizacion
- descuento del fabricante en porcentaje
- costo de importacion en porcentaje
- margen de ganancia en porcentaje
- descuento final en porcentaje
- pertenencia opcional a bundle
- origen de bundle (`price_list_bundle` o `manual_bundle`)

## Modelo de moneda y tipo de cambio

Cada item mantiene dos capas de precio:

- `originalCurrencyCode`: moneda original del proveedor o de la lista de precios origen.
- `originalListPriceUnit`: precio base original en esa moneda.
- `listPriceUnit`: precio convertido a la moneda de la cotizacion.

Reglas operativas:

- `Precio Lista M.O.` en la UI edita `originalListPriceUnit`.
- `Precio de lista` es de solo lectura en la tabla y refleja `listPriceUnit` ya convertido.
- Cambiar la moneda o el tipo de cambio de la version recalcula `listPriceUnit` para todos los items compatibles sin borrar la base original.
- Si la moneda original del item coincide con la moneda de la cotizacion, no hay conversion y ambos valores pueden coincidir.
- La persistencia guarda ambas referencias para que una version clonada o reabierta mantenga la base del proveedor y el valor comercial calculado de la cotizacion.
- Los calculos de costo, venta, resumen y PDF parten del valor convertido de la cotizacion.

## Reglas de negocio

- Solo se crea cotizacion desde una oportunidad con estado de activacion `activada`.
- El contacto de la version debe pertenecer a la misma cuenta de la oportunidad origen.
- `crear_cotizacion` es una accion global sin estado.
- `crear_version` crea una nueva version borrador copiando secciones e items de la version mayor.
- `crear_version` debe copiar tambien `originalCurrencyCode` y `originalListPriceUnit` por item.
- Las transiciones de workflow se resuelven por accion (`aprobar`, `rechazar`, `enviar`, etc.) y actualizan el estado de la version mayor.
- Solo la version mayor entra al workflow; una version historica no mayor queda para consulta o correccion administrativa.
- `Guardar version` persiste el contenido, pero no cambia de estado.
- La vista previa PDF debe reflejar cambios locales sin guardar.
- Cambiar el tipo de cambio en creacion o edicion debe actualizar el valor visible de `Precio de lista` sin alterar `Precio Lista M.O.`.
- En vista previa, el padre de un bundle siempre debe estar presente; si el bundle esta expandido se listan sus componentes y si esta colapsado solo se muestra el padre.
- La numeracion visible de filas en edicion usa el orden visible de la tabla cuando un bundle esta colapsado.

## Bundles en cotizaciones

Existen dos formas de bundle dentro de una seccion:

### Bundle de catalogo

- Nace desde una lista de precios del proveedor.
- El padre es un item `grupo_productos`.
- Los componentes se insertan debajo del padre.
- El precio de venta del padre se calcula por componentes.

### Bundle manual

- Se crea a partir de filas independientes seleccionadas en la tabla.
- El usuario elige una fila padre dentro de la seleccion.
- Luego puede adjuntar componentes adicionales o quitar componentes existentes.
- Las reglas de seleccion impiden mezclar bundles distintos o componentes ya agrupados.

## Edicion y persistencia

La edicion de versiones usa un modelo local completo en frontend:

- cambios en encabezado, resumen, notas y condiciones comerciales;
- cambios en secciones y filas;
- reordenamiento;
- seleccion multiple;
- resaltado de filas;
- copy/paste y duplicado local;
- bundles y colapso por seccion.

Al guardar, la UI manda un payload completo y el backend aplica la mezcla de:

- actualizar filas existentes;
- crear filas nuevas;
- eliminar filas y secciones ausentes;
- conservar jerarquia bundle.

En esa persistencia completa, cada item guarda:

- moneda original del proveedor;
- precio lista original;
- precio lista convertido en la moneda de la cotizacion;
- porcentajes comerciales derivados sobre el valor convertido.

## Matriz actor-estado-accion

| Actor                                         | Estado                                     | Acciones permitidas                                                                                                                                                              | Objetivo operativo                                                                                                   | Siguiente paso esperado                                                     |
| --------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Vendedor (`cotizaciones.operacion`)           | `borrador`                                 | `modificar`, `guardar version`, `solicitar_aprobacion`, `crear_version` si aplica sobre la mayor, `declarar_perdida`, `declarar_anulada`                                         | Preparar la propuesta o cerrarla temprano si deja de tener sentido comercial                                         | Solicitar aprobacion o cerrar como perdida/anulada                          |
| Vendedor (`cotizaciones.operacion`)           | `en_aprobacion`                            | `ver`                                                                                                                                                                            | Esperar decision del aprobador                                                                                       | Esperar aprobacion o rechazo                                                |
| Vendedor (`cotizaciones.operacion`)           | `rechazada`                                | `ver`, `modificar`, `guardar version`, `solicitar_aprobacion`, `crear_version`, `declarar_perdida`, `declarar_anulada`                                                           | Corregir observaciones en la misma version o abrir una nueva version de retrabajo, o cerrar la oportunidad comercial | Reenviar a aprobacion, crear nueva version o cerrar                         |
| Vendedor (`cotizaciones.operacion`)           | `aprobada`                                 | `ver`, `enviar`, `crear_version`, `declarar_ganada`, `declarar_perdida`, `declarar_anulada`                                                                                      | Enviar la propuesta ya aprobada o cerrarla directamente si el resultado comercial ya se conoce                       | Enviar al cliente, crear nueva version o cerrar como ganada/perdida/anulada |
| Vendedor (`cotizaciones.operacion`)           | `enviada`                                  | `ver`, `declarar_ganada`, `declarar_perdida`, `declarar_anulada`, `crear_version` segun politica                                                                                 | Cerrar el resultado comercial con el cliente                                                                         | Ganada, perdida, anulada o nueva version                                    |
| Vendedor (`cotizaciones.operacion`)           | `ganada`                                   | `ver`                                                                                                                                                                            | Consulta historica                                                                                                   | Sin siguiente paso                                                          |
| Vendedor (`cotizaciones.operacion`)           | `perdida`                                  | `ver`                                                                                                                                                                            | Consulta historica                                                                                                   | Sin siguiente paso                                                          |
| Vendedor (`cotizaciones.operacion`)           | `anulada`                                  | `ver`                                                                                                                                                                            | Consulta historica                                                                                                   | Sin siguiente paso                                                          |
| Vendedor (`cotizaciones.operacion`)           | `aceptada`                                 | `ver`                                                                                                                                                                            | Consulta historica o administrativa                                                                                  | Sin siguiente paso                                                          |
| Aprobador (`cotizaciones.revision`)           | `borrador`                                 | `ver`                                                                                                                                                                            | No intervenir en preparacion inicial                                                                                 | Esperar solicitud de aprobacion                                             |
| Aprobador (`cotizaciones.revision`)           | `en_aprobacion`                            | `ver`, `aprobar`, `rechazar`, opcionalmente `modificar` si la politica lo mantiene                                                                                               | Evaluar viabilidad comercial y decidir                                                                               | Aprobar o rechazar                                                          |
| Aprobador (`cotizaciones.revision`)           | `rechazada`                                | `ver`                                                                                                                                                                            | Consulta posterior al rechazo                                                                                        | Esperar retrabajo del vendedor                                              |
| Aprobador (`cotizaciones.revision`)           | `aprobada`                                 | `ver`                                                                                                                                                                            | Consulta y trazabilidad                                                                                              | Esperar envio o cierre comercial                                            |
| Aprobador (`cotizaciones.revision`)           | `enviada`                                  | `ver`                                                                                                                                                                            | Consulta y seguimiento                                                                                               | Esperar cierre comercial                                                    |
| Aprobador (`cotizaciones.revision`)           | `ganada`, `perdida`, `anulada`, `aceptada` | `ver`                                                                                                                                                                            | Consulta historica                                                                                                   | Sin siguiente paso                                                          |
| Aceptador (`cotizaciones.ingreso`)            | `ganada`                                   | `ver`, `aceptar`, `ponerla_borrador`                                                                                                                                             | Decidir la aceptacion final de una propuesta ya ganada                                                               | Aceptar la propuesta o devolverla a borrador                                |
| Administrador (`cotizaciones.administracion`) | Cualquier estado de la version mayor       | Puede ejecutar cualquier accion del flujo sobre la version mayor por excepcion administrativa, incluyendo `crear_version` sobre la mayor y `ponerla_borrador` cuando se necesite | Resolver excepciones, soporte y correcciones administrativas                                                         | Depende del caso                                                            |
| Administrador (`cotizaciones.administracion`) | Version historica no mayor                 | `ver`, `modificar` contenido si se requiere correccion administrativa, sin cambiar estado                                                                                        | Corregir o consultar historico sin alterar el workflow cerrado de una version no mayor                               | Si se necesita nuevo flujo, operar sobre la version mayor                   |
| Cualquier actor no administrador              | Version historica no mayor                 | `ver`                                                                                                                                                                            | Preservar trazabilidad del historico                                                                                 | Crear nueva version sobre la mayor si se necesita cambiar algo              |

## Notas de politica

- Toda nueva version creada con `crear_version` nace en `borrador`.
- El vendedor puede cerrar directamente una cotizacion en `borrador` como `perdida` o `anulada`.
- El vendedor puede crear una nueva version si la propuesta esta `rechazada` o `aprobada`.
- Si la propuesta esta `aprobada`, el vendedor tambien puede declararla `ganada`, `perdida` o `anulada`.
- El `Aceptador` solo ve propuestas en estado `ganada`.
- Si el `Aceptador` acepta la propuesta, la cotizacion pasa a `aceptada`.
- Si el `Aceptador` no la acepta, puede ponerla en `borrador`.
- El administrador puede crear una nueva version, pero siempre sobre la version mayor actual.
- El administrador puede poner en `borrador` la version mayor.
- Una version historica no mayor no debe cambiar de estado; si hace falta reabrir el flujo, se debe operar sobre la mayor.
- `Guardar version` no equivale a transicion de workflow; solo persiste cambios de contenido.

## API

- `GET /api/opportunities/:opportunityId/quotations`
- `POST /api/opportunities/:opportunityId/quotations`
- `GET /api/quotation-opportunities`
- `GET /api/quotation-opportunities/:opportunityId/contacts`
- `GET /api/quotations/:quotationId`
- `POST /api/quotations/:quotationId/versions`
- `GET /api/quotation-versions/:versionId`
- `PUT /api/quotation-versions/:versionId`
- `PUT /api/quotation-versions/:versionId/full`
- `POST /api/quotations/render-pdf`
- `POST /api/quotation-versions/:versionId/transition`
- `GET /api/quotation-versions/:versionId/actions`
- `GET /api/catalogs/quotation-statuses`
- `GET /api/catalogs/quotation-actions`
- `GET /api/catalogs/quotation-activation-statuses`
- `GET /api/catalogs/quotation-section-inclusion-types`
- `GET /api/catalogs/quotation-providers`

## Frontend relevante

- `apps/web/src/QuotationsPage.jsx`
- `apps/web/src/quotations/useQuotationsSection.js`
- `apps/web/src/quotations/QuotationEditorContent.jsx`
- `apps/web/src/quotations/quotationPrintModel.js`

## Backend relevante

- `apps/api/src/routes.quotations.js`
- `apps/api/src/quotationPdf.js`
- `apps/api/src/config.js`

## Cobertura automatizada relevante

Backend:

- generacion inline de PDF desde cambios no guardados;
- persistencia de bundles reales al crear;
- guardado completo con mezcla de crear, editar y eliminar;
- validacion de secciones invalidas con rollback;
- persistencia simultanea de precio original y precio convertido por item.

Frontend E2E:

- edicion de versiones y conservacion de cambios locales;
- vista previa PDF con cambios locales;
- colapso y expansion de bundles por seccion;
- presencia del padre del bundle en preview;
- bundles manuales y de catalogo en edicion;
- jerarquia bundle al guardar la version completa;
- recambio de `Precio de lista` al modificar el tipo de cambio;
- edicion de `Precio Lista M.O.` manteniendo la base original persistida.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
