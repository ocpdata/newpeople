# NewPeople CRM

Monorepo CRM con:

- API: Node.js + Express + MySQL
- Web: React + Vite

Cambios funcionales destacados del estado actual:

- Cotizaciones ya vive como modulo independiente en la web.
- La vista previa oficial de cotizaciones se genera en backend como PDF inline.
- El flujo de edicion de cotizaciones soporta cambios locales sin guardar, bundles por seccion y versionado completo.
- En cotizaciones, cada item conserva moneda y precio lista originales del proveedor, mientras `Precio de lista` se recalcula en la moneda de la cotizacion segun el tipo de cambio vigente.

## Setup rapido local

### 1. Requisitos

- Node.js 20+
- MySQL 8+

### 2. Instalar dependencias

Desde la raiz del proyecto:

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### 4. Crear base de datos

Ejecuta el script SQL en tu instancia MySQL:

- apps/api/sql/schema.sql

Este script crea tablas, relaciones y datos semilla (incluyendo rol Administrador y catalogos base).

### 5. Levantar API y Web

```bash
npm run dev
```

Servicios esperados:

- API: http://localhost:4000
- Web: http://localhost:5173

Healthcheck rapido:

```bash
curl -sS http://localhost:4000/health
```

## Onboarding funcional (primer uso)

1. Abre la web en http://localhost:5173.
2. Si no existen usuarios, aparece el formulario de primer usuario.
3. Ese usuario inicial se crea con rol Administrador.
4. Inicia sesion y comienza a administrar usuarios, roles/permisos y cuentas.

## Scripts disponibles

En raiz:

- npm run dev: levanta API y Web en paralelo.
- npm run dev:api: levanta solo API.
- npm run dev:web: levanta solo Web.
- npm run seed:demo:reset-db: elimina la base configurada en `apps/api/.env`, vuelve a cargar `apps/api/sql/schema.sql` y luego siembra la demo.
- npm run seed:demo --prefix apps/api -- --dry-run: previsualiza la carga demo sin insertar datos.
- npm run seed:demo --prefix apps/api -- --reset: elimina datos demo previos y vuelve a sembrarlos.
- npm run build:web: genera build de produccion del frontend.
- npm run test:api: ejecuta la suite inicial de integracion del backend.
- npm run test:web:e2e: ejecuta la suite E2E del frontend con Playwright.

En apps/api:

- npm run dev: API con nodemon.
- npm run start: API en modo node.
- npm run seed:demo: genera datos demo manuales con soporte `--dry-run` y `--reset`.
- npm test: ejecuta pruebas de integracion del API.
- npm run test:watch: corre pruebas del API en modo watch.

Documentacion local adicional:

- [apps/api/README.md](./apps/api/README.md)

En apps/web:

- npm run dev: Vite dev server.
- npm run build: build de produccion.
- npm run preview: preview local del build.
- npm run lint: lint frontend.
- npm run test:e2e: suite E2E del flujo web.

## Variables de entorno

### API (apps/api/.env)

Obligatorias para correr local:

- PORT: puerto de la API (ej. 4000).
- JWT_SECRET: secreto para firmar tokens JWT.
- JWT_EXPIRES_IN: expiracion del token (ej. 8h).
- DB_HOST: host de MySQL.
- DB_PORT: puerto de MySQL.
- DB_USER: usuario de MySQL.
- DB_PASSWORD: password de MySQL.
- DB_NAME: base de datos (ej. newpeople_crm).
- DB_POOL_SIZE: tamano del pool de conexiones.

Variables para invitaciones por email:

- APP_INVITE_SETUP_URL: URL frontend para activar cuenta/invitar.
- APP_PASSWORD_SETUP_TOKEN_MINUTES: vigencia en minutos del enlace de activacion o reinicio.
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USER
- SMTP_PASS
- SMTP_FROM

Notas:

- El enlace de set password ahora usa token temporal de un solo uso, no email en query string.
- Si SMTP no esta configurado, el sistema no bloquea endpoints criticos; solo deja la invitacion como pendiente y devuelve el enlace para uso manual.

## Flujo de invitacion y set password

1. Un administrador crea el usuario o dispara `reset-password-invite`.
2. La API genera un token opaco de un solo uso con expiracion configurable.
3. El correo apunta a `APP_INVITE_SETUP_URL?token=...`.
4. La pantalla `/set-password` valida el token, muestra para quien es el acceso y la vigencia del enlace.
5. Al guardar la contrasena, el token se consume, se invalida cualquier token pendiente del usuario y la UI redirige al dashboard.

Endpoints relevantes:

- `GET /api/auth/set-password-context`
- `POST /api/auth/set-password`
- `POST /api/users/:id/reset-password-invite`
- `POST /api/users/test-invite-email`

### API pruebas (apps/api/.env.test)

- Usa una base separada para integracion automatizada.
- Valor recomendado para local: `DB_NAME=newpeople_crm_test`.
- La suite reconstruye esa base antes de correr.

### Web (apps/web/.env)

- VITE_API_URL: URL base de la API (ej. http://localhost:4000).

## Modulos actuales

- Autenticacion JWT.
- Bootstrap de primer administrador.
- RBAC por roles y permisos (deny-by-default).
- Invitaciones y reinicio de contrasena con token temporal de un solo uso.
- Flujo create/request para cuentas, contactos y oportunidades: crear activa el recurso y solicitar lo registra en pendiente.
- Catalogos maestros (paises, monedas, tipos de cuenta, sectores, estados de activacion).
- Usuarios con gestion de estado y auditoria.
- Cuentas con propietarios multiples.
- Proveedores con precios tipificados como `Productos` o `Servicios Propios`.
- Cotizaciones con versiones, workflow propio, bundles por seccion y vista previa PDF backend.
- Cotizaciones con separacion entre precio original del proveedor y precio convertido en moneda de cotizacion.
- Oportunidades con linea de negocio, 7 etapas operativas, 4 estados comerciales, vendedor y preventa opcional.
- Flujo comercial de oportunidades con preguntas por etapa, avance, retroceso, cierre comercial y administración de preguntas desde la web.
- Contactos con jerarquia (jefe/subordinado) e influencias.
- Auditoria de acciones de usuario.

## Flujo comercial de oportunidades

Resumen visible del módulo:

- Toda oportunidad nueva inicia en `Contacto inicial` y `En proceso`.
- `Ganada` ya no es etapa; es un estado comercial y solo puede aplicarse desde `Waiting`.
- `Perdida` y `Anulada` exigen motivo.
- El estado comercial es independiente del estado de activacion del registro.
- La UI permite guardar respuestas por etapa, avanzar, retroceder y cerrar comercialmente.
- La edicion de oportunidades muestra el proceso comercial como stepper clickable: cualquier etapa puede consultarse y solo la actual es editable.
- La pantalla `Preguntas comerciales` permite ajustar el cuestionario por etapa sin tocar código.

Cobertura automatizada:

- `npm run test:api` valida reglas de creación, transición, cierre e histórico en backend.
- `npm run test:web:e2e` cubre el camino visible del flujo comercial y el reflejo del catálogo en oportunidades.

## Documentacion funcional

- Resumen transversal de reglas del negocio: [readme/logica-negocio.md](./readme/logica-negocio.md)
- Indice de documentacion interna por modulo: [readme/README.md](./readme/README.md)
- Modulo de oportunidades y flujo comercial: [readme/oportunidades.md](./readme/oportunidades.md)
- Modulo de cotizaciones: [readme/cotizaciones.md](./readme/cotizaciones.md)
  Politicas de impresion y vista previa PDF incluidas en ese documento.
- Modelo de tipo de cambio y persistencia de precios de cotizaciones documentado en ese mismo archivo.

## Troubleshooting rapido

- Error de conexion DB:
  revisa DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y que MySQL este arriba.
- 401/403 en API:
  valida token JWT vigente y permisos del rol.
- Enlace de set password invalido o vencido:
  revisa `APP_PASSWORD_SETUP_TOKEN_MINUTES`, genera una nueva invitacion y confirma que el token no haya sido reutilizado.
- Frontend no conecta con backend:
  confirma que VITE_API_URL apunte al host/puerto correcto.

## Proveedores y listas de precios

- Cada proveedor puede tener multiples listas de precios visibles desde la UI.
- Cada lista nueva se crea inactiva.
- Cada proveedor puede tener cero o una lista activa al mismo tiempo.
- Cada lista de precios usa una sola moneda compartida por todos sus items.
- Cada item de precio ahora incluye un tipo obligatorio: `Productos` o `Servicios Propios`.
- El tipo se guarda por item, no a nivel proveedor, para permitir mezclar ambos tipos dentro de la misma lista.
- La vista de listas de precios permite crear listas nuevas desde el menu kebab del proveedor, activar o desactivar una lista y filtrar los items por tipo.

## Datos demo manuales

El API incluye un seeder manual para poblar una base local sin ejecutarse automaticamente.

Previsualizar sin insertar:

```bash
npm run seed:demo --prefix apps/api -- --dry-run
```

Sembrar regenerando primero los datos demo previos:

```bash
npm run seed:demo --prefix apps/api -- --reset
```

Recrear por completo la base configurada y luego cargar demo:

```bash
npm run seed:demo:reset-db
```

Parametros soportados:

```bash
npm run seed:demo --prefix apps/api -- \
  --users 20 \
  --accounts 50 \
  --contacts-min 2 \
  --contacts-max 4 \
  --opportunities-per-account 4 \
  --admin-name "Omar Carrillo" \
  --admin-email "ocarrillo@accessq.com.mx" \
  --admin-password "Cruz4das?" \
  --oscar-name "Oscar Rillo" \
  --oscar-email "ocarrillo@electrodata.com.pe" \
  --oscar-password "Cruz4das?"
```

Notas:

- El script usa `apps/api/.env` y siembra la base apuntada por `DB_NAME`.
- `npm run seed:demo:reset-db` si elimina por completo la base apuntada por `DB_NAME`, reimporta el schema y despues ejecuta el seeder demo.
- Marca toda la data demo con `DEMO_SEED_V1` para que `--reset` limpie solo esa carga.
- Si detecta colisiones con usuarios existentes no demo, aborta para no sobrescribir datos reales.
