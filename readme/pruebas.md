# Pruebas

Esta guia describe como validar la logica de negocio actual del CRM,
priorizando permisos, estados de activacion, invitaciones de acceso, filtros y
regresiones visuales.

## Objetivo

Probar de forma consistente que:

- los permisos efectivos del usuario se respetan en backend y frontend;
- los recursos nacen con el estado correcto segun `create` o `request`;
- los cambios de estado solo ocurren cuando el permiso lo permite;
- los enlaces de set password solo funcionen con token valido, vigente y no reutilizado;
- los filtros de listas muestran exactamente lo seleccionado;
- los cambios recientes de UI no rompen flujos existentes.

## Alcance actual recomendado

Hoy el proyecto ya tiene una base de integracion automatizada del API para
reglas criticas. La estrategia recomendada es:

1. pruebas automatizadas del backend para permisos, estados, invitaciones y auth;
2. prueba manual guiada para regresion funcional y experiencia de usuario;
3. pruebas de API puntuales con `curl` o cliente HTTP cuando se depuren casos concretos.

## Base automatizada disponible

Ya existe una primera base de pruebas de integracion del API con `vitest` y
`supertest`.

Tambien existe una base minima de pruebas E2E del frontend con `playwright`
para los modulos visibles del CRM, con foco fuerte en cotizaciones.

Cobertura inicial:

- login y consulta de `/api/auth/me`
- contexto de `set-password` y configuracion de contrasena con token de un solo uso
- creacion de cuentas con `cuentas.create`
- creacion pendiente de cuentas con `cuentas.request`
- bloqueo de activacion de cuentas sin `cuentas.create`
- creacion pendiente de contactos con `contactos.request`
- bloqueo de activacion de contactos sin `contactos.create`
- creacion pendiente de oportunidades con `oportunidades.request`
- bloqueo de activacion de oportunidades sin `oportunidades.create`
- edicion por `PUT` sin cambio de estado en cuentas, contactos y oportunidades
- bloqueo por `PUT` cuando el cambio implica activacion sin permiso `*.create`
- reevaluacion de permisos en `/api/auth/me` tras actualizar permisos del rol
- bloqueo de reutilizacion de token en `POST /api/auth/set-password`
- retorno de `inviteSetupUrl`, razon SMTP y auditoria cuando falla el envio de invitacion
- ejecucion aislada sobre base `newpeople_crm_test`

Cobertura E2E inicial:

- render del contexto del enlace de set password
- visualizacion de vigencia del token
- guardado exitoso de contrasena con redireccion al dashboard
- manejo visual de enlace invalido o expirado

Cobertura E2E actual ampliada:

- contactos y oportunidades
- proveedores
- cotizaciones: versiones, bundles, resumen, dirty-state, preview PDF y guardado completo

Comando desde raiz:

```bash
npm run test:api
```

Comando E2E desde raiz:

```bash
npm run test:web:e2e
```

Comando directo desde `apps/api`:

```bash
npm test
```

Comando directo desde `apps/web`:

```bash
npm run test:e2e
```

La suite usa una base aislada, crea artefactos temporales y los limpia al
finalizar.

Antes de correr tests, el comando prepara desde cero una base dedicada de
pruebas usando `apps/api/.env.test`.

Archivo relevante:

```bash
apps/api/test/setupTestDb.js
```

## Requisitos previos

- API arriba en `http://localhost:4000`
- Web arriba en `http://localhost:5173`
- Base `newpeople_crm` cargada con `apps/api/sql/schema.sql`
- Al menos un usuario administrador operativo

Healthcheck rapido:

```bash
curl -sS http://localhost:4000/health
```

## Tipos de prueba

### 1. Prueba manual funcional

Usala para validar comportamiento visible y experiencia de usuario.

### 2. Prueba de integracion API

Usala para confirmar reglas de permisos y estados sin depender de la UI.

### 3. Prueba E2E web

Usala para validar el flujo visible de `/set-password`, incluyendo contexto,
errores y redireccion.

### 4. Prueba de regresion corta

Usala despues de tocar permisos, estados, modales, tablas o filtros.

## Suite recomendada por area

### API

- `npm run test:api`
- focalizada de cotizaciones PDF:

```bash
cd apps/api && npm test -- --run test/api.integration.test.js -t "cotizaciones genera un PDF inline desde cambios no guardados"
```

### Web E2E

- `npm run test:web:e2e`
- focalizada de cotizaciones:

```bash
cd apps/web && npm run test:e2e -- quotations.spec.js
```

### Casos de cotizaciones que conviene rerunear

- preview PDF con cambios locales;
- colapso de bundles por seccion;
- inclusion del padre del bundle en preview;
- bundles manuales y de catalogo;
- guardado de version completa conservando jerarquia.

## Matriz minima de roles a probar

Para cuentas, contactos y oportunidades, conviene tener al menos estos
perfiles de prueba:

1. usuario con `*.create` y `*.update`
2. usuario con `*.request` y `*.update`
3. usuario con `*.read` sin `create` ni `request`
4. administrador o rol alto para revisar consistencia general

Ejemplos:

- `cuentas.create`, `cuentas.update`
- `cuentas.request`, `cuentas.update`
- `contactos.create`, `contactos.update`
- `contactos.request`, `contactos.update`
- `oportunidades.create`, `oportunidades.update`
- `oportunidades.request`, `oportunidades.update`

## Checklist manual por modulo

### Usuarios

1. Confirmar encabezado unificado: titulo con icono, subtitulo, boton `+ Crear usuario`.
2. Abrir listado y confirmar pills: `Activos`, `Desactivados`, `Todos`.
3. Validar que cada pill muestre solo lo que indica.
4. Confirmar que la busqueda inline filtra sin recargar la pagina.
5. Validar controles de paginacion: selector 10/50/100, navegacion previo/siguiente.
6. Crear usuario nuevo con roles validos.
7. Editar usuario y confirmar auditoria visible.
8. Activar o desactivar usuario desde acciones por fila.
9. Verificar avatar en lista, topbar y modal de edicion.
10. Enviar reinicio de contrasena y comprobar que el backend devuelva fecha de expiracion si el correo falla.
11. Abrir el enlace de set password y validar que muestre usuario, tipo de acceso y vigencia.
12. Guardar la contrasena y confirmar redireccion automatica al dashboard.

### Roles y permisos

1. Confirmar encabezado unificado: titulo con icono, subtitulo, boton `+ Crear rol`.
2. Confirmar diseno de 3 columnas y scroll independiente por columna.
3. Crear rol.
4. Asignar permisos al rol.
5. Asignar rol a un usuario.
6. Confirmar que la UI del usuario actual se refresque si cambian sus permisos.
7. Verificar que el usuario vea o no vea botones segun permisos efectivos.

### Cuentas

1. Confirmar encabezado unificado: titulo con icono, subtitulo, boton `+ Crear cuenta`.
2. Probar pills: `Activas`, `Pendientes`, `Desactivadas`, `Todas`.
3. Confirmar que cada pill filtre solo ese grupo.
4. Confirmar que la busqueda inline filtra sin recargar la pagina.
5. Validar controles de paginacion: selector 10/50/100, navegacion previo/siguiente.
6. Crear cuenta con usuario `cuentas.create` y validar estado inicial activo.
7. Crear cuenta con usuario `cuentas.request` y validar estado inicial pendiente.
8. Intentar crear cuenta sin `cuentas.create` ni `cuentas.request` y validar rechazo.
9. Cambiar estado de activacion con `cuentas.create` y validar exito.
10. Intentar cambiar estado con `cuentas.update` pero sin `cuentas.create` y validar `403`.
11. Editar datos no relacionados al estado y validar que `cuentas.update` siga funcionando.

### Contactos

1. Confirmar encabezado unificado: titulo con icono, subtitulo, boton `+ Crear contacto`.
2. Probar pills: `Activos`, `Pendientes`, `Desactivados`, `Todas`.
3. Confirmar que la busqueda inline filtra sin recargar la pagina.
4. Validar controles de paginacion: selector 10/50/100, navegacion previo/siguiente.
5. Crear contacto con `contactos.create` y validar estado inicial activo.
6. Crear contacto con `contactos.request` y validar estado inicial pendiente.
7. Intentar activar contacto sin `contactos.create` y validar rechazo.
8. Confirmar que el contacto herede ubicacion de la cuenta al crear.
9. Confirmar que el campo `Jefe` solo liste contactos de la misma cuenta.

### Oportunidades

