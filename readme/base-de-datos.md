# Base de datos

Guia tecnica de la base de datos del proyecto NewPeople CRM.

## 1. Motor y convenciones

- Motor: MySQL 8+
- Base de datos: `newpeople_crm`
- Charset/collation: `utf8mb4` / `utf8mb4_0900_ai_ci`
- Script fuente: `apps/api/sql/schema.sql`

La inicializacion es idempotente:

- usa `CREATE TABLE IF NOT EXISTS`
- usa `INSERT ... ON DUPLICATE KEY UPDATE` para catalogos y permisos
- incluye bloques para compatibilidad de columnas/fks en `roles`

## 2. Como crear el esquema

1. Crear la BD y objetos ejecutando el archivo completo:

```bash
mysql -u root -p < apps/api/sql/schema.sql
```

2. Verificar que la base exista:

```sql
SHOW DATABASES LIKE 'newpeople_crm';
USE newpeople_crm;
SHOW TABLES;
```

## 3. Mapa de tablas por dominio

### Seguridad e identidad

- `users`: usuarios del sistema.
- `roles`: catalogo de roles (incluye `is_system`, `is_active`).
- `permissions`: permisos por modulo/accion (`code` unico).
- `user_roles`: asignacion N:M entre usuarios y roles.
- `role_permissions`: asignacion N:M entre roles y permisos.
- `user_audit_log`: bitacora de acciones sobre usuarios.

### Cuentas

- `accounts`: entidad principal de cuentas/clientes.
- `account_owners`: propietarios N:M de una cuenta.

### Catalogos

- `countries`
- `currencies`
- `country_currency`
- `account_types`
- `economic_sectors`
- `account_activation_statuses`

## 4. Relaciones clave

- `users` N:M `roles` via `user_roles`.
- `roles` N:M `permissions` via `role_permissions`.
- `accounts` N:M `users` via `account_owners`.
- `accounts.account_type_id` -> `account_types.id`.
- `accounts.economic_sector_id` -> `economic_sectors.id`.
- `accounts.country_id` -> `countries.id`.
- `accounts.activation_status_id` -> `account_activation_statuses.id`.
- `accounts.created_by` y `accounts.updated_by` -> `users.id`.
- `roles.created_by_user_id` y `roles.updated_by_user_id` -> `users.id`.
- `user_audit_log.performed_by_user_id` y `user_audit_log.affected_user_id` -> `users.id`.

## 5. Reglas e integridad

Unicidad destacada:

- `users.email` unico.
- `roles.name` unico.
- `permissions.code` unico.
- `permissions(module, action)` unico.
- `accounts(country_id, registration_code)` unico.
- codigos de catalogos (`countries.iso2/iso3`, `currencies.code`, etc.) unicos.

Integridad referencial:

- tablas pivote con `ON DELETE CASCADE` en relaciones N:M clave.
- auditoria y referencias historicas con `ON DELETE SET NULL` donde aplica.

Reglas de negocio desde esquema:

- `users.status` es `active|inactive` (ENUM).
- `country_currency` valida rango de fechas (`valid_to >= valid_from` si ambas existen).
- `accounts.registration_code` es obligatorio a nivel DB.

## 6. Datos semilla

El script carga automaticamente:

- Permisos base (`usuarios.*`, `roles.*`, `permissions.read`, `cuentas.*`).
- Rol `Administrador` (`is_system=1`) con todos los permisos.
- Catalogos de tipo de cuenta, sector economico y estados de activacion.
- Paises y monedas frecuentes para LATAM.
- Relacion por defecto pais-moneda en `country_currency`.

## 7. Consultas utiles de operacion

### 7.1 Roles y permisos

```sql
SELECT id, name, is_system, is_active
FROM roles
ORDER BY name;

SELECT r.name AS role_name, p.code AS permission_code
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
ORDER BY r.name, p.code;
```

### 7.2 Usuarios y roles asignados

```sql
SELECT u.id, u.full_name, u.email, u.status, r.name AS role_name
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
ORDER BY u.full_name, r.name;
```

