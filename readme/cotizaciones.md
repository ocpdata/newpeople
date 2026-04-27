# Cotizaciones

## Alcance

Modulo de cotizaciones asociado a oportunidades activas.

- Una cotizacion nace desde una oportunidad activada.
- Una cotizacion puede tener multiples versiones.
- Solo la version mayor puede cambiar de estado.
- La UI de cotizaciones vive en un modulo principal independiente, aunque sigue asociada a una oportunidad.

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
- precio de lista unitario
- descuento del fabricante en porcentaje
- costo de importacion en porcentaje
- margen de ganancia en porcentaje

## Reglas de negocio

- Solo se crea cotizacion desde una oportunidad con estado de activacion `activada`.
- El contacto de la version debe pertenecer a la misma cuenta de la oportunidad origen.
- `crear_cotizacion` es una accion global sin estado.
- `crear_version` crea una nueva version borrador copiando secciones e items de la version mayor.
- Las transiciones de workflow se resuelven por accion (`aprobar`, `rechazar`, `enviar`, etc.) y actualizan el estado de la version mayor.

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
- `POST /api/quotation-versions/:versionId/transition`
- `GET /api/quotation-versions/:versionId/actions`
- `GET /api/catalogs/quotation-statuses`
- `GET /api/catalogs/quotation-actions`
- `GET /api/catalogs/quotation-activation-statuses`
- `GET /api/catalogs/quotation-section-inclusion-types`
- `GET /api/catalogs/quotation-providers`
