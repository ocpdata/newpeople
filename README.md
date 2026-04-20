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
- npm run build:web: genera build de produccion del frontend.

En apps/api:

- npm run dev: API con nodemon.
- npm run start: API en modo node.

En apps/web:

- npm run dev: Vite dev server.
- npm run build: build de produccion.
- npm run preview: preview local del build.
- npm run lint: lint frontend.

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
- SMTP_HOST
- SMTP_PORT
- SMTP_SECURE
- SMTP_USER
- SMTP_PASS
- SMTP_FROM

Nota: si SMTP no esta configurado, el sistema no bloquea endpoints criticos; solo omite el envio real de correo.

### Web (apps/web/.env)

- VITE_API_URL: URL base de la API (ej. http://localhost:4000).

## Modulos actuales

- Autenticacion JWT.
- Bootstrap de primer administrador.
- RBAC por roles y permisos (deny-by-default).
- Catalogos maestros (paises, monedas, tipos de cuenta, sectores, estados de activacion).
- Usuarios con gestion de estado y auditoria.
- Cuentas con propietarios multiples.
- Contactos con jerarquia (jefe/subordinado) e influencias.
- Auditoria de acciones de usuario.

## Troubleshooting rapido

- Error de conexion DB:
  revisa DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y que MySQL este arriba.
- 401/403 en API:
  valida token JWT vigente y permisos del rol.
- Frontend no conecta con backend:
  confirma que VITE_API_URL apunte al host/puerto correcto.