### 7.3 Cuentas y propietarios

```sql
SELECT a.id, a.name, a.registration_code, c.name AS country,
       s.name AS activation_status,
       GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ') AS owners
FROM accounts a
JOIN countries c ON c.id = a.country_id
JOIN account_activation_statuses s ON s.id = a.activation_status_id
LEFT JOIN account_owners ao ON ao.account_id = a.id
LEFT JOIN users u ON u.id = ao.user_id
GROUP BY a.id, a.name, a.registration_code, c.name, s.name
ORDER BY a.name;
```

### 7.4 Auditoria de usuarios

```sql
SELECT l.id, l.action, l.detail, l.created_at,
       actor.full_name AS performed_by,
       target.full_name AS affected_user
FROM user_audit_log l
LEFT JOIN users actor ON actor.id = l.performed_by_user_id
LEFT JOIN users target ON target.id = l.affected_user_id
ORDER BY l.created_at DESC
LIMIT 100;
```

## 8. Mantenimiento y evolucion

- Mantener `schema.sql` como fuente unica de verdad para nuevas instalaciones.
- Si se agregan tablas o columnas, preservar idempotencia en el script.
- Versionar cambios estructurales con migraciones formales si el proyecto entra a entornos productivos con datos vivos.
- Revisar indices adicionales cuando crezca volumen en listados de usuarios/cuentas.

## 9. Relacion con backend

Archivos backend conectados al modelo:

- `apps/api/src/db.js`: pool y helper transaccional.
- `apps/api/src/routes.auth.js`: autenticacion y bootstrap inicial.
- `apps/api/src/routes.users.js`: CRUD usuarios, roles y auditoria.
- `apps/api/src/routes.roles.js`: CRUD de roles y asignacion de permisos.
- `apps/api/src/routes.accounts.js`: CRUD de cuentas y propietarios.
- `apps/api/src/routes.catalogs.js`: lectura de catalogos maestros.

## 10. Diccionario de tablas (campos, tipos y llaves)

### 10.1 users

- PK: `id`
- Unicos: `email`

| Campo         | Tipo                      | Restricciones              |
| ------------- | ------------------------- | -------------------------- |
| id            | BIGINT UNSIGNED           | PK, AUTO_INCREMENT         |
| full_name     | VARCHAR(160)              | NOT NULL                   |
| email         | VARCHAR(190)              | NOT NULL, UNIQUE           |
| description   | TEXT                      | NULL                       |
| registered_at | DATETIME(3)               | NOT NULL                   |
| last_visit_at | DATETIME(3)               | NULL                       |
| avatar_url    | VARCHAR(500)              | NULL                       |
| mobile        | VARCHAR(30)               | NULL                       |
| status        | ENUM('active','inactive') | NOT NULL, DEFAULT 'active' |
| password_hash | VARCHAR(255)              | NOT NULL                   |
| created_at    | DATETIME(3)               | NOT NULL                   |
| updated_at    | DATETIME(3)               | NOT NULL                   |

### 10.2 roles

- PK: `id`
- Unicos: `name`
- FK: `created_by_user_id -> users.id`, `updated_by_user_id -> users.id`

| Campo              | Tipo            | Restricciones       |
| ------------------ | --------------- | ------------------- |
| id                 | BIGINT UNSIGNED | PK, AUTO_INCREMENT  |
| name               | VARCHAR(80)     | NOT NULL, UNIQUE    |
| description        | VARCHAR(255)    | NULL                |
| is_system          | TINYINT(1)      | NOT NULL, DEFAULT 0 |
| is_active          | TINYINT(1)      | NOT NULL, DEFAULT 1 |
| created_by_user_id | BIGINT UNSIGNED | NULL, FK            |
| updated_by_user_id | BIGINT UNSIGNED | NULL, FK            |
| created_at         | DATETIME(3)     | NOT NULL            |
| updated_at         | DATETIME(3)     | NOT NULL            |

### 10.3 permissions

- PK: `id`
- Unicos: `code`, `(module, action)`

