# NewPeople CRM

Monorepo CRM con:

- API: Node.js + Express + MySQL
- Web: React + Vite

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
- Oportunidades con linea de negocio, etapa de venta, vendedor y preventa opcional.
- Contactos con jerarquia (jefe/subordinado) e influencias.
- Auditoria de acciones de usuario.

## Documentacion funcional

- Resumen transversal de reglas del negocio: [readme/logica-negocio.md](./readme/logica-negocio.md)
- Indice de documentacion interna por modulo: [readme/README.md](./readme/README.md)

## Troubleshooting rapido

- Error de conexion DB:
  revisa DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y que MySQL este arriba.
- 401/403 en API:
  valida token JWT vigente y permisos del rol.
- Enlace de set password invalido o vencido:
  revisa `APP_PASSWORD_SETUP_TOKEN_MINUTES`, genera una nueva invitacion y confirma que el token no haya sido reutilizado.
- Frontend no conecta con backend:
  confirma que VITE_API_URL apunte al host/puerto correcto.

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
