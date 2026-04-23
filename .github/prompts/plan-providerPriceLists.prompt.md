## Plan: Listas de precio por proveedor

Introducir una entidad cabecera `provider_price_lists` para que cada proveedor pueda tener multiples listas de precio, con la regla operativa de cero o una lista activa a la vez. La implementacion debe migrar el modelo actual basado solo en items a un modelo con listas padre, crear una lista legacy inactiva por proveedor con precios existentes, y agregar en la UI del proveedor la opcion de crear listas desde el kebab junto con activacion manual posterior.

**Steps**
1. Extender el esquema en `/Users/ocarrillo/Documents/newpeople/apps/api/sql/schema.sql` con una nueva tabla `provider_price_lists` que incluya al menos `id`, `provider_id`, `name`, `currency_id`, `is_active`, `created_by`, `created_at`, `updated_by`, `updated_at`, mas claves foraneas y una restriccion que soporte la regla de maximo una lista activa por proveedor. Recomendacion: indice unico funcional o columna derivada si MySQL del entorno no permite `UNIQUE` parcial. Este paso bloquea 2, 3, 4, 5 y 6.
2. Agregar migracion idempotente en `/Users/ocarrillo/Documents/newpeople/apps/api/sql/schema.sql` para poblar una lista legacy inactiva por cada proveedor que hoy tenga items directos, mover esos items a la nueva lista mediante `price_list_id`, conservar los datos existentes y luego retirar la dependencia directa `provider_id` en `provider_price_list_items` cuando la migracion quede completada. Este paso depende de 1.
3. Refactorizar el backend en `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.providers.js` para pasar de items por proveedor a listas por proveedor. Esto incluye: listar listas, crear lista nueva desde proveedor, activar una lista desactivando cualquier otra activa, consultar items por lista, crear/editar items dentro de una lista y mover la regla de moneda unica del nivel proveedor al nivel lista. Este paso depende de 1 y 2.
4. Ajustar helpers y pruebas de integracion en `/Users/ocarrillo/Documents/newpeople/apps/api/test/helpers/apiTestUtils.js` y `/Users/ocarrillo/Documents/newpeople/apps/api/test/api.integration.test.js` para crear listas padre explicitas, validar que un proveedor puede tener multiples listas, validar que solo haya cero o una activa y cubrir la accion de crear lista desde proveedor con la legacy inicial inactiva. Este paso depende de 3.
5. Actualizar el seeder demo en `/Users/ocarrillo/Documents/newpeople/apps/api/scripts/seedDemo.js` para crear listas legacy o listas demo reales por proveedor usando la nueva tabla y enlazar los items con `price_list_id`. Debe respetar la regla de cero o una activa por proveedor. Este paso depende de 2 y 3.
6. Rediseñar la UI en `/Users/ocarrillo/Documents/newpeople/apps/web/src/App.jsx` para que el kebab del proveedor incluya `Crear lista de precios`, la vista `Lista de precios` opere sobre listas padre y la seleccion/activacion de listas sea explicita. Como las listas nuevas nacen inactivas y un proveedor puede quedar con cero activas, la pantalla debe mostrar claramente el estado de cada lista y permitir activar una desde la interfaz. Este paso depende de 3.
7. Actualizar la prueba E2E en `/Users/ocarrillo/Documents/newpeople/apps/web/e2e/providers.spec.js` para cubrir el nuevo flujo visible: crear lista desde el kebab del proveedor, confirmar que nace inactiva, activar una lista y verificar que al activarla ninguna otra lista del mismo proveedor queda activa. Este paso depende de 6.
8. Ajustar documentacion en `/Users/ocarrillo/Documents/newpeople/README.md` para reflejar el nuevo concepto de listas multiples por proveedor, la existencia de listas legacy inactivas y la regla de maximo una lista activa. Este paso depende de 3 y 6.

**Relevant files**
- `/Users/ocarrillo/Documents/newpeople/apps/api/sql/schema.sql` — hoy solo existe `provider_price_list_items` con `provider_id`; aqui debe nacer la tabla padre y la migracion legacy.
- `/Users/ocarrillo/Documents/newpeople/apps/api/src/routes.providers.js` — hoy expone items directos por proveedor y el kebab funcional depende de esta capa; aqui debe moverse la logica a listas padre y activacion unica.
- `/Users/ocarrillo/Documents/newpeople/apps/api/test/api.integration.test.js` — contiene la cobertura actual de proveedores y precios; debe validar listas multiples y activacion unica.
- `/Users/ocarrillo/Documents/newpeople/apps/api/test/helpers/apiTestUtils.js` — fixtures directos de proveedores/precios deben pasar a crear listas y items enlazados.
- `/Users/ocarrillo/Documents/newpeople/apps/api/scripts/seedDemo.js` — carga demo de precios por proveedor; debe ajustarse al nuevo modelo con listas.
- `/Users/ocarrillo/Documents/newpeople/apps/web/src/App.jsx` — contiene el kebab de proveedor, el modal `Lista de precios` y los flujos de items; aqui debe incorporarse el concepto de listas padre.
- `/Users/ocarrillo/Documents/newpeople/apps/web/e2e/providers.spec.js` — cubre el flujo visible de proveedor/precios y debe migrarse al nuevo modelo.
- `/Users/ocarrillo/Documents/newpeople/README.md` — documentacion funcional del modulo de proveedores.

**Verification**
1. Ejecutar `npm run test --prefix apps/api -- api.integration.test.js` y confirmar que la suite valida creacion de lista, activacion exclusiva y manejo de listas legacy.
2. Ejecutar `npm run test:e2e --prefix apps/web -- providers.spec.js` y validar el flujo visible de crear lista desde el kebab y activar exactamente una lista.
3. Ejecutar `npm run seed:demo:reset-db` para comprobar que la migracion y el seeder dejan datos consistentes en la base demo.
4. Validar manualmente en la UI que un proveedor con listas legacy inactivas puede quedarse sin lista activa hasta activar una, y que al activar una nueva las demas quedan inactivas.
5. Si se agrega una restriccion unica a nivel SQL para `is_active`, comprobar manualmente con dos activaciones consecutivas que la base bloquea estados invalidos aunque falle la logica de aplicacion.

**Decisions**
- Incluido: crear una entidad padre real para listas de precio; el modelo actual por items directos no soporta el requerimiento.
- Incluido: las listas nuevas se crean inactivas.
- Incluido: un proveedor puede tener cero o una lista activa, no exactamente una.
- Incluido: migrar precios existentes a una lista legacy inactiva por proveedor.
- Incluido: la moneda unica pasa a ser por lista, no por proveedor completo, una vez exista la nueva cabecera.
- Excluido: mantener el modelo actual sin tabla de listas; eso no permite representar varias listas por proveedor ni activar una sola de forma consistente.

**Further Considerations**
1. Conviene definir un nombre estable para la lista legacy, por ejemplo `Legacy importada` o `Lista inicial`, porque ese texto aparecera en UI y pruebas.
2. Si luego quieres cerrar listas en lugar de solo activarlas/desactivarlas, probablemente haga falta un segundo estado de lista (`cerrada`) ademas de `is_active`; en esta peticion solo quedo claro el control de activa/inactiva y creacion desde kebab.