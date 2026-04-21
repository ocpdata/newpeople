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
para el flujo de `/set-password`.

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

1. Abrir listado y confirmar pills: `Activos`, `Desactivados`, `Todos`.
2. Validar que cada pill muestre solo lo que indica.
3. Cambiar de pill, recargar la pagina y confirmar persistencia.
4. Crear usuario nuevo con roles validos.
5. Editar usuario y confirmar auditoria visible.
6. Activar o desactivar usuario desde acciones por fila.
7. Verificar avatar en lista, topbar y modal de edicion.
8. Enviar reinicio de contrasena y comprobar que el backend devuelva fecha de expiracion si el correo falla.
9. Abrir el enlace de set password y validar que muestre usuario, tipo de acceso y vigencia.
10. Guardar la contrasena y confirmar redireccion automatica al dashboard.

### Roles y permisos

1. Crear rol.
2. Asignar permisos al rol.
3. Asignar rol a un usuario.
4. Confirmar que la UI del usuario actual se refresque si cambian sus permisos.
5. Verificar que el usuario vea o no vea botones segun permisos efectivos.

### Cuentas

1. Probar pills: `Activas`, `Pendientes`, `Desactivadas`, `Todas`.
2. Confirmar que cada pill filtre solo ese grupo.
3. Confirmar persistencia del filtro tras recarga.
4. Crear cuenta con usuario `cuentas.create` y validar estado inicial activo.
5. Crear cuenta con usuario `cuentas.request` y validar estado inicial pendiente.
6. Intentar crear cuenta sin `cuentas.create` ni `cuentas.request` y validar rechazo.
7. Cambiar estado de activacion con `cuentas.create` y validar exito.
8. Intentar cambiar estado con `cuentas.update` pero sin `cuentas.create` y validar `403`.
9. Editar datos no relacionados al estado y validar que `cuentas.update` siga funcionando.

### Contactos

1. Probar pills: `Activos`, `Pendientes`, `Desactivados`, `Todas`.
2. Confirmar persistencia del filtro tras recarga.
3. Crear contacto con `contactos.create` y validar estado inicial activo.
4. Crear contacto con `contactos.request` y validar estado inicial pendiente.
5. Intentar activar contacto sin `contactos.create` y validar rechazo.
6. Confirmar que el contacto herede ubicacion de la cuenta al crear.
7. Confirmar que el campo `Jefe` solo liste contactos de la misma cuenta.

### Oportunidades

1. Probar pills: `Activas`, `Pendientes`, `Desactivadas`, `Todas`.
2. Confirmar persistencia del filtro tras recarga.
3. Crear oportunidad con `oportunidades.create` y validar estado inicial activo.
4. Crear oportunidad con `oportunidades.request` y validar estado inicial pendiente.
5. Intentar activar oportunidad sin `oportunidades.create` y validar rechazo.
6. Confirmar vendedor, preventa opcional, linea de negocio y etapa.
7. Confirmar formato de importe y fecha de cierre en lista y modal.

### Auditoria

1. Ejecutar acciones de crear, editar y cambiar estado.
2. Revisar que queden reflejadas en auditoria.
3. Validar modulo, entidad, accion y usuario asociado.

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