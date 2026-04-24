# Proveedores

## Alcance

Gestion del modulo de proveedores y de sus listas de precios:

- Alta y edicion de proveedores.
- Activacion y desactivacion de proveedores.
- Creacion y mantenimiento de listas de precios por proveedor.
- Regla de lista activa unica por proveedor.
- Creacion y mantenimiento de productos de proveedor.
- Soporte de tres tipos de item: `producto`, `servicio_propio` y `grupo_productos`.
- Composicion de `Bundle` a partir de componentes activos.
- Auditoria de cambios sobre proveedor, listas y precios.

## Logica de negocio

### Separacion funcional

- El modulo distingue entre maestro de proveedor y submodulo de listas/precios.
- Un usuario puede tener acceso de consulta al proveedor sin poder operar listas de precios.
- Las acciones de proveedor y las de precios se autorizan con permisos distintos.

### Reglas base del proveedor

- El proveedor es la entidad raiz del subdominio de abastecimiento.
- Si el proveedor esta desactivado, no deben activarse listas ni precios relacionados.
- La desactivacion del proveedor se bloquea si existe una lista activa o precios activos.

### Reglas base de listas y precios

- Solo puede existir una lista activa por proveedor.
- Cada lista tiene una sola moneda y un solo tipo de item permitido.
- Todo precio debe operar siempre dentro de una lista explicita; no debe haber operaciones ambiguas sin `listId`.
- Desactivar una lista inactiva todos sus precios para mantener consistencia operativa.

### Reglas de Bundle

- `Bundle` es una composicion calculada; su precio no se captura manualmente.
- Sus componentes deben ser items activos, de proveedores activos y listas activas.
- No se permite autoreferencia, duplicados ni grupos dentro de grupos.
- Si un componente deja de ser valido, el grupo debe desactivarse automaticamente.

## Modelo funcional

El modulo se divide en tres niveles:

1. Proveedor: entidad base con identidad fiscal, ubicacion y estado de activacion.
2. Lista de precios: contenedor de precios para un proveedor, con moneda, tipo de item y estado propio.
3. Precio de proveedor: item individual dentro de una lista.

Cada proveedor puede tener varias listas, pero solo una lista activa al mismo tiempo.
Cada lista trabaja con un solo tipo de item y una sola moneda.

## Permisos involucrados

- `proveedores.read`: consultar proveedores.
- `proveedores.create`: crear proveedores.
- `proveedores.update`: editar proveedores y cambiar su estado.
- `proveedores_precios.read`: consultar listas y precios de proveedor.
- `proveedores_precios.create`: crear listas y precios de proveedor.
- `proveedores_precios.update`: editar listas, precios y estados.

El modulo separa permisos del maestro de proveedor y del submodulo de precios.
Un usuario puede ver proveedores sin necesariamente poder operar listas de precios.

## Reglas de negocio del proveedor

### Alta y edicion

- El nombre es obligatorio.
- El registro del proveedor puede omitirse; si llega vacio se persiste como `null`.
- El pais y el estado de activacion son obligatorios.
- El registro debe ser unico dentro del alcance que define la base de datos.

### Estado del proveedor

- Un proveedor puede activarse o desactivarse.
- No se puede desactivar si tiene al menos una lista de precios activa.
- No se puede desactivar si tiene precios activos.
- Si el proveedor esta desactivado, no se pueden activar listas de precios ni precios.

## Reglas de negocio de listas de precios

### Naturaleza de la lista

Cada lista pertenece a un unico proveedor y guarda:

- nombre
- moneda
- tipo de item permitido
- estado de activacion

### Alta de listas

- El nombre es obligatorio.
- El nombre debe ser unico por proveedor.
- La lista se crea inicialmente inactiva.
- La moneda debe existir en catalogo.
- El tipo debe ser uno de estos valores:
  - `producto`
  - `servicio_propio`
  - `grupo_productos`

### Activacion de listas

- Solo puede haber una lista activa por proveedor.
- No se puede activar una lista si el proveedor esta desactivado.
- Si se intenta activar una segunda lista, el backend rechaza la operacion e informa cual ya esta activa.

### Desactivacion de listas

- Al desactivar una lista, todos sus precios pasan a `inactivo`.
- La lista queda disponible para consulta historica y auditoria.

## Reglas de negocio de precios

### Naturaleza del precio

Cada precio pertenece a una lista explicita. El backend ya no acepta operar precios sin indicar `listId`.

Campos principales:

- codigo
- descripcion
- tipo de item
- precio
- moneda
- estado de activacion

### Codigo y unicidad

- El codigo es obligatorio.
- El codigo debe ser unico dentro de la lista.
- Tambien existe control de unicidad por proveedor para evitar colisiones no deseadas.

### Moneda unica por lista

