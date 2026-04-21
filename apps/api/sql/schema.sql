CREATE DATABASE IF NOT EXISTS newpeople_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE newpeople_crm;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL,
  description TEXT NULL,
  registered_at DATETIME(3) NOT NULL,
  last_visit_at DATETIME(3) NULL,
  avatar_url LONGTEXT NULL,
  mobile VARCHAR(30) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  password_hash VARCHAR(255) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_users_email UNIQUE (email)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN created_by BIGINT UNSIGNED NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'created_by'
);
PREPARE s_users_col_1 FROM @stmt;
EXECUTE s_users_col_1;
DEALLOCATE PREPARE s_users_col_1;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN updated_by BIGINT UNSIGNED NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'updated_by'
);
PREPARE s_users_col_2 FROM @stmt;
EXECUTE s_users_col_2;
DEALLOCATE PREPARE s_users_col_2;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users MODIFY COLUMN avatar_url LONGTEXT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'avatar_url'
    AND LOWER(DATA_TYPE) = 'longtext'
);
PREPARE s_users_col_3 FROM @stmt;
EXECUTE s_users_col_3;
DEALLOCATE PREPARE s_users_col_3;

UPDATE users
SET created_by = COALESCE(created_by, id),
    updated_by = COALESCE(updated_by, created_by, id)
WHERE created_by IS NULL OR updated_by IS NULL;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'fk_users_created_by'
);
PREPARE s_users_fk_1 FROM @stmt;
EXECUTE s_users_fk_1;
DEALLOCATE PREPARE s_users_fk_1;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'fk_users_updated_by'
);
PREPARE s_users_fk_2 FROM @stmt;
EXECUTE s_users_fk_2;
DEALLOCATE PREPARE s_users_fk_2;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_roles_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_roles_updated_by_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_roles_name UNIQUE (name)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE roles ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'created_by_user_id'
);
PREPARE s_roles_col_1 FROM @stmt;
EXECUTE s_roles_col_1;
DEALLOCATE PREPARE s_roles_col_1;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE roles ADD COLUMN updated_by_user_id BIGINT UNSIGNED NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND COLUMN_NAME = 'updated_by_user_id'
);
PREPARE s_roles_col_2 FROM @stmt;
EXECUTE s_roles_col_2;
DEALLOCATE PREPARE s_roles_col_2;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE roles ADD CONSTRAINT fk_roles_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND CONSTRAINT_NAME = 'fk_roles_created_by_user'
);
PREPARE s_roles_fk_1 FROM @stmt;
EXECUTE s_roles_fk_1;
DEALLOCATE PREPARE s_roles_fk_1;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE roles ADD CONSTRAINT fk_roles_updated_by_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'roles'
    AND CONSTRAINT_NAME = 'fk_roles_updated_by_user'
);
PREPARE s_roles_fk_2 FROM @stmt;
EXECUTE s_roles_fk_2;
DEALLOCATE PREPARE s_roles_fk_2;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(120) NOT NULL,
  module VARCHAR(60) NOT NULL,
  action VARCHAR(60) NOT NULL,
  description VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT uq_permissions_code UNIQUE (code),
  CONSTRAINT uq_permissions_module_action UNIQUE (module, action)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_setup_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  purpose ENUM('invite', 'reset') NOT NULL DEFAULT 'invite',
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_password_setup_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_password_setup_tokens_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_password_setup_tokens_hash UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS countries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  iso2 CHAR(2) NOT NULL,
  iso3 CHAR(3) NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT uq_countries_iso2 UNIQUE (iso2),
  CONSTRAINT uq_countries_iso3 UNIQUE (iso3)
);

