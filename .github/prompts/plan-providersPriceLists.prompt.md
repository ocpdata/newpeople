## Plan: Modulo de Proveedores y Precios

Agregar un nuevo modulo CRUD para proveedores y sus listas de precios, siguiendo los patrones existentes de cuentas/contactos en backend y frontend. La recomendacion es modelar `providers` como entidad maestra y `provider_price_list_items` como filas hijas de una unica lista por proveedor, evitando versionado multiple en esta primera iteracion. Tanto proveedores como filas de precio manejaran estado activo/inactivo y auditoria consistente con el resto del CRM.

**Steps**

1. Fase 1. Modelo de datos y permisos. Extender `/Users/ocarrillo/Documents/newpeople/apps/api/sql/schema.sql` para agregar `provider_activation_statuses`, `provider_price_list_item_statuses`, `providers` y `provider_price_list_items`. Reutilizar catalogos existentes de `countries` y `currencies`. Definir columnas del proveedor con el alcance acordado: `id`, `name`, `registration_code`, `address_line`, `country_id`, `city`, `postal_code`, `state_region`, `activation_status_id`, `created_by`, `created_at`, `updated_by`, `updated_at`. Definir filas de lista de precios con `id`, `provider_id`, `code`, `description`, `price`, `currency_id`, `activation_status_id`, `created_by`, `created_at`, `updated_by`, `updated_at`. Agregar FKs, `UNIQUE` utiles (`provider_id + code`, y si aplica `registration_code` global o por pais segun negocio), y permisos semilla para `proveedores.read/create/update` y `proveedores_precios.read/create/update`.
2. Fase 2. Backend de proveedores. Crear `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.providers.js` reutilizando la estructura de `routes.accounts.js`: `GET /api/providers`, `POST /api/providers`, `GET /api/providers/:id`, `PUT /api/providers/:id`, `PATCH /api/providers/:id/status`. Implementar validacion Zod, resolucion de estados, auditoria con `logAuditEvent`, y consultas que devuelvan joins legibles para pais, estado y auditoria. Montar la ruta en `/Users/ocarrillo/Documents/newpeople/apps/api/src/app.js`.
3. Fase 3. Backend de filas de precios. Crear manejo anidado en el mismo modulo o en `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.providerPriceLists.js`; la recomendacion es anidado bajo proveedor para mantener el modelo claro: `GET /api/providers/:id/price-list-items`, `POST /api/providers/:id/price-list-items`, `PUT /api/providers/:id/price-list-items/:itemId`, `PATCH /api/providers/:id/price-list-items/:itemId/status`. Validar `code`, `description`, `price`, `currencyId`. Bloquear operaciones si el proveedor esta inactivo cuando la regla de negocio lo requiera. Auditar altas, cambios y cambios de estado.
4. Fase 4. Catalogos y cliente API. Extender `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.catalogs.js` solo si hace falta exponer nuevos catalogos de estados; reutilizar los endpoints ya existentes de paises y monedas. En el frontend, ampliar `/Users/ocarrillo/Documents/newpeople/apps/web/src/api.js` solo si hace falta algun helper nuevo de errores o formatos, no por defecto.
5. Fase 5. Pantalla de proveedores. Agregar una nueva pagina en `/Users/ocarrillo/Documents/newpeople/apps/web/src/App.jsx` siguiendo el patron de cuentas/contactos: lista con busqueda, filtros por estado activo/inactivo/todos, paginacion, menu kebab por fila, y modal compacto de crear/editar proveedor. Registrar navegacion lateral y ruta protegida por permisos.
6. Fase 6. Gestion de lista de precios por proveedor. En la misma pagina de proveedores, agregar una accion por fila para abrir un modal secundario o panel dedicado con la lista de precios del proveedor. La recomendacion es un modal de gestion con tabla de items y acciones crear/editar/cambiar estado por fila. Reutilizar el patron visual compacto ya usado en oportunidad/cuenta/contacto para formularios y el patron de lista con acciones para las filas.
7. Fase 7. Integracion de estados y UX. Reflejar badges de estado tanto para proveedor como para cada item de precio. Resetear paginacion al filtrar, cerrar menus al hacer click fuera, y conservar el comportamiento ya usado en cuentas/contactos. Mantener alcance acotado: sin versionado de listas, sin importacion CSV, sin historico de cambios de precio mas alla de auditoria.
8. Fase 8. Verificacion. Validar backend con pruebas de integracion focalizadas o ampliar la suite existente de API para proveedores y filas de precios. Validar frontend con build y, si el tiempo lo permite, una E2E focalizada del flujo visible de crear proveedor, agregar precio, editar precio y cambiar estados.