| Campo       | Tipo            | Restricciones      |
| ----------- | --------------- | ------------------ |
| id          | BIGINT UNSIGNED | PK, AUTO_INCREMENT |
| code        | VARCHAR(120)    | NOT NULL, UNIQUE   |
| module      | VARCHAR(60)     | NOT NULL           |
| action      | VARCHAR(60)     | NOT NULL           |
| description | VARCHAR(255)    | NULL               |
| created_at  | DATETIME(3)     | NOT NULL           |
| updated_at  | DATETIME(3)     | NOT NULL           |

### 10.4 user_roles

- PK compuesta: `(user_id, role_id)`
- FK: `user_id -> users.id`, `role_id -> roles.id`

| Campo      | Tipo            | Restricciones    |
| ---------- | --------------- | ---------------- |
| user_id    | BIGINT UNSIGNED | PK compuesta, FK |
| role_id    | BIGINT UNSIGNED | PK compuesta, FK |
| created_at | DATETIME(3)     | NOT NULL         |

### 10.5 role_permissions

- PK compuesta: `(role_id, permission_id)`
- FK: `role_id -> roles.id`, `permission_id -> permissions.id`

| Campo         | Tipo            | Restricciones    |
| ------------- | --------------- | ---------------- |
| role_id       | BIGINT UNSIGNED | PK compuesta, FK |
| permission_id | BIGINT UNSIGNED | PK compuesta, FK |
| created_at    | DATETIME(3)     | NOT NULL         |

### 10.6 countries

- PK: `id`
- Unicos: `iso2`, `iso3`

| Campo      | Tipo            | Restricciones       |
| ---------- | --------------- | ------------------- |
| id         | BIGINT UNSIGNED | PK, AUTO_INCREMENT  |
| iso2       | CHAR(2)         | NOT NULL, UNIQUE    |
| iso3       | CHAR(3)         | NOT NULL, UNIQUE    |
| name       | VARCHAR(120)    | NOT NULL            |
| is_active  | TINYINT(1)      | NOT NULL, DEFAULT 1 |
| created_at | DATETIME(3)     | NOT NULL            |
| updated_at | DATETIME(3)     | NOT NULL            |

### 10.7 currencies

- PK: `id`
- Unicos: `code`

| Campo      | Tipo             | Restricciones       |
| ---------- | ---------------- | ------------------- |
| id         | BIGINT UNSIGNED  | PK, AUTO_INCREMENT  |
| code       | CHAR(3)          | NOT NULL, UNIQUE    |
| name       | VARCHAR(80)      | NOT NULL            |
| symbol     | VARCHAR(8)       | NULL                |
| decimals   | TINYINT UNSIGNED | NOT NULL, DEFAULT 2 |
| is_active  | TINYINT(1)       | NOT NULL, DEFAULT 1 |
| created_at | DATETIME(3)      | NOT NULL            |
| updated_at | DATETIME(3)      | NOT NULL            |

### 10.8 country_currency

- PK compuesta: `(country_id, currency_id)`
- FK: `country_id -> countries.id`, `currency_id -> currencies.id`
- Check: `valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from`

| Campo       | Tipo            | Restricciones       |
| ----------- | --------------- | ------------------- |
| country_id  | BIGINT UNSIGNED | PK compuesta, FK    |
| currency_id | BIGINT UNSIGNED | PK compuesta, FK    |
| is_default  | TINYINT(1)      | NOT NULL, DEFAULT 1 |
| valid_from  | DATE            | NULL                |
| valid_to    | DATE            | NULL                |
| created_at  | DATETIME(3)     | NOT NULL            |

### 10.9 account_types

- PK: `id`
- Unicos: `code`, `name`

| Campo     | Tipo            | Restricciones       |
| --------- | --------------- | ------------------- |
| id        | BIGINT UNSIGNED | PK, AUTO_INCREMENT  |
| code      | VARCHAR(40)     | NOT NULL, UNIQUE    |
| name      | VARCHAR(80)     | NOT NULL, UNIQUE    |
| is_active | TINYINT(1)      | NOT NULL, DEFAULT 1 |