CREATE TABLE IF NOT EXISTS currencies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code CHAR(3) NOT NULL,
  name VARCHAR(80) NOT NULL,
  symbol VARCHAR(8) NULL,
  decimals TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT uq_currencies_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS country_currency (
  country_id BIGINT UNSIGNED NOT NULL,
  currency_id BIGINT UNSIGNED NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 1,
  valid_from DATE NULL,
  valid_to DATE NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (country_id, currency_id),
  CONSTRAINT fk_country_currency_country FOREIGN KEY (country_id) REFERENCES countries(id),
  CONSTRAINT fk_country_currency_currency FOREIGN KEY (currency_id) REFERENCES currencies(id),
  CONSTRAINT ck_country_currency_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS account_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_account_types_code UNIQUE (code),
  CONSTRAINT uq_account_types_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS economic_sectors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_economic_sectors_code UNIQUE (code),
  CONSTRAINT uq_economic_sectors_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS account_activation_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_account_activation_statuses_code UNIQUE (code),
  CONSTRAINT uq_account_activation_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS contact_purchase_participations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_contact_purchase_participations_code UNIQUE (code),
  CONSTRAINT uq_contact_purchase_participations_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS contact_relationship_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_contact_relationship_types_code UNIQUE (code),
  CONSTRAINT uq_contact_relationship_types_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS contact_employment_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_contact_employment_statuses_code UNIQUE (code),
  CONSTRAINT uq_contact_employment_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS contact_activation_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_contact_activation_statuses_code UNIQUE (code),
  CONSTRAINT uq_contact_activation_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS opportunity_business_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_opportunity_business_lines_code UNIQUE (code),
  CONSTRAINT uq_opportunity_business_lines_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS opportunity_sales_stages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  stage_order TINYINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_opportunity_sales_stages_code UNIQUE (code),
  CONSTRAINT uq_opportunity_sales_stages_name UNIQUE (name),
  CONSTRAINT uq_opportunity_sales_stages_order UNIQUE (stage_order)
);

CREATE TABLE IF NOT EXISTS opportunity_activation_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_opportunity_activation_statuses_code UNIQUE (code),
  CONSTRAINT uq_opportunity_activation_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  account_type_id BIGINT UNSIGNED NOT NULL,
  registration_code VARCHAR(80) NOT NULL,
  phone VARCHAR(40) NULL,
  economic_sector_id BIGINT UNSIGNED NOT NULL,
  website VARCHAR(300) NULL,
  city VARCHAR(120) NULL,
  state_region VARCHAR(120) NULL,
  country_id BIGINT UNSIGNED NOT NULL,
  description TEXT NULL,
  address_line VARCHAR(255) NULL,
  postal_code VARCHAR(20) NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_accounts_type FOREIGN KEY (account_type_id) REFERENCES account_types(id),
  CONSTRAINT fk_accounts_sector FOREIGN KEY (economic_sector_id) REFERENCES economic_sectors(id),
  CONSTRAINT fk_accounts_country FOREIGN KEY (country_id) REFERENCES countries(id),
  CONSTRAINT fk_accounts_activation_status FOREIGN KEY (activation_status_id) REFERENCES account_activation_statuses(id),
  CONSTRAINT fk_accounts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_accounts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT uq_accounts_country_registration UNIQUE (country_id, registration_code)
);

