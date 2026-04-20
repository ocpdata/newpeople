# NewPeople CRM

Monorepo con:

- API: Node.js + Express + MySQL
- Web: React + Vite

## 1) Requisitos

- Node 20+
- MySQL 8+

## 2) Configuracion

1. Copiar variables de entorno:
   - `cp apps/api/.env.example apps/api/.env`
   - `cp apps/web/.env.example apps/web/.env`
2. Crear base de datos y tablas ejecutando `apps/api/sql/schema.sql` en MySQL.

## 3) Ejecutar en desarrollo

Desde la raiz:

```bash
npm run dev
```

Esto levanta:

- API en `http://localhost:4000`
- Web en `http://localhost:5173`

## 4) Flujo inicial

1. Abrir la web.
2. Como no hay usuarios, aparece formulario de primer usuario.
3. Ese usuario se crea con rol `Administrador`.
4. Luego podras gestionar usuarios, roles/permisos y cuentas.

## 5) Modulos implementados

- Autenticacion con JWT.
- Bootstrap del primer administrador.
- RBAC (roles + permisos) con deny-by-default.
- Catalogos: paises, monedas, tipos de cuenta, sectores, estados de activacion.
- Cuentas con propietarios multiples.

## 6) Pendiente para siguiente fase

- Contactos.
- Oportunidades.
- Integracion S3.
- Integracion ChatGPT.

## 7) Como estan los roles en la base de datos

La estructura de roles y su relacion con usuarios/permisos queda asi:

- Tabla `roles`: guarda el catalogo de roles.
  - Campos clave: `id`, `name`, `description`, `is_system`, `is_active`, `created_at`, `updated_at`.
  - `is_system = 1`: rol protegido del sistema.
  - `is_active = 1`: rol habilitado para asignacion y autorizacion.
- Tabla `user_roles`: relacion muchos-a-muchos entre usuarios y roles.
- Tabla `role_permissions`: relacion muchos-a-muchos entre roles y permisos.

Al ejecutar `apps/api/sql/schema.sql`, se siembra este rol inicial:

- `Administrador` con `is_system = 1` e `is_active = 1`.
- Ademas, se le asignan todos los permisos existentes en la tabla `permissions`.

Consultas utiles para verificar estado:

```sql
SELECT id, name, is_system, is_active
FROM roles
ORDER BY name;

SELECT u.id, u.full_name, r.name AS role_name
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
ORDER BY u.full_name, r.name;

SELECT r.name AS role_name, p.code AS permission_code
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
ORDER BY r.name, p.code;
```