**Relevant files**

- `/Users/ocarrillo/Documents/newpeople/apps/api/sql/schema.sql` — nuevas tablas, estados y permisos semilla.
- `/Users/ocarrillo/Documents/newpeople/apps/api/src/app.js` — registrar nuevas rutas del modulo.
- `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.providers.js` — CRUD y cambio de estado del proveedor.
- `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.providerPriceLists.js` — CRUD y cambio de estado de filas de precio si se separa del modulo principal.
- `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.catalogs.js` — exponer catalogos adicionales solo si realmente faltan.
- `/Users/ocarrillo/Documents/newpeople/apps/api/src/audit.js` — reutilizar sin cambios la auditoria existente.
- `/Users/ocarrillo/Documents/newpeople/apps/web/src/App.jsx` — nueva pagina, ruta, navegacion, modales y estados locales del modulo.
- `/Users/ocarrillo/Documents/newpeople/apps/web/src/index.css` — estilos de lista, tabla y modales compactos del nuevo modulo.
- `/Users/ocarrillo/Documents/newpeople/apps/web/e2e/contacts-opportunities.spec.js` — referencia de patron E2E; probablemente convendra crear un spec nuevo para proveedores.

**Verification**

1. Ejecutar la recreacion local de base con `npm run seed:demo:reset-db` despues de extender el schema, confirmando que las nuevas tablas, FKs y permisos cargan sin errores.
2. Probar via API el flujo completo: crear proveedor, editar proveedor, cambiar estado, listar proveedores, crear item de precio, editar item, cambiar estado del item, y validar errores por duplicados o proveedor inexistente.
3. Ejecutar `npm run test:api` o una suite ampliada que cubra permisos, validacion Zod, auditoria y reglas de estado del nuevo modulo.
4. Ejecutar `cd /Users/ocarrillo/Documents/newpeople/apps/web && npm run build` para validar la integracion frontend.
5. Ejecutar una E2E nueva o focalizada para abrir el modulo, crear proveedor, agregar filas de precio, editar una fila y verificar badges/estados.

**Decisions**

- Incluido: un proveedor tiene una sola lista de precios compuesta por muchas filas.
- Incluido: proveedores y filas de precio manejan estado activo/inactivo.
- Incluido: reutilizar paises y monedas ya existentes en catalogos.
- Excluido: versionado multiple de listas por proveedor.
- Excluido: importacion masiva, adjuntos, productos/SKU y aprobaciones complejas en esta primera iteracion.
- Excluido: flujo `pendiente` tipo cuentas, salvo que negocio lo pida despues.

**Further Considerations**

1. Recomiendo que `registration_code` del proveedor sea unico por ahora, salvo que realmente exista el caso de mismo registro repetido por pais; si ese caso existe, conviene cambiar la unicidad a `country_id + registration_code`.
2. Recomiendo modelar los precios en `DECIMAL(12,2)` salvo que necesiten mas precision por tipo de proveedor o moneda.
3. Recomiendo resolver la gestion de la lista de precios dentro de un modal dedicado por proveedor, no incrustada en la tabla principal, para mantener la pagina legible y consistente con el patron actual del CRM.