CREATE TABLE IF NOT EXISTS account_owners (
  account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  assigned_at DATETIME(3) NOT NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (account_id, user_id),
  CONSTRAINT fk_account_owners_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_account_owners_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_account_owners_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  position_title VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  phone_extension VARCHAR(20) NULL,
  mobile VARCHAR(30) NULL,
  email VARCHAR(190) NULL,
  department VARCHAR(120) NULL,
  country_id BIGINT UNSIGNED NULL,
  state_region VARCHAR(120) NULL,
  city VARCHAR(120) NULL,
  address_line VARCHAR(255) NULL,
  postal_code VARCHAR(20) NULL,
  purchase_participation_id BIGINT UNSIGNED NOT NULL,
  relationship_type_id BIGINT UNSIGNED NOT NULL,
  employment_status_id BIGINT UNSIGNED NOT NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  manager_contact_id BIGINT UNSIGNED NULL,
  influences_contact_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_contacts_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_contacts_country FOREIGN KEY (country_id) REFERENCES countries(id),
  CONSTRAINT fk_contacts_purchase_participation FOREIGN KEY (purchase_participation_id) REFERENCES contact_purchase_participations(id),
  CONSTRAINT fk_contacts_relationship_type FOREIGN KEY (relationship_type_id) REFERENCES contact_relationship_types(id),
  CONSTRAINT fk_contacts_employment_status FOREIGN KEY (employment_status_id) REFERENCES contact_employment_statuses(id),
  CONSTRAINT fk_contacts_activation_status FOREIGN KEY (activation_status_id) REFERENCES contact_activation_statuses(id),
  CONSTRAINT fk_contacts_manager_contact FOREIGN KEY (manager_contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  CONSTRAINT fk_contacts_influences_contact FOREIGN KEY (influences_contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  CONSTRAINT fk_contacts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  amount_usd DECIMAL(15, 2) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  close_date DATE NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  sales_stage_id BIGINT UNSIGNED NOT NULL,
  business_line_id BIGINT UNSIGNED NOT NULL,
  seller_user_id BIGINT UNSIGNED NULL,
  presales_user_id BIGINT UNSIGNED NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_opportunities_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT fk_opportunities_contact FOREIGN KEY (contact_id) REFERENCES contacts(id),
  CONSTRAINT fk_opportunities_sales_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id),
  CONSTRAINT fk_opportunities_business_line FOREIGN KEY (business_line_id) REFERENCES opportunity_business_lines(id),
  CONSTRAINT fk_opportunities_seller_user FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_opportunities_presales_user FOREIGN KEY (presales_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_opportunities_activation_status FOREIGN KEY (activation_status_id) REFERENCES opportunity_activation_statuses(id),
  CONSTRAINT fk_opportunities_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_opportunities_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE opportunities ADD COLUMN seller_user_id BIGINT UNSIGNED NULL AFTER business_line_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND COLUMN_NAME = 'seller_user_id'
);
PREPARE s_opportunities_seller_col FROM @stmt;
EXECUTE s_opportunities_seller_col;
DEALLOCATE PREPARE s_opportunities_seller_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE opportunities ADD CONSTRAINT fk_opportunities_seller_user FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND CONSTRAINT_NAME = 'fk_opportunities_seller_user'
);
PREPARE s_opportunities_seller_fk FROM @stmt;
EXECUTE s_opportunities_seller_fk;
DEALLOCATE PREPARE s_opportunities_seller_fk;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 1,
    'UPDATE opportunities o LEFT JOIN (SELECT opportunity_id, MIN(user_id) AS seller_user_id FROM opportunity_owners GROUP BY opportunity_id) oo ON oo.opportunity_id = o.id SET o.seller_user_id = COALESCE(o.seller_user_id, oo.seller_user_id) WHERE oo.seller_user_id IS NOT NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunity_owners'
);
PREPARE s_opportunities_migrate_seller FROM @stmt;
EXECUTE s_opportunities_migrate_seller;
DEALLOCATE PREPARE s_opportunities_migrate_seller;

DROP TABLE IF EXISTS opportunity_owners;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 1,
    'ALTER TABLE opportunities DROP INDEX uq_opportunities_code',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND INDEX_NAME = 'uq_opportunities_code'
);
PREPARE s_opportunities_drop_idx FROM @stmt;
EXECUTE s_opportunities_drop_idx;
DEALLOCATE PREPARE s_opportunities_drop_idx;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 1,
    'ALTER TABLE opportunities DROP COLUMN opportunity_code',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND COLUMN_NAME = 'opportunity_code'
);
PREPARE s_opportunities_drop_col FROM @stmt;
EXECUTE s_opportunities_drop_col;
DEALLOCATE PREPARE s_opportunities_drop_col;