- Todos los items de una lista deben compartir la misma moneda.
- Si la lista ya tiene moneda efectiva, un nuevo item con otra moneda se rechaza.
- La respuesta informa la moneda obligatoria para corregir el dato.

### Tipo unico por lista

- Una lista solo puede contener un tipo de item.
- Si la lista fue definida para `producto`, no acepta `servicio_propio` ni `grupo_productos`.
- Si la lista fue definida para `grupo_productos`, todos los items deben ser `grupo_productos`.

### Estado del precio

- Un precio puede activarse o desactivarse.
- No se puede activar si el proveedor esta desactivado.
- El estado se usa en filtros, badges y reglas de composicion de grupos.

## Reglas de negocio de Bundle

### Definicion

`Bundle` representa un item compuesto por otros precios existentes.
Su valor no se captura manualmente: se calcula con base en sus componentes.
Internamente el codigo tecnico persistido sigue siendo `grupo_productos`.

### Componentes permitidos

- Debe existir al menos un componente.
- No se permite repetir el mismo componente dentro del grupo.
- Un grupo no puede referenciarse a si mismo.
- Un grupo no puede usar otro `grupo_productos` como componente.
- Los componentes solo pueden ser `producto` o `servicio_propio`.

### Estado requerido de los componentes

Todos los componentes del grupo deben pertenecer a:

- proveedores activados
- listas activas
- items activos

Si alguno no cumple, el grupo no puede crearse o actualizarse.

### Moneda del grupo

- Todos los componentes deben usar la misma moneda de la lista destino.
- Si un componente usa otra moneda, el backend rechaza la operacion.

### Precio calculado

- El precio del grupo se calcula como suma de `precio del componente x cantidad`.
- La cantidad admite valores decimales no negativos.
- El total se recalcula en create y update.
- En el frontend el valor se muestra como solo lectura en revision final.

### Propagacion de estado desde componentes

- Si un componente de un grupo se desactiva, el `Bundle` se desactiva automaticamente.
- Si ese componente vuelve a activarse, el backend revisa el grupo padre.
- El grupo solo se reactiva si todos sus componentes vuelven a estar activos y, ademas, sus proveedores y listas siguen activos.
- Esta propagacion aplica tanto cuando se cambia el estado del item como cuando se actualiza el item completo con estado `activo` o `inactivo`.

## Puntos clave de UX

- La ventana de listas de precios se abre desde el modulo de proveedores.
- El encabezado muestra el proveedor actual, su ID y su estado.
- Hay filtros por estado para listas y para precios.
- La tabla superior administra listas; la inferior administra los precios de la lista seleccionada.
- Las acciones se ejecutan desde menu kebab por fila.
- La creacion de precio usa la accion `Agregar producto`.
- En listas de tipo `Bundle`, el modal permite seleccionar componentes desde productos activos existentes.
- Seleccionar un producto base puede precargar codigo y descripcion, pero ambos siguen siendo editables.

## API relacionada (resumen)

- GET /api/providers
- GET /api/providers/:id
- POST /api/providers
- PUT /api/providers/:id
- PATCH /api/providers/:id/status
- GET /api/providers/:id/price-lists
- POST /api/providers/:id/price-lists
- PATCH /api/providers/:id/price-lists/:listId/status
- GET /api/providers/:id/price-lists/:listId/items
- POST /api/providers/:id/price-lists/:listId/items
- PUT /api/providers/:id/price-lists/:listId/items/:itemId
- PATCH /api/providers/:id/price-lists/:listId/items/:itemId/status
- GET /api/providers/:id/price-list-items
- POST /api/providers/:id/price-list-items
- PUT /api/providers/:id/price-list-items/:itemId
- PATCH /api/providers/:id/price-list-items/:itemId/status

Nota:
Los endpoints `price-list-items` sin `listId` se conservan solo para devolver un mensaje explicito que obliga a usar la version con lista. No deben usarse desde frontend.

## Auditoria

Se auditan eventos de:

- creacion de proveedor
- actualizacion de proveedor
- cambio de estado del proveedor
- creacion de lista de precios
- cambio de estado de la lista
- creacion de precio
- actualizacion de precio
- cambio de estado de precio
- activacion o desactivacion automatica de `Bundle` por cambios en componentes

## Consideraciones operativas

- Mantener sincronizado `apps/api/sql/schema.sql` con la base local; el modulo depende de `provider_price_list_item_components` y del catalogo `product_types`.
- Validar siempre proveedor, lista y item por ids explicitos antes de operar.
- No asumir que una lista activa implica proveedor activo; el backend ya protege esa inconsistencia, pero la UI debe refrescar estados despues de cada accion.
- Si cambia la semantica de `Bundle`, actualizar este archivo y la prueba de integracion del modulo.