### 10.10 economic_sectors

- PK: `id`
- Unicos: `code`, `name`

| Campo     | Tipo            | Restricciones       |
| --------- | --------------- | ------------------- |
| id        | BIGINT UNSIGNED | PK, AUTO_INCREMENT  |
| code      | VARCHAR(40)     | NOT NULL, UNIQUE    |
| name      | VARCHAR(100)    | NOT NULL, UNIQUE    |
| is_active | TINYINT(1)      | NOT NULL, DEFAULT 1 |

### 10.11 account_activation_statuses

- PK: `id`
- Unicos: `code`, `name`

| Campo     | Tipo            | Restricciones       |
| --------- | --------------- | ------------------- |
| id        | BIGINT UNSIGNED | PK, AUTO_INCREMENT  |
| code      | VARCHAR(40)     | NOT NULL, UNIQUE    |
| name      | VARCHAR(80)     | NOT NULL, UNIQUE    |
| is_active | TINYINT(1)      | NOT NULL, DEFAULT 1 |

### 10.12 accounts

- PK: `id`
- Unicos: `(country_id, registration_code)`
- FK:
  - `account_type_id -> account_types.id`
  - `economic_sector_id -> economic_sectors.id`
  - `country_id -> countries.id`
  - `activation_status_id -> account_activation_statuses.id`
  - `created_by -> users.id`
  - `updated_by -> users.id`

| Campo                | Tipo            | Restricciones      |
| -------------------- | --------------- | ------------------ |
| id                   | BIGINT UNSIGNED | PK, AUTO_INCREMENT |
| name                 | VARCHAR(180)    | NOT NULL           |
| account_type_id      | BIGINT UNSIGNED | NOT NULL, FK       |
| registration_code    | VARCHAR(80)     | NOT NULL           |
| phone                | VARCHAR(40)     | NULL               |
| economic_sector_id   | BIGINT UNSIGNED | NOT NULL, FK       |
| website              | VARCHAR(300)    | NULL               |
| city                 | VARCHAR(120)    | NULL               |
| state_region         | VARCHAR(120)    | NULL               |
| country_id           | BIGINT UNSIGNED | NOT NULL, FK       |
| description          | TEXT            | NULL               |
| address_line         | VARCHAR(255)    | NULL               |
| postal_code          | VARCHAR(20)     | NULL               |
| activation_status_id | BIGINT UNSIGNED | NOT NULL, FK       |
| created_by           | BIGINT UNSIGNED | NOT NULL, FK       |
| created_at           | DATETIME(3)     | NOT NULL           |
| updated_by           | BIGINT UNSIGNED | NOT NULL, FK       |
| updated_at           | DATETIME(3)     | NOT NULL           |

### 10.13 account_owners

- PK compuesta: `(account_id, user_id)`
- FK: `account_id -> accounts.id`, `user_id -> users.id`, `assigned_by -> users.id`

| Campo       | Tipo            | Restricciones    |
| ----------- | --------------- | ---------------- |
| account_id  | BIGINT UNSIGNED | PK compuesta, FK |
| user_id     | BIGINT UNSIGNED | PK compuesta, FK |
| assigned_at | DATETIME(3)     | NOT NULL         |
| assigned_by | BIGINT UNSIGNED | NOT NULL, FK     |

### 10.14 user_audit_log

- PK: `id`
- FK: `performed_by_user_id -> users.id`, `affected_user_id -> users.id`

| Campo                | Tipo            | Restricciones      |
| -------------------- | --------------- | ------------------ |
| id                   | BIGINT UNSIGNED | PK, AUTO_INCREMENT |
| action               | VARCHAR(60)     | NOT NULL           |
| performed_by_user_id | BIGINT UNSIGNED | NULL, FK           |
| affected_user_id     | BIGINT UNSIGNED | NULL, FK           |
| detail               | TEXT            | NULL               |
| created_at           | DATETIME(3)     | NOT NULL           |