1. Confirmar encabezado unificado: titulo con icono, subtitulo, boton `+ Crear oportunidad`.
2. Probar pills: `Activas`, `Pendientes`, `Desactivadas`, `Todas`.
3. Confirmar que la busqueda inline filtra sin recargar la pagina.
4. Validar controles de paginacion: selector 10/50/100, navegacion previo/siguiente.
5. Crear oportunidad con `oportunidades.create` y validar estado inicial activo.
6. Crear oportunidad con `oportunidades.request` y validar estado inicial pendiente.
7. Intentar activar oportunidad sin `oportunidades.create` y validar rechazo.
8. Confirmar vendedor, preventa opcional, linea de negocio y etapa.
9. Confirmar formato de importe y fecha de cierre en lista y modal.

### Auditoria

1. Ejecutar acciones de crear, editar y cambiar estado.
2. Revisar que queden reflejadas en auditoria.
3. Validar modulo, entidad, accion y usuario asociado.

### Cotizaciones

1. Abrir el modulo independiente `/quotations`.
2. Confirmar listado general y listado filtrado por oportunidad cuando aplique.
3. Editar la version mayor y cambiar datos del encabezado, notas y resumen.
4. Agregar y eliminar secciones.
5. Agregar filas normales, bundles de catalogo y bundles manuales.
6. Colapsar y expandir bundles por seccion.
7. Validar que la numeracion visible no deje huecos al colapsar un bundle.
8. Abrir `Vista previa` y confirmar que el PDF refleja cambios locales sin guardar.
9. Confirmar que el padre del bundle siempre aparezca en preview y que los componentes dependan del estado expandido/colapsado.
10. Guardar la version completa y validar que el listado refresque la version actual.
11. Crear nueva version y confirmar copia del contenido de la mayor.
12. Validar restricciones de version historica segun permisos.

## Casos criticos de negocio

Estos casos no deberian romperse sin ser detectados:

1. `create` crea activo.
2. `request` crea pendiente.
3. sin `create` ni `request` no se puede crear.
4. `update` no debe equivaler a `create` para cambios de activacion.
5. cambiar permisos de rol debe reflejarse en UI del usuario actual.
6. los filtros por estado deben ser exclusivos por pill.
7. la seleccion del filtro debe persistir por modulo.
8. un token de invitacion o reset no debe poder reutilizarse.

## Pruebas de API sugeridas

Estos endpoints merecen pruebas de integracion:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/auth/set-password-context`
- `POST /api/auth/set-password`
- `POST /api/accounts`
- `PUT /api/accounts/:id`
- `PATCH /api/accounts/:id/status`
- `POST /api/contacts`
- `PUT /api/contacts/:id`
- `PATCH /api/contacts/:id/status`
- `POST /api/opportunities`
- `PUT /api/opportunities/:id`
- `PATCH /api/opportunities/:id/status`
- `PUT /api/roles/:id/permissions`
- `PUT /api/quotation-versions/:versionId/full`
- `POST /api/quotations/render-pdf`
- `POST /api/quotation-versions/:versionId/transition`

## Flujo recomendado con curl

### 1. Login

```bash
curl -sS -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"usuario@example.com","password":"tu_password"}'
```

### 2. Consultar usuario actual

```bash
curl -sS http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer TU_TOKEN"
```

### 3. Intentar un cambio de estado

```bash
curl -sS -X PATCH http://localhost:4000/api/accounts/1/status \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer TU_TOKEN" \
  -d '{"statusCode":"activada"}'
```

### 4. Validar contexto del enlace de password

```bash
curl -sS "http://localhost:4000/api/auth/set-password-context?token=TU_TOKEN"
```

### 5. Consumir el token de password

```bash
curl -sS -X POST http://localhost:4000/api/auth/set-password \
  -H 'Content-Type: application/json' \
  -d '{"token":"TU_TOKEN","password":"NuevaPass123!"}'