CREATE TABLE IF NOT EXISTS user_audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(60) NOT NULL,
  performed_by_user_id BIGINT UNSIGNED NULL,
  affected_user_id BIGINT UNSIGNED NULL,
  detail TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_ual_performed_by FOREIGN KEY (performed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ual_affected_user FOREIGN KEY (affected_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  module VARCHAR(60) NOT NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  status ENUM('success', 'error') NOT NULL DEFAULT 'success',
  detail VARCHAR(255) NULL,
  changed_fields JSON NULL,
  performed_by_user_id BIGINT UNSIGNED NULL,
  performed_by_name VARCHAR(160) NULL,
  performed_by_email VARCHAR(190) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_audit_performed_by_user FOREIGN KEY (performed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created_at (created_at),
  INDEX idx_audit_module_created_at (module, created_at),
  INDEX idx_audit_actor_created_at (performed_by_user_id, created_at),
  INDEX idx_audit_entity_created_at (entity_type, entity_id, created_at)
);

INSERT INTO permissions (code, module, action, description, created_at, updated_at)
VALUES
  ('usuarios.read', 'usuarios', 'read', 'Ver usuarios', NOW(3), NOW(3)),
  ('usuarios.create', 'usuarios', 'create', 'Crear usuarios', NOW(3), NOW(3)),
  ('usuarios.update', 'usuarios', 'update', 'Actualizar usuarios', NOW(3), NOW(3)),
  ('roles.read', 'roles', 'read', 'Ver roles', NOW(3), NOW(3)),
  ('roles.create', 'roles', 'create', 'Crear roles', NOW(3), NOW(3)),
  ('roles.update', 'roles', 'update', 'Actualizar roles', NOW(3), NOW(3)),
  ('roles.assign', 'roles', 'assign', 'Asignar roles a usuarios', NOW(3), NOW(3)),
  ('permissions.read', 'permissions', 'read', 'Ver permisos', NOW(3), NOW(3)),
  ('cuentas.read', 'cuentas', 'read', 'Ver cuentas', NOW(3), NOW(3)),
  ('cuentas.create', 'cuentas', 'create', 'Crear cuentas', NOW(3), NOW(3)),
  ('cuentas.request', 'cuentas', 'request', 'Solicitar creacion de cuentas', NOW(3), NOW(3)),
  ('cuentas.update', 'cuentas', 'update', 'Actualizar cuentas', NOW(3), NOW(3)),
  ('contactos.read', 'contactos', 'read', 'Ver contactos', NOW(3), NOW(3)),
  ('contactos.create', 'contactos', 'create', 'Crear contactos', NOW(3), NOW(3)),
  ('contactos.request', 'contactos', 'request', 'Solicitar creacion de contactos', NOW(3), NOW(3)),
  ('contactos.update', 'contactos', 'update', 'Actualizar contactos', NOW(3), NOW(3)),
  ('oportunidades.read', 'oportunidades', 'read', 'Ver oportunidades', NOW(3), NOW(3)),
  ('oportunidades.create', 'oportunidades', 'create', 'Crear oportunidades', NOW(3), NOW(3)),
  ('oportunidades.request', 'oportunidades', 'request', 'Solicitar creacion de oportunidades', NOW(3), NOW(3)),
  ('oportunidades.update', 'oportunidades', 'update', 'Actualizar oportunidades', NOW(3), NOW(3)),
  ('audit.read', 'audit', 'read', 'Ver auditoria del sistema', NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at);

INSERT INTO account_types (code, name, is_active) VALUES
  ('principal', 'Principal', 1),
  ('potencial', 'Potencial', 1),
  ('prospecto', 'Prospecto', 1),
  ('puntual', 'Puntual', 1),
  ('integrador', 'Integrador', 1),
  ('fabricante', 'Fabricante', 1),
  ('otro', 'Otro', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO economic_sectors (code, name, is_active) VALUES
  ('agricultura', 'Agricultura', 1),
  ('mineria', 'Mineria', 1),
  ('energia', 'Energia', 1),
  ('construccion', 'Construccion', 1),
  ('industria', 'Industria', 1),
  ('comercio', 'Comercio', 1),
  ('transporte', 'Transporte', 1),
  ('informacion', 'Informacion', 1),
  ('finanzas', 'Finanzas', 1),
  ('corporativos', 'Corporativos', 1),
  ('educacion', 'Educacion', 1),
  ('salud', 'Salud', 1),
  ('hoteleria', 'Hoteleria', 1),
  ('gobierno', 'Gobierno', 1),
  ('telecomunicaciones', 'Telecomunicaciones', 1),
  ('otros', 'Otros', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO account_activation_statuses (code, name, is_active) VALUES
  ('activada', 'Activada', 1),
  ('desactivada', 'Desactivada', 1),
  ('pendiente_activacion', 'Pendiente de activacion', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO contact_purchase_participations (code, name, is_active) VALUES
  ('decisor', 'Decisor', 1),
  ('evaluador', 'Evaluador', 1),
  ('recomendador', 'Recomendador', 1),
  ('ninguno', 'Ninguno', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO contact_relationship_types (code, name, is_active) VALUES
  ('amigo', 'Amigo', 1),
  ('enemigo', 'Enemigo', 1),
  ('neutral', 'Neutral', 1),
  ('ninguno', 'Ninguno', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO contact_employment_statuses (code, name, is_active) VALUES
  ('labora', 'Labora', 1),
  ('no_labora', 'No labora', 1),
  ('vacaciones', 'Vacaciones', 1),
  ('externo', 'Externo', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO contact_activation_statuses (code, name, is_active) VALUES
  ('activado', 'Activado', 1),
  ('desactivado', 'Desactivado', 1),
  ('pendiente_activacion', 'Pendiente de activacion', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO opportunity_business_lines (code, name, is_active) VALUES
  ('f5_tradicional', 'F5 tradicional', 1),
  ('f5_renovacion', 'F5 renovación', 1),
  ('f5_dcs', 'F5 DCS', 1),
  ('f5_nginx', 'F5 Nginx', 1),
  ('bluecat_micetro', 'Bluecat Micetro', 1),
  ('bluecat_renovacion', 'Bluecat Renovación', 1),
  ('bluecat_integrity', 'Bluecat Integrity', 1),
  ('bluecat_observabilidad', 'Bluecat Observabilidad', 1),
  ('bluecat_edge', 'Bluecat Edge', 1),
  ('servicios', 'Servicios', 1),
  ('otros', 'Otros', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO opportunity_sales_stages (code, name, stage_order, is_active) VALUES
  ('contacto_inicial', 'Contacto Inicial', 1, 1),
  ('identificacion_oportunidad', 'Identificación de la oportunidad', 2, 1),
  ('desarrollo', 'Desarrollo', 3, 1),
  ('cotizacion', 'Cotización', 4, 1),
  ('demostracion', 'Demostración', 5, 1),
  ('negociacion', 'Negociación', 6, 1),
  ('waiting', 'Waiting', 7, 1),
  ('ganada', 'Ganada', 8, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  stage_order = VALUES(stage_order),
  is_active = VALUES(is_active);

INSERT INTO opportunity_activation_statuses (code, name, is_active) VALUES
  ('activada', 'Activada', 1),
  ('desactivada', 'Desactivada', 1),
  ('pendiente_activacion', 'Pendiente de activacion', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO currencies (code, name, symbol, decimals, is_active, created_at, updated_at) VALUES
  ('USD', 'Dolar estadounidense', '$', 2, 1, NOW(3), NOW(3)),
  ('EUR', 'Euro', 'EUR', 2, 1, NOW(3), NOW(3)),
  ('MXN', 'Peso mexicano', '$', 2, 1, NOW(3), NOW(3)),
  ('COP', 'Peso colombiano', '$', 2, 1, NOW(3), NOW(3)),
  ('ARS', 'Peso argentino', '$', 2, 1, NOW(3), NOW(3)),
  ('PEN', 'Sol peruano', 'S/', 2, 1, NOW(3), NOW(3)),
  ('CLP', 'Peso chileno', '$', 0, 1, NOW(3), NOW(3)),
  ('BRL', 'Real brasileno', 'R$', 2, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE name = VALUES(name), symbol = VALUES(symbol), decimals = VALUES(decimals), is_active = VALUES(is_active), updated_at = VALUES(updated_at);

INSERT INTO countries (iso2, iso3, name, is_active, created_at, updated_at) VALUES
  ('AR', 'ARG', 'Argentina', 1, NOW(3), NOW(3)),
  ('BO', 'BOL', 'Bolivia', 1, NOW(3), NOW(3)),
  ('BR', 'BRA', 'Brasil', 1, NOW(3), NOW(3)),
  ('CA', 'CAN', 'Canada', 1, NOW(3), NOW(3)),
  ('CL', 'CHL', 'Chile', 1, NOW(3), NOW(3)),
  ('CO', 'COL', 'Colombia', 1, NOW(3), NOW(3)),
  ('CR', 'CRI', 'Costa Rica', 1, NOW(3), NOW(3)),
  ('DO', 'DOM', 'Republica Dominicana', 1, NOW(3), NOW(3)),
  ('EC', 'ECU', 'Ecuador', 1, NOW(3), NOW(3)),
  ('ES', 'ESP', 'Espana', 1, NOW(3), NOW(3)),
  ('GT', 'GTM', 'Guatemala', 1, NOW(3), NOW(3)),
  ('HN', 'HND', 'Honduras', 1, NOW(3), NOW(3)),
  ('MX', 'MEX', 'Mexico', 1, NOW(3), NOW(3)),
  ('NI', 'NIC', 'Nicaragua', 1, NOW(3), NOW(3)),
  ('PA', 'PAN', 'Panama', 1, NOW(3), NOW(3)),
  ('PE', 'PER', 'Peru', 1, NOW(3), NOW(3)),
  ('PR', 'PRI', 'Puerto Rico', 1, NOW(3), NOW(3)),
  ('PY', 'PRY', 'Paraguay', 1, NOW(3), NOW(3)),
  ('SV', 'SLV', 'El Salvador', 1, NOW(3), NOW(3)),
  ('US', 'USA', 'Estados Unidos', 1, NOW(3), NOW(3)),
  ('UY', 'URY', 'Uruguay', 1, NOW(3), NOW(3)),
  ('VE', 'VEN', 'Venezuela', 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active), updated_at = VALUES(updated_at);

INSERT INTO country_currency (country_id, currency_id, is_default, created_at)
SELECT c.id, cur.id, 1, NOW(3)
FROM countries c
JOIN currencies cur ON
  (c.iso2 = 'US' AND cur.code = 'USD') OR
  (c.iso2 = 'CA' AND cur.code = 'USD') OR
  (c.iso2 = 'ES' AND cur.code = 'EUR') OR
  (c.iso2 = 'MX' AND cur.code = 'MXN') OR
  (c.iso2 = 'CO' AND cur.code = 'COP') OR
  (c.iso2 = 'AR' AND cur.code = 'ARS') OR
  (c.iso2 = 'CL' AND cur.code = 'CLP') OR
  (c.iso2 = 'BR' AND cur.code = 'BRL') OR
  (c.iso2 = 'PE' AND cur.code = 'PEN') OR
  (c.iso2 = 'UY' AND cur.code = 'USD') OR
  (c.iso2 = 'PY' AND cur.code = 'USD') OR
  (c.iso2 = 'VE' AND cur.code = 'USD') OR
  (c.iso2 = 'EC' AND cur.code = 'USD') OR
  (c.iso2 = 'CR' AND cur.code = 'USD') OR
  (c.iso2 = 'PA' AND cur.code = 'USD') OR
  (c.iso2 = 'GT' AND cur.code = 'USD') OR
  (c.iso2 = 'HN' AND cur.code = 'USD') OR
  (c.iso2 = 'NI' AND cur.code = 'USD') OR
  (c.iso2 = 'SV' AND cur.code = 'USD') OR
  (c.iso2 = 'DO' AND cur.code = 'USD') OR
  (c.iso2 = 'BO' AND cur.code = 'USD') OR
  (c.iso2 = 'PR' AND cur.code = 'USD')
ON DUPLICATE KEY UPDATE is_default = VALUES(is_default);

INSERT INTO roles (
  name,
  description,
  is_system,
  is_active,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
VALUES ('Administrador', 'Acceso total', 1, 1, NULL, NULL, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  is_active = VALUES(is_active),
  updated_by_user_id = VALUES(updated_by_user_id),
  updated_at = VALUES(updated_at);

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW(3)
FROM roles r
JOIN permissions p
WHERE r.name = 'Administrador'
ON DUPLICATE KEY UPDATE created_at = VALUES(created_at);