```

## Regresion corta antes de cerrar cambios

Si se toca backend de permisos o estados, al menos ejecutar:

1. login con usuario `create`
2. login con usuario `request`
3. crear cuenta, contacto y oportunidad
4. intentar activar sin `*.create`
5. validar filtros y persistencia en listas
6. probar invitacion/reset con token y vigencia visible
7. correr `npm run build:web`

## Siguiente paso recomendado de automatizacion

La mejor inversion tecnica a corto plazo es:

1. montar pruebas de integracion del API;
2. cubrir permisos, cambios de estado y ciclo completo de invitacion/reset;
3. agregar despues pocos flujos E2E de alto valor.

Stack sugerido:

- backend: `vitest` + `supertest`
- frontend E2E: `playwright` (ya montado para `/set-password`)

## Criterio de salida

Un cambio puede considerarse validado si:

- pasa el checklist manual del modulo tocado;
- no rompe permisos ni reglas de activacion;
- el build del frontend sigue pasando;
- la auditoria conserva los eventos esperados cuando aplica.

## Plan de pruebas - Calendario (actividades unificadas)

Esta seccion cubre la especificacion acordada para creacion de actividades de:

- oportunidad
- lead
- suelta

Reglas de negocio cerradas para esta bateria:

1. una actividad suelta puede convertirse luego en lead u oportunidad;
2. una actividad de lead siempre requiere `interactionId`;
3. una actividad suelta requiere `scheduledAt` y `objective`;
4. las actividades sueltas tambien entran al SLA y semaforo.

### Objetivo de pruebas

Validar que el calendario permita crear, listar, editar y convertir actividades
sin romper permisos, semaforo y consistencia de relaciones comerciales.

### Alcance

Incluye:

- pruebas funcionales UI (flujo usuario)
- pruebas de integracion API (contrato y reglas)
- pruebas de permisos por rol
- pruebas de validaciones negativas
- pruebas de conversion de suelta -> lead/oportunidad

No incluye:

- rendimiento/carga
- pruebas de seguridad ofensiva

### Datos base de prueba

Preparar como minimo:

1. 1 vendedor con permisos completos de calendario y comerciales.
2. 1 usuario solo lectura de calendario.
3. 1 oportunidad activa (`opp_A`).
4. 1 lead/interaccion existente (`lead_A`) con `interactionId` valido.
5. 1 cuenta existente (`acc_A`).
6. 1 contacto existente (`con_A`) ligado a `acc_A`.

### Matriz de permisos a verificar

Roles sugeridos:

1. `calendar_manager_full`:
  - `calendario_comercial.read`
  - `calendario_comercial.update`
  - `desarrollo_comercial.update`
  - `oportunidades.read`
  - `oportunidades.update`
  - `interacciones.read`
  - `interacciones.create`
  - `cuentas.create` (o `cuentas.request`)
  - `contactos.create` (o `contactos.request`)
2. `calendar_readonly`:
  - `calendario_comercial.read`
  - sin permisos `*.update`/`*.create`
3. `calendar_partial`:
  - `calendario_comercial.update`
  - sin `interacciones.create`
  - sin `oportunidades.update`

### Casos funcionales (happy path)

#### F-01 Crear actividad de oportunidad

Pasos:

1. Abrir calendario.
2. Crear actividad con tipo `opportunity` vinculada a `opp_A`.
3. Guardar con fecha/hora y objetivo.

Esperado:

- se crea correctamente;
- aparece en `Actividades en calendario`;
- aparece en `Alertas del dia` segun su riesgo.

#### F-02 Crear actividad de lead

Pasos:

1. Crear actividad tipo `lead` con `interactionId = lead_A`.
2. Guardar.

Esperado:

- creacion exitosa;
- item visible con fuente `Lead`;
- al abrir detalle mantiene relacion con `interactionId`.

#### F-03 Crear actividad suelta minima

Pasos:

1. Crear actividad tipo `standalone` sin cuenta ni contacto.
2. Informar solo `scheduledAt` + `objective`.
3. Guardar.

Esperado:

- creacion exitosa;
- activity list muestra fuente `Suelta`;
- entra en semaforo/SLA.

#### F-04 Crear suelta vinculando cuenta/contacto existentes

Pasos:

1. Crear `standalone`.
2. Relacionar `accountId = acc_A` y `contactId = con_A`.

Esperado:

- creacion exitosa;
- se visualiza contexto de cuenta/contacto en tarjeta/modal.

#### F-05 Crear suelta creando cuenta/contacto

Pasos:

1. Crear `standalone`.
2. Seleccionar modo `create_new` para cuenta y contacto.
3. Guardar.

Esperado:

- se crean cuenta/contacto y luego actividad;
- actividad queda ligada a entidades nuevas.

#### F-06 Convertir suelta a lead

Pasos:

1. Seleccionar actividad suelta existente.
2. Convertir a `lead` (link existing o create new lead).

Esperado:

- conversion exitosa;
- actividad cambia a fuente `Lead`;
- queda `interactionId` persistido.

#### F-07 Convertir suelta a oportunidad

Pasos:

1. Seleccionar actividad suelta existente.
2. Convertir a `opportunity` (link existing o create new).

Esperado:

- conversion exitosa;
- actividad cambia a fuente `Oportunidad`;
- queda `opportunityId` persistido.

### Casos funcionales de permisos

#### P-01 Readonly no crea ni edita

Esperado:

- no ve acciones de crear/guardar;
- API responde `403` si intenta forzar.

#### P-02 Sin `interacciones.create` bloquea conversion/create lead con create_new

Esperado:

- `403` y mensaje claro.

#### P-03 Sin `oportunidades.update` bloquea create/convert de oportunidad

Esperado:

- `403` y mensaje claro.

#### P-04 Sin `cuentas.create` o `contactos.create` bloquea create_new correspondiente

Esperado:

- rechazo controlado;
- permite continuar si se cambia a `link_existing` o `none`.

### Casos funcionales de validaciones

#### V-01 Lead sin interactionId

Request/UI: `kind = lead`, sin `interactionId`.

Esperado:

- validacion `400`;
- mensaje explicito: `interactionId es obligatorio para actividad de lead`.

#### V-02 Suelta sin fecha

Request/UI: `kind = standalone`, sin `scheduledAt`.

Esperado: `400`.

#### V-03 Suelta sin objetivo

Request/UI: `kind = standalone`, sin `objective`.

Esperado: `400`.

#### V-04 Objetivo vacio o corto

Esperado: `400`.

#### V-05 Fecha invalida

Esperado: `400`.

#### V-06 Conversion no permitida desde tipo no suelto

Intentar convertir actividad que ya es lead/oportunidad.

Esperado: `409` o `400` segun contrato final, con mensaje claro.

### Casos SLA y semaforo

#### S-01 Suelta vencida aparece en rojo

1. Crear suelta con fecha pasada y estado abierto.
2. Refrescar calendario.

Esperado:

- aparece en alertas priorizadas;
- `trafficLight = red`;
- contador de vencidas incrementa.

#### S-02 Suelta de hoy aparece en ambar

Esperado: `trafficLight = amber` (si no esta vencida).

#### S-03 Suelta futura aparece en verde

Esperado: `trafficLight = green` en condiciones normales.

### Matriz de integracion API

Endpoints del contrato objetivo:

1. `POST /api/commercial-development/calendar/activities`
2. `PATCH /api/commercial-development/calendar/activities/:id`
3. `GET /api/commercial-development/calendar/activities`
4. `POST /api/commercial-development/calendar/activities/:id/convert`

Pruebas minimas por endpoint:

1. create
  - 3 felices: opportunity, lead, standalone
  - 4 negativas: permiso, validacion, relaciones invalidas, fecha invalida
2. update
  - feliz: cambio de fecha/objetivo/status
  - negativa: actualizar con permisos insuficientes
3. list
  - feliz: filtros por `kinds`, `traffic`, `sellerUserId`
  - negativa: query invalida
4. convert
  - feliz: standalone->lead y standalone->opportunity
  - negativa: sin permisos, target invalido, origen no standalone

### Checklist de regresion obligatoria

Tras implementar esta especificacion, ejecutar:

1. flujo actual de editar actividad de oportunidad en calendario;
2. apertura de situacion de lead desde calendario;
3. alertas del dia (filtro por color y contadores);
4. build web;
5. suite API de calendario/comercial;
6. auditoria de eventos `created`, `updated`, `converted`.

### Evidencia recomendada

Guardar por corrida:

- capturas de UI de cada tipo de actividad;
- request/response de API (happy + error);
- ids creados y trazabilidad de conversion;
- snapshot de contadores SLA antes/despues.

## Estado actual de la aplicacion (2026-06)

- Leads/interacciones: la subida de documentos esta desacoplada del analisis; al crear un lead queda en estado sin analizar hasta ejecutar el analisis manual.
- Configuracion > Credito IA: ahora gestiona tambien tarifas IA por modelo (alta manual, cierre de vigencia y sincronizacion con preview/aplicar).
- API IA: expone administracion de tarifas en `/api/admin/ai/pricing-rates`, cierre de vigencia en `/api/admin/ai/pricing-rates/:rateId/close` y sincronizacion en `/api/admin/ai/pricing-rates/sync-openai`.
- Costeo IA: las tarifas se resuelven por vigencia (`valid_from_utc` / `valid_to_utc`) y el esquema semilla contempla modelo principal y de transcripcion configurados.
- Frontend: build web validado en estado actual (`npm run build:web`) tras los cambios de configuracion de tarifas IA.
