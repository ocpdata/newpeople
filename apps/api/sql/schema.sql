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

CREATE TABLE IF NOT EXISTS company_profile (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  singleton_key VARCHAR(40) NOT NULL,
  legal_name VARCHAR(190) NOT NULL,
  commercial_name VARCHAR(190) NULL,
  tax_id VARCHAR(120) NOT NULL,
  logo_url LONGTEXT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  city VARCHAR(120) NOT NULL,
  state_region VARCHAR(120) NOT NULL,
  country_id BIGINT UNSIGNED NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(40) NULL,
  website VARCHAR(300) NULL,
  description TEXT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT uq_company_profile_singleton UNIQUE (singleton_key),
  CONSTRAINT fk_company_profile_country FOREIGN KEY (country_id) REFERENCES countries(id),
  CONSTRAINT fk_company_profile_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_company_profile_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO company_profile (
  singleton_key,
  legal_name,
  commercial_name,
  tax_id,
  logo_url,
  address_line1,
  address_line2,
  city,
  state_region,
  country_id,
  postal_code,
  email,
  phone,
  website,
  description,
  created_by_user_id,
  updated_by_user_id,
  created_at,
  updated_at
)
SELECT
  'default',
  'Access Quality S.A. de C.V.',
  'Access Quality',
  'RFC: AQU110118AV2',
  NULL,
  'Montecito #38, Piso 7, Oficina 1, WTC, Col. Napoles',
  '',
  'Ciudad de Mexico',
  'CDMX',
  c.id,
  '03810',
  '',
  '',
  '',
  'Configuracion institucional inicial',
  NULL,
  NULL,
  NOW(3),
  NOW(3)
FROM countries c
WHERE c.iso2 = 'MX'
  AND NOT EXISTS (
    SELECT 1
    FROM company_profile cp
    WHERE cp.singleton_key = 'default'
  )
LIMIT 1;

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

CREATE TABLE IF NOT EXISTS provider_activation_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_provider_activation_statuses_code UNIQUE (code),
  CONSTRAINT uq_provider_activation_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS provider_price_list_item_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_provider_price_list_item_statuses_code UNIQUE (code),
  CONSTRAINT uq_provider_price_list_item_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS product_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_product_types_code UNIQUE (code),
  CONSTRAINT uq_product_types_name UNIQUE (name)
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

CREATE TABLE IF NOT EXISTS opportunity_commercial_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_opportunity_commercial_statuses_code UNIQUE (code),
  CONSTRAINT uq_opportunity_commercial_statuses_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  account_type_id BIGINT UNSIGNED NOT NULL,
  registration_code VARCHAR(80) NULL,
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

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'SELECT 1',
    'ALTER TABLE accounts MODIFY COLUMN registration_code VARCHAR(80) NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'accounts'
    AND COLUMN_NAME = 'registration_code'
    AND IS_NULLABLE = 'NO'
);
PREPARE s_accounts_col_1 FROM @stmt;
EXECUTE s_accounts_col_1;
DEALLOCATE PREPARE s_accounts_col_1;

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

CREATE TABLE IF NOT EXISTS providers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  registration_code VARCHAR(80) NULL,
  address_line VARCHAR(255) NULL,
  country_id BIGINT UNSIGNED NOT NULL,
  city VARCHAR(120) NULL,
  postal_code VARCHAR(20) NULL,
  state_region VARCHAR(120) NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_providers_country FOREIGN KEY (country_id) REFERENCES countries(id),
  CONSTRAINT fk_providers_activation_status FOREIGN KEY (activation_status_id) REFERENCES provider_activation_statuses(id),
  CONSTRAINT fk_providers_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_providers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT uq_providers_registration UNIQUE (registration_code)
);

CREATE TABLE IF NOT EXISTS provider_price_lists (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  currency_id BIGINT UNSIGNED NULL,
  product_type_id BIGINT UNSIGNED NOT NULL,
  item_type ENUM('producto', 'servicio_propio', 'grupo_productos') NOT NULL DEFAULT 'producto',
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_provider_price_lists_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  CONSTRAINT fk_provider_price_lists_currency FOREIGN KEY (currency_id) REFERENCES currencies(id),
  CONSTRAINT fk_provider_price_lists_product_type FOREIGN KEY (product_type_id) REFERENCES product_types(id),
  CONSTRAINT fk_provider_price_lists_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_provider_price_lists_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT uq_provider_price_lists_provider_name UNIQUE (provider_id, name)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_lists ADD COLUMN currency_id BIGINT UNSIGNED NULL AFTER name',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND COLUMN_NAME = 'currency_id'
);
PREPARE s_provider_price_lists_currency_col FROM @stmt;
EXECUTE s_provider_price_lists_currency_col;
DEALLOCATE PREPARE s_provider_price_lists_currency_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_lists ADD CONSTRAINT fk_provider_price_lists_currency FOREIGN KEY (currency_id) REFERENCES currencies(id)',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND CONSTRAINT_NAME = 'fk_provider_price_lists_currency'
);
PREPARE s_provider_price_lists_currency_fk FROM @stmt;
EXECUTE s_provider_price_lists_currency_fk;
DEALLOCATE PREPARE s_provider_price_lists_currency_fk;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_lists ADD COLUMN product_type_id BIGINT UNSIGNED NULL AFTER currency_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND COLUMN_NAME = 'product_type_id'
);
PREPARE s_provider_price_lists_product_type_col FROM @stmt;
EXECUTE s_provider_price_lists_product_type_col;
DEALLOCATE PREPARE s_provider_price_lists_product_type_col;

UPDATE provider_price_lists ppl
INNER JOIN product_types pt ON pt.code = ppl.item_type
SET ppl.product_type_id = pt.id
WHERE ppl.product_type_id IS NULL;

UPDATE provider_price_lists ppl
INNER JOIN product_types pt ON pt.id = ppl.product_type_id
SET ppl.item_type = pt.code
WHERE ppl.item_type <> pt.code;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_lists MODIFY COLUMN product_type_id BIGINT UNSIGNED NOT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND COLUMN_NAME = 'product_type_id'
    AND IS_NULLABLE = 'NO'
);
PREPARE s_provider_price_lists_product_type_not_null FROM @stmt;
EXECUTE s_provider_price_lists_product_type_not_null;
DEALLOCATE PREPARE s_provider_price_lists_product_type_not_null;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_lists ADD CONSTRAINT fk_provider_price_lists_product_type FOREIGN KEY (product_type_id) REFERENCES product_types(id)',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND CONSTRAINT_NAME = 'fk_provider_price_lists_product_type'
);
PREPARE s_provider_price_lists_product_type_fk FROM @stmt;
EXECUTE s_provider_price_lists_product_type_fk;
DEALLOCATE PREPARE s_provider_price_lists_product_type_fk;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE provider_price_lists ADD COLUMN item_type ENUM('producto', 'servicio_propio', 'grupo_productos') NOT NULL DEFAULT 'producto' AFTER currency_id",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND COLUMN_NAME = 'item_type'
);
PREPARE s_provider_price_lists_item_type_col FROM @stmt;
EXECUTE s_provider_price_lists_item_type_col;
DEALLOCATE PREPARE s_provider_price_lists_item_type_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE provider_price_lists MODIFY COLUMN item_type ENUM('producto', 'servicio_propio', 'grupo_productos') NOT NULL DEFAULT 'producto'",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_lists'
    AND COLUMN_NAME = 'item_type'
    AND COLUMN_TYPE = "enum('producto','servicio_propio','grupo_productos')"
);
PREPARE s_provider_price_lists_item_type_enum FROM @stmt;
EXECUTE s_provider_price_lists_item_type_enum;
DEALLOCATE PREPARE s_provider_price_lists_item_type_enum;

CREATE TABLE IF NOT EXISTS provider_price_list_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_id BIGINT UNSIGNED NOT NULL,
  price_list_id BIGINT UNSIGNED NULL,
  code VARCHAR(80) NOT NULL,
  description TEXT NULL,
  product_type_id BIGINT UNSIGNED NOT NULL,
  item_type ENUM('producto', 'servicio_propio', 'grupo_productos') NOT NULL DEFAULT 'producto',
  price DECIMAL(12, 2) NOT NULL,
  currency_id BIGINT UNSIGNED NOT NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_provider_price_list_items_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  CONSTRAINT fk_provider_price_list_items_price_list FOREIGN KEY (price_list_id) REFERENCES provider_price_lists(id) ON DELETE CASCADE,
  CONSTRAINT fk_provider_price_list_items_product_type FOREIGN KEY (product_type_id) REFERENCES product_types(id),
  CONSTRAINT fk_provider_price_list_items_currency FOREIGN KEY (currency_id) REFERENCES currencies(id),
  CONSTRAINT fk_provider_price_list_items_activation_status FOREIGN KEY (activation_status_id) REFERENCES provider_price_list_item_statuses(id),
  CONSTRAINT fk_provider_price_list_items_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_provider_price_list_items_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT uq_provider_price_list_items_list_code UNIQUE (price_list_id, code)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_items ADD COLUMN product_type_id BIGINT UNSIGNED NULL AFTER description',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND COLUMN_NAME = 'product_type_id'
);
PREPARE s_provider_price_list_items_product_type_col FROM @stmt;
EXECUTE s_provider_price_list_items_product_type_col;
DEALLOCATE PREPARE s_provider_price_list_items_product_type_col;

UPDATE provider_price_list_items ppli
INNER JOIN product_types pt ON pt.code = ppli.item_type
SET ppli.product_type_id = pt.id
WHERE ppli.product_type_id IS NULL;

UPDATE provider_price_list_items ppli
INNER JOIN product_types pt ON pt.id = ppli.product_type_id
SET ppli.item_type = pt.code
WHERE ppli.item_type <> pt.code;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_items MODIFY COLUMN product_type_id BIGINT UNSIGNED NOT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND COLUMN_NAME = 'product_type_id'
    AND IS_NULLABLE = 'NO'
);
PREPARE s_provider_price_list_items_product_type_not_null FROM @stmt;
EXECUTE s_provider_price_list_items_product_type_not_null;
DEALLOCATE PREPARE s_provider_price_list_items_product_type_not_null;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_items ADD CONSTRAINT fk_provider_price_list_items_product_type FOREIGN KEY (product_type_id) REFERENCES product_types(id)',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND CONSTRAINT_NAME = 'fk_provider_price_list_items_product_type'
);
PREPARE s_provider_price_list_items_product_type_fk FROM @stmt;
EXECUTE s_provider_price_list_items_product_type_fk;
DEALLOCATE PREPARE s_provider_price_list_items_product_type_fk;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE provider_price_list_items ADD COLUMN item_type ENUM('producto', 'servicio_propio', 'grupo_productos') NOT NULL DEFAULT 'producto' AFTER description",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND COLUMN_NAME = 'item_type'
);
PREPARE s_provider_price_list_items_item_type_col FROM @stmt;
EXECUTE s_provider_price_list_items_item_type_col;
DEALLOCATE PREPARE s_provider_price_list_items_item_type_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE provider_price_list_items MODIFY COLUMN item_type ENUM('producto', 'servicio_propio', 'grupo_productos') NOT NULL DEFAULT 'producto'",
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND COLUMN_NAME = 'item_type'
    AND COLUMN_TYPE = "enum('producto','servicio_propio','grupo_productos')"
);
PREPARE s_provider_price_list_items_item_type_enum FROM @stmt;
EXECUTE s_provider_price_list_items_item_type_enum;
DEALLOCATE PREPARE s_provider_price_list_items_item_type_enum;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_items ADD COLUMN price_list_id BIGINT UNSIGNED NULL AFTER provider_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND COLUMN_NAME = 'price_list_id'
);
PREPARE s_provider_price_list_items_price_list_id_col FROM @stmt;
EXECUTE s_provider_price_list_items_price_list_id_col;
DEALLOCATE PREPARE s_provider_price_list_items_price_list_id_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_items ADD CONSTRAINT fk_provider_price_list_items_price_list FOREIGN KEY (price_list_id) REFERENCES provider_price_lists(id) ON DELETE CASCADE',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND CONSTRAINT_NAME = 'fk_provider_price_list_items_price_list'
);
PREPARE s_provider_price_list_items_price_list_fk FROM @stmt;
EXECUTE s_provider_price_list_items_price_list_fk;
DEALLOCATE PREPARE s_provider_price_list_items_price_list_fk;

CREATE TABLE IF NOT EXISTS provider_price_list_item_components (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grupo_item_id BIGINT UNSIGNED NOT NULL,
  component_item_id BIGINT UNSIGNED NOT NULL,
  unit_price_override DECIMAL(12, 2) NOT NULL,
  quantity DECIMAL(12, 2) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_provider_price_list_item_components_grupo_item FOREIGN KEY (grupo_item_id) REFERENCES provider_price_list_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_provider_price_list_item_components_component_item FOREIGN KEY (component_item_id) REFERENCES provider_price_list_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_provider_price_list_item_components_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_provider_price_list_item_components_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT uq_provider_price_list_item_components_pair UNIQUE (grupo_item_id, component_item_id)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_item_components ADD COLUMN unit_price_override DECIMAL(12, 2) NULL DEFAULT NULL AFTER component_item_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_item_components'
    AND COLUMN_NAME = 'unit_price_override'
);
PREPARE s_provider_price_list_item_components_unit_price_override_col FROM @stmt;
EXECUTE s_provider_price_list_item_components_unit_price_override_col;
DEALLOCATE PREPARE s_provider_price_list_item_components_unit_price_override_col;

UPDATE provider_price_list_item_components component_link
INNER JOIN provider_price_list_items child ON child.id = component_link.component_item_id
SET component_link.unit_price_override = child.price
WHERE component_link.unit_price_override IS NULL;

ALTER TABLE provider_price_list_item_components
MODIFY COLUMN unit_price_override DECIMAL(12, 2) NOT NULL DEFAULT 0;

INSERT INTO provider_price_lists (
  provider_id,
  name,
  currency_id,
  product_type_id,
  item_type,
  is_active,
  created_by,
  created_at,
  updated_by,
  updated_at
)
SELECT legacy.provider_id,
       'Lista legacy',
       legacy.currency_id,
  pt.id,
  legacy.item_type,
       0,
       legacy.actor_user_id,
       legacy.first_created_at,
       legacy.actor_user_id,
       legacy.last_updated_at
FROM (
  SELECT ppli.provider_id,
         COALESCE(MIN(ppli.created_by), MIN(ppli.updated_by)) AS actor_user_id,
      MIN(ppli.currency_id) AS currency_id,
      MIN(ppli.item_type) AS item_type,
         MIN(ppli.created_at) AS first_created_at,
         MAX(ppli.updated_at) AS last_updated_at
  FROM provider_price_list_items ppli
  WHERE ppli.price_list_id IS NULL
  GROUP BY ppli.provider_id
) legacy
INNER JOIN product_types pt ON pt.code = legacy.item_type
LEFT JOIN provider_price_lists ppl
  ON ppl.provider_id = legacy.provider_id
 AND ppl.name = 'Lista legacy'
WHERE ppl.id IS NULL;

UPDATE provider_price_list_items ppli
INNER JOIN provider_price_lists ppl
  ON ppl.provider_id = ppli.provider_id
 AND ppl.name = 'Lista legacy'
SET ppli.price_list_id = ppl.id
WHERE ppli.price_list_id IS NULL;

UPDATE provider_price_lists ppl
INNER JOIN (
  SELECT ppli.price_list_id,
         MIN(ppli.currency_id) AS currency_id,
         MIN(ppli.product_type_id) AS product_type_id,
         MIN(ppli.item_type) AS item_type
  FROM provider_price_list_items ppli
  WHERE ppli.price_list_id IS NOT NULL
  GROUP BY ppli.price_list_id
) item_stats ON item_stats.price_list_id = ppl.id
SET ppl.currency_id = COALESCE(ppl.currency_id, item_stats.currency_id),
    ppl.product_type_id = COALESCE(ppl.product_type_id, item_stats.product_type_id),
    ppl.item_type = item_stats.item_type
WHERE ppl.currency_id IS NULL OR ppl.product_type_id IS NULL OR ppl.item_type = 'producto';

SET @stmt := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE provider_price_list_items DROP INDEX uq_provider_price_list_items_provider_code',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND INDEX_NAME = 'uq_provider_price_list_items_provider_code'
);
PREPARE s_provider_price_list_items_drop_old_unique FROM @stmt;
EXECUTE s_provider_price_list_items_drop_old_unique;
DEALLOCATE PREPARE s_provider_price_list_items_drop_old_unique;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE provider_price_list_items ADD CONSTRAINT uq_provider_price_list_items_list_code UNIQUE (price_list_id, code)',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'provider_price_list_items'
    AND CONSTRAINT_NAME = 'uq_provider_price_list_items_list_code'
);
PREPARE s_provider_price_list_items_add_list_unique FROM @stmt;
EXECUTE s_provider_price_list_items_add_list_unique;
DEALLOCATE PREPARE s_provider_price_list_items_add_list_unique;

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
  commercial_status_id BIGINT UNSIGNED NOT NULL,
  commercial_closed_at DATETIME(3) NULL,
  commercial_close_reason TEXT NULL,
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
  CONSTRAINT fk_opportunities_commercial_status FOREIGN KEY (commercial_status_id) REFERENCES opportunity_commercial_statuses(id),
  CONSTRAINT fk_opportunities_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_opportunities_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS account_interaction_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_account_interaction_types_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS account_interaction_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_account_interaction_results_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS account_interactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  interaction_type_id BIGINT UNSIGNED NOT NULL,
  result_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary LONGTEXT NOT NULL,
  next_step LONGTEXT NULL,
  occurred_at DATETIME(3) NOT NULL,
  follow_up_at DATETIME(3) NULL,
  linked_opportunity_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_account_interactions_public_id UNIQUE (public_id),
  CONSTRAINT fk_account_interactions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_account_interactions_type FOREIGN KEY (interaction_type_id) REFERENCES account_interaction_types(id),
  CONSTRAINT fk_account_interactions_result FOREIGN KEY (result_id) REFERENCES account_interaction_results(id),
  CONSTRAINT fk_account_interactions_opportunity FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  CONSTRAINT fk_account_interactions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_account_interactions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_account_interactions_account_date (account_id, occurred_at),
  INDEX idx_account_interactions_result (account_id, result_id, occurred_at),
  INDEX idx_account_interactions_linked_opportunity (linked_opportunity_id)
);

CREATE TABLE IF NOT EXISTS account_interaction_contacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  interaction_id BIGINT UNSIGNED NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_account_interaction_contacts UNIQUE (interaction_id, contact_id),
  CONSTRAINT fk_account_interaction_contacts_interaction FOREIGN KEY (interaction_id) REFERENCES account_interactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_account_interaction_contacts_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  INDEX idx_account_interaction_contacts_contact (contact_id)
);

INSERT INTO account_interaction_types (code, name, display_order, is_active, created_at, updated_at)
VALUES
  ('meeting', 'Reunion', 1, 1, NOW(3), NOW(3)),
  ('call', 'Llamada', 2, 1, NOW(3), NOW(3)),
  ('presentation', 'Presentacion', 3, 1, NOW(3), NOW(3)),
  ('demo', 'Demo', 4, 1, NOW(3), NOW(3)),
  ('workshop', 'Workshop', 5, 1, NOW(3), NOW(3)),
  ('follow_up', 'Seguimiento', 6, 1, NOW(3), NOW(3)),
  ('email', 'Correo relevante', 7, 1, NOW(3), NOW(3)),
  ('other', 'Otro', 8, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO account_interaction_results (code, name, display_order, is_active, created_at, updated_at)
VALUES
  ('no_defined_opportunity', 'Sin oportunidad definida', 1, 1, NOW(3), NOW(3)),
  ('exploring', 'En exploracion', 2, 1, NOW(3), NOW(3)),
  ('future_interest', 'Interes futuro', 3, 1, NOW(3), NOW(3)),
  ('follow_up_required', 'Requiere seguimiento', 4, 1, NOW(3), NOW(3)),
  ('not_interested_for_now', 'No interesado por ahora', 5, 1, NOW(3), NOW(3)),
  ('opportunity_detected', 'Oportunidad detectada', 6, 1, NOW(3), NOW(3)),
  ('converted_to_opportunity', 'Derivo en oportunidad creada', 7, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

CREATE TABLE IF NOT EXISTS interactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_notes LONGTEXT NULL,
  summary LONGTEXT NULL,
  analysis_status VARCHAR(40) NOT NULL DEFAULT 'uploaded',
  warnings_json LONGTEXT NULL,
  topics_json LONGTEXT NULL,
  actions_taken_json LONGTEXT NULL,
  next_steps_json LONGTEXT NULL,
  suggested_account_json LONGTEXT NULL,
  suggested_contacts_json LONGTEXT NULL,
  suggested_opportunities_json LONGTEXT NULL,
  account_id BIGINT UNSIGNED NULL,
  primary_opportunity_id BIGINT UNSIGNED NULL,
  analyzed_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_interactions_public_id UNIQUE (public_id),
  CONSTRAINT fk_interactions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_interactions_primary_opportunity FOREIGN KEY (primary_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  CONSTRAINT fk_interactions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_interactions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_interactions_status_created (analysis_status, created_at),
  INDEX idx_interactions_account_created (account_id, created_at),
  INDEX idx_interactions_primary_opportunity (primary_opportunity_id)
);

CREATE TABLE IF NOT EXISTS interaction_contact_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  interaction_id BIGINT UNSIGNED NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_interaction_contact_links UNIQUE (interaction_id, contact_id),
  CONSTRAINT fk_interaction_contact_links_interaction FOREIGN KEY (interaction_id) REFERENCES interactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_interaction_contact_links_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  INDEX idx_interaction_contact_links_contact (contact_id)
);

CREATE TABLE IF NOT EXISTS interaction_opportunity_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  interaction_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_interaction_opportunity_links UNIQUE (interaction_id, opportunity_id),
  CONSTRAINT fk_interaction_opportunity_links_interaction FOREIGN KEY (interaction_id) REFERENCES interactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_interaction_opportunity_links_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  INDEX idx_interaction_opportunity_links_opportunity (opportunity_id),
  INDEX idx_interaction_opportunity_links_primary (interaction_id, is_primary)
);

CREATE TABLE IF NOT EXISTS commercial_signal_rulesets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  fit_weight DECIMAL(5,2) NOT NULL DEFAULT 0.20,
  signal_strength_weight DECIMAL(5,2) NOT NULL DEFAULT 0.25,
  urgency_weight DECIMAL(5,2) NOT NULL DEFAULT 0.15,
  engagement_weight DECIMAL(5,2) NOT NULL DEFAULT 0.15,
  coverage_weight DECIMAL(5,2) NOT NULL DEFAULT 0.15,
  momentum_weight DECIMAL(5,2) NOT NULL DEFAULT 0.10,
  min_signal_score DECIMAL(5,2) NOT NULL DEFAULT 35.00,
  min_case_score DECIMAL(5,2) NOT NULL DEFAULT 45.00,
  suggest_convert_score DECIMAL(5,2) NOT NULL DEFAULT 60.00,
  priority_critical_threshold DECIMAL(5,2) NOT NULL DEFAULT 85.00,
  priority_high_threshold DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  priority_medium_threshold DECIMAL(5,2) NOT NULL DEFAULT 55.00,
  priority_low_threshold DECIMAL(5,2) NOT NULL DEFAULT 40.00,
  dedupe_window_days INT NOT NULL DEFAULT 21,
  topic_similarity_threshold DECIMAL(5,2) NOT NULL DEFAULT 0.75,
  stale_penalty_start_days INT NOT NULL DEFAULT 15,
  stale_penalty_per_day DECIMAL(5,2) NOT NULL DEFAULT 1.50,
  stale_penalty_cap DECIMAL(5,2) NOT NULL DEFAULT 25.00,
  reactivation_lookback_days INT NOT NULL DEFAULT 60,
  created_by_user_id BIGINT UNSIGNED NULL,
  activated_by_user_id BIGINT UNSIGNED NULL,
  activated_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_commercial_signal_rulesets_code UNIQUE (code),
  CONSTRAINT fk_commercial_signal_rulesets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_commercial_signal_rulesets_activated_by FOREIGN KEY (activated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS potential_opportunity_cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL,
  case_type ENUM('nueva', 'reactivacion', 'expansion', 'promovible', 'riesgo_fuga') NOT NULL,
  title VARCHAR(255) NOT NULL,
  topic_key VARCHAR(255) NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  primary_contact_id BIGINT UNSIGNED NULL,
  related_opportunity_id BIGINT UNSIGNED NULL,
  converted_opportunity_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  assigned_by_user_id BIGINT UNSIGNED NULL,
  source_kind VARCHAR(40) NOT NULL DEFAULT 'interaction',
  source_entity_id BIGINT UNSIGNED NULL,
  commercial_hypothesis TEXT NOT NULL,
  business_need_summary TEXT NULL,
  next_step_suggestion TEXT NULL,
  recommended_action ENUM('crear_oportunidad', 'agendar_reunion', 'llamar_contacto', 'enviar_material', 'investigar_cuenta', 'validar_necesidad', 'reasignar_owner', 'descartar') NOT NULL,
  recommended_action_due_date DATE NULL,
  fit_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  signal_strength_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  urgency_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  engagement_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  coverage_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  momentum_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  staleness_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  duplicate_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  total_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  priority_level ENUM('critical', 'high', 'medium', 'low', 'observe') NOT NULL DEFAULT 'observe',
  top_positive_factors_json LONGTEXT NULL,
  top_negative_factors_json LONGTEXT NULL,
  signal_count INT NOT NULL DEFAULT 0,
  state ENUM('new', 'in_review', 'accepted', 'converted', 'postponed', 'dismissed', 'expired') NOT NULL DEFAULT 'new',
  state_reason VARCHAR(255) NULL,
  dismissed_reason_code VARCHAR(64) NULL,
  dismissed_reason_note VARCHAR(500) NULL,
  postponed_until DATE NULL,
  snooze_count INT NOT NULL DEFAULT 0,
  first_detected_at DATETIME(3) NOT NULL,
  last_detected_at DATETIME(3) NOT NULL,
  latest_evidence_at DATETIME(3) NULL,
  review_sla_at DATETIME(3) NULL,
  converted_at DATETIME(3) NULL,
  converted_by_user_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_potential_opportunity_cases_public_id UNIQUE (public_id),
  CONSTRAINT fk_potential_opportunity_cases_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_potential_opportunity_cases_primary_contact FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  CONSTRAINT fk_potential_opportunity_cases_related_opportunity FOREIGN KEY (related_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  CONSTRAINT fk_potential_opportunity_cases_converted_opportunity FOREIGN KEY (converted_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  CONSTRAINT fk_potential_opportunity_cases_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_potential_opportunity_cases_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_potential_opportunity_cases_converted_by FOREIGN KEY (converted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_potential_opportunity_cases_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_potential_opportunity_cases_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_potential_opportunity_cases_owner (owner_user_id),
  INDEX idx_potential_opportunity_cases_state (state),
  INDEX idx_potential_opportunity_cases_priority (priority_level),
  INDEX idx_potential_opportunity_cases_review_sla (review_sla_at)
);

CREATE TABLE IF NOT EXISTS commercial_signals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL,
  case_id BIGINT UNSIGNED NULL,
  ruleset_id BIGINT UNSIGNED NOT NULL,
  signal_type ENUM('nueva_oportunidad', 'reactivacion', 'expansion', 'interaccion_promovible', 'riesgo_fuga') NOT NULL,
  signal_subtype VARCHAR(64) NOT NULL,
  source_type ENUM('interaction') NOT NULL DEFAULT 'interaction',
  source_entity_id BIGINT UNSIGNED NOT NULL,
  interaction_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  contact_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  evidence_summary TEXT NULL,
  topic_key VARCHAR(255) NOT NULL,
  fit_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  signal_strength_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  urgency_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  engagement_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  coverage_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  momentum_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  staleness_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  duplicate_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  total_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  top_positive_factors_json LONGTEXT NULL,
  top_negative_factors_json LONGTEXT NULL,
  status ENUM('new', 'attached', 'dismissed', 'expired') NOT NULL DEFAULT 'new',
  detected_at DATETIME(3) NOT NULL,
  review_required TINYINT(1) NOT NULL DEFAULT 1,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  review_outcome ENUM('accepted', 'dismissed', 'postponed') NULL,
  dismissed_reason_code VARCHAR(64) NULL,
  dismissed_reason_note VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_commercial_signals_public_id UNIQUE (public_id),
  CONSTRAINT uq_commercial_signals_interaction UNIQUE (interaction_id),
  CONSTRAINT fk_commercial_signals_case FOREIGN KEY (case_id) REFERENCES potential_opportunity_cases(id) ON DELETE SET NULL,
  CONSTRAINT fk_commercial_signals_ruleset FOREIGN KEY (ruleset_id) REFERENCES commercial_signal_rulesets(id),
  CONSTRAINT fk_commercial_signals_interaction FOREIGN KEY (interaction_id) REFERENCES interactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_commercial_signals_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_commercial_signals_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  CONSTRAINT fk_commercial_signals_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_commercial_signals_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_commercial_signals_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_commercial_signals_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_commercial_signals_case (case_id),
  INDEX idx_commercial_signals_account_detected (account_id, detected_at)
);

CREATE TABLE IF NOT EXISTS potential_opportunity_case_transitions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  from_state ENUM('new', 'in_review', 'accepted', 'converted', 'postponed', 'dismissed', 'expired') NULL,
  to_state ENUM('new', 'in_review', 'accepted', 'converted', 'postponed', 'dismissed', 'expired') NOT NULL,
  reason_code VARCHAR(64) NULL,
  reason_note VARCHAR(500) NULL,
  changed_by_user_id BIGINT UNSIGNED NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT fk_potential_opportunity_case_transitions_case FOREIGN KEY (case_id) REFERENCES potential_opportunity_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_potential_opportunity_case_transitions_changed_by FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_potential_opportunity_case_transitions_case (case_id, changed_at)
);

INSERT INTO commercial_signal_rulesets (
  code, name, is_active,
  fit_weight, signal_strength_weight, urgency_weight,
  engagement_weight, coverage_weight, momentum_weight,
  min_signal_score, min_case_score, suggest_convert_score,
  priority_critical_threshold, priority_high_threshold,
  priority_medium_threshold, priority_low_threshold,
  dedupe_window_days, topic_similarity_threshold,
  stale_penalty_start_days, stale_penalty_per_day,
  stale_penalty_cap, reactivation_lookback_days,
  created_at, updated_at, activated_at
)
VALUES (
  'default_v1', 'Scoring default v1', 1,
  0.20, 0.25, 0.15,
  0.15, 0.15, 0.10,
  35.00, 45.00, 60.00,
  85.00, 70.00,
  55.00, 40.00,
  21, 0.75,
  15, 1.50,
  25.00, 60,
  NOW(3), NOW(3), NOW(3)
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  updated_at = VALUES(updated_at);

CREATE TABLE IF NOT EXISTS quotation_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  ui_key VARCHAR(80) NOT NULL DEFAULT 'default',
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_statuses_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_actions_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_activation_statuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_activation_statuses_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_section_inclusion_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_section_inclusion_types_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_delivery_times (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_delivery_times_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_validity_terms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_validity_terms_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_warranty_terms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_warranty_terms_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotation_payment_terms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_payment_terms_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS quotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  latest_version_id BIGINT UNSIGNED NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  CONSTRAINT fk_quotations_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotations_activation_status FOREIGN KEY (activation_status_id) REFERENCES quotation_activation_statuses(id),
  CONSTRAINT fk_quotations_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_quotations_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
  INDEX idx_quotations_opportunity (opportunity_id),
  INDEX idx_quotations_latest_version (latest_version_id)
);

CREATE TABLE IF NOT EXISTS quotation_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  contact_id BIGINT UNSIGNED NOT NULL,
  proposal_name VARCHAR(180) NOT NULL,
  quotation_date DATE NOT NULL,
  introduction LONGTEXT NULL,
  status_id BIGINT UNSIGNED NOT NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  summary_discount_mode VARCHAR(20) NULL,
  summary_discount_value DECIMAL(15, 8) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  CONSTRAINT uq_quotation_versions_number UNIQUE (quotation_id, version_number),
  CONSTRAINT fk_quotation_versions_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_versions_contact FOREIGN KEY (contact_id) REFERENCES contacts(id),
  CONSTRAINT fk_quotation_versions_status FOREIGN KEY (status_id) REFERENCES quotation_statuses(id),
  CONSTRAINT fk_quotation_versions_activation_status FOREIGN KEY (activation_status_id) REFERENCES quotation_activation_statuses(id),
  CONSTRAINT fk_quotation_versions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_quotation_versions_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
  INDEX idx_quotation_versions_quotation (quotation_id, version_number),
  INDEX idx_quotation_versions_status (status_id)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN summary_discount_mode VARCHAR(20) NULL AFTER activation_status_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_discount_mode'
);
PREPARE s_quotation_versions_summary_discount_mode_col FROM @stmt;
EXECUTE s_quotation_versions_summary_discount_mode_col;
DEALLOCATE PREPARE s_quotation_versions_summary_discount_mode_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN summary_discount_value DECIMAL(15, 8) NULL AFTER summary_discount_mode',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_discount_value'
);
PREPARE s_quotation_versions_summary_discount_value_col FROM @stmt;
EXECUTE s_quotation_versions_summary_discount_value_col;
DEALLOCATE PREPARE s_quotation_versions_summary_discount_value_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions MODIFY COLUMN summary_discount_value DECIMAL(15, 8) NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_discount_value'
    AND NUMERIC_PRECISION = 15
    AND NUMERIC_SCALE = 8
);
PREPARE s_quotation_versions_summary_discount_value_scale FROM @stmt;
EXECUTE s_quotation_versions_summary_discount_value_scale;
DEALLOCATE PREPARE s_quotation_versions_summary_discount_value_scale;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN summary_distribution_mode VARCHAR(20) NULL AFTER summary_discount_value',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_distribution_mode'
);
PREPARE s_quotation_versions_summary_distribution_mode_col FROM @stmt;
EXECUTE s_quotation_versions_summary_distribution_mode_col;
DEALLOCATE PREPARE s_quotation_versions_summary_distribution_mode_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN summary_vat_mode VARCHAR(20) NULL AFTER summary_distribution_mode',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_vat_mode'
);
PREPARE s_quotation_versions_summary_vat_mode_col FROM @stmt;
EXECUTE s_quotation_versions_summary_vat_mode_col;
DEALLOCATE PREPARE s_quotation_versions_summary_vat_mode_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN summary_vat_pct DECIMAL(15, 8) NULL AFTER summary_vat_mode',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_vat_pct'
);
PREPARE s_quotation_versions_summary_vat_pct_col FROM @stmt;
EXECUTE s_quotation_versions_summary_vat_pct_col;
DEALLOCATE PREPARE s_quotation_versions_summary_vat_pct_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions MODIFY COLUMN summary_vat_pct DECIMAL(15, 8) NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'summary_vat_pct'
    AND (
      NUMERIC_PRECISION <> 15
      OR NUMERIC_SCALE <> 8
    )
);
PREPARE s_quotation_versions_summary_vat_pct_scale FROM @stmt;
EXECUTE s_quotation_versions_summary_vat_pct_scale;
DEALLOCATE PREPARE s_quotation_versions_summary_vat_pct_scale;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN internal_notes LONGTEXT NULL AFTER summary_vat_pct',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'internal_notes'
);
PREPARE s_quotation_versions_internal_notes_col FROM @stmt;
EXECUTE s_quotation_versions_internal_notes_col;
DEALLOCATE PREPARE s_quotation_versions_internal_notes_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN delivery_time VARCHAR(120) NULL AFTER internal_notes',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'delivery_time'
);
PREPARE s_quotation_versions_delivery_time_col FROM @stmt;
EXECUTE s_quotation_versions_delivery_time_col;
DEALLOCATE PREPARE s_quotation_versions_delivery_time_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN quotation_validity VARCHAR(120) NULL AFTER delivery_time',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'quotation_validity'
);
PREPARE s_quotation_versions_quotation_validity_col FROM @stmt;
EXECUTE s_quotation_versions_quotation_validity_col;
DEALLOCATE PREPARE s_quotation_versions_quotation_validity_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN warranty_term VARCHAR(120) NULL AFTER quotation_validity',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'warranty_term'
);
PREPARE s_quotation_versions_warranty_term_col FROM @stmt;
EXECUTE s_quotation_versions_warranty_term_col;
DEALLOCATE PREPARE s_quotation_versions_warranty_term_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN payment_terms VARCHAR(180) NULL AFTER warranty_term',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'payment_terms'
);
PREPARE s_quotation_versions_payment_terms_col FROM @stmt;
EXECUTE s_quotation_versions_payment_terms_col;
DEALLOCATE PREPARE s_quotation_versions_payment_terms_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN currency_code VARCHAR(20) NULL AFTER payment_terms',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'currency_code'
);
PREPARE s_quotation_versions_currency_code_col FROM @stmt;
EXECUTE s_quotation_versions_currency_code_col;
DEALLOCATE PREPARE s_quotation_versions_currency_code_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN exchange_rate DECIMAL(15, 4) NULL AFTER currency_code',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'exchange_rate'
);
PREPARE s_quotation_versions_exchange_rate_col FROM @stmt;
EXECUTE s_quotation_versions_exchange_rate_col;
DEALLOCATE PREPARE s_quotation_versions_exchange_rate_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions ADD COLUMN quotation_notes LONGTEXT NULL AFTER exchange_rate',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'quotation_notes'
);
PREPARE s_quotation_versions_quotation_notes_col FROM @stmt;
EXECUTE s_quotation_versions_quotation_notes_col;
DEALLOCATE PREPARE s_quotation_versions_quotation_notes_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_versions MODIFY COLUMN exchange_rate DECIMAL(15, 4) NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_versions'
    AND COLUMN_NAME = 'exchange_rate'
    AND (
      NUMERIC_PRECISION <> 15
      OR NUMERIC_SCALE <> 4
    )
);
PREPARE s_quotation_versions_exchange_rate_scale FROM @stmt;
EXECUTE s_quotation_versions_exchange_rate_scale;
DEALLOCATE PREPARE s_quotation_versions_exchange_rate_scale;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotations ADD CONSTRAINT fk_quotations_latest_version FOREIGN KEY (latest_version_id) REFERENCES quotation_versions(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotations'
    AND CONSTRAINT_NAME = 'fk_quotations_latest_version'
);
PREPARE s_quotations_latest_version_fk FROM @stmt;
EXECUTE s_quotations_latest_version_fk;
DEALLOCATE PREPARE s_quotations_latest_version_fk;

CREATE TABLE IF NOT EXISTS quotation_sections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_version_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  inclusion_type_id BIGINT UNSIGNED NOT NULL,
  activation_status_id BIGINT UNSIGNED NOT NULL,
  display_order INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  CONSTRAINT fk_quotation_sections_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_sections_inclusion FOREIGN KEY (inclusion_type_id) REFERENCES quotation_section_inclusion_types(id),
  CONSTRAINT fk_quotation_sections_activation_status FOREIGN KEY (activation_status_id) REFERENCES quotation_activation_statuses(id),
  CONSTRAINT fk_quotation_sections_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_quotation_sections_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
  INDEX idx_quotation_sections_version (quotation_version_id, display_order)
);

CREATE TABLE IF NOT EXISTS quotation_section_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quotation_section_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(120) NOT NULL,
  product_description TEXT NOT NULL,
  item_type VARCHAR(40) NOT NULL DEFAULT 'producto',
  bundle_parent_item_id BIGINT UNSIGNED NULL,
  bundle_origin_type VARCHAR(40) NULL,
  source_provider_price_list_item_id BIGINT UNSIGNED NULL,
  source_component_price_list_item_id BIGINT UNSIGNED NULL,
  quantity DECIMAL(15, 4) NOT NULL,
  original_currency_code CHAR(3) NULL,
  original_list_price_unit DECIMAL(15, 4) NULL,
  list_price_unit DECIMAL(15, 4) NOT NULL,
  manufacturer_discount_pct DECIMAL(7, 4) NOT NULL DEFAULT 0,
  import_cost_pct DECIMAL(7, 4) NOT NULL DEFAULT 0,
  profit_margin_pct DECIMAL(7, 4) NOT NULL DEFAULT 0,
  final_discount_pct DECIMAL(7, 4) NOT NULL DEFAULT 0,
  display_order INT UNSIGNED NOT NULL DEFAULT 1,
  bundle_sort_order INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NOT NULL,
  CONSTRAINT fk_quotation_section_items_section FOREIGN KEY (quotation_section_id) REFERENCES quotation_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_section_items_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
  CONSTRAINT fk_quotation_section_items_bundle_parent FOREIGN KEY (bundle_parent_item_id) REFERENCES quotation_section_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_quotation_section_items_source_provider_price_item FOREIGN KEY (source_provider_price_list_item_id) REFERENCES provider_price_list_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_quotation_section_items_source_component_price_item FOREIGN KEY (source_component_price_list_item_id) REFERENCES provider_price_list_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_quotation_section_items_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_quotation_section_items_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
  INDEX idx_quotation_section_items_section (quotation_section_id, display_order),
  INDEX idx_quotation_section_items_bundle_parent (bundle_parent_item_id, bundle_sort_order, display_order)
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN final_discount_pct DECIMAL(7, 4) NOT NULL DEFAULT 0 AFTER profit_margin_pct',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'final_discount_pct'
);
PREPARE s_quotation_section_items_final_discount_col FROM @stmt;
EXECUTE s_quotation_section_items_final_discount_col;
DEALLOCATE PREPARE s_quotation_section_items_final_discount_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN original_currency_code CHAR(3) NULL AFTER quantity',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'original_currency_code'
);
PREPARE s_quotation_section_items_original_currency_col FROM @stmt;
EXECUTE s_quotation_section_items_original_currency_col;
DEALLOCATE PREPARE s_quotation_section_items_original_currency_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN original_list_price_unit DECIMAL(15, 4) NULL AFTER original_currency_code',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'original_list_price_unit'
);
PREPARE s_quotation_section_items_original_list_price_col FROM @stmt;
EXECUTE s_quotation_section_items_original_list_price_col;
DEALLOCATE PREPARE s_quotation_section_items_original_list_price_col;

UPDATE quotation_section_items
SET original_currency_code = COALESCE(NULLIF(TRIM(original_currency_code), ''), 'USD'),
    original_list_price_unit = COALESCE(original_list_price_unit, list_price_unit)
WHERE original_currency_code IS NULL
   OR TRIM(original_currency_code) = ''
   OR original_list_price_unit IS NULL;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN item_type VARCHAR(40) NOT NULL DEFAULT ''producto'' AFTER product_description',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'item_type'
);
PREPARE s_quotation_section_items_item_type_col FROM @stmt;
EXECUTE s_quotation_section_items_item_type_col;
DEALLOCATE PREPARE s_quotation_section_items_item_type_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN bundle_parent_item_id BIGINT UNSIGNED NULL AFTER item_type',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'bundle_parent_item_id'
);
PREPARE s_quotation_section_items_bundle_parent_col FROM @stmt;
EXECUTE s_quotation_section_items_bundle_parent_col;
DEALLOCATE PREPARE s_quotation_section_items_bundle_parent_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN bundle_origin_type VARCHAR(40) NULL AFTER bundle_parent_item_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'bundle_origin_type'
);
PREPARE s_quotation_section_items_bundle_origin_col FROM @stmt;
EXECUTE s_quotation_section_items_bundle_origin_col;
DEALLOCATE PREPARE s_quotation_section_items_bundle_origin_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN source_provider_price_list_item_id BIGINT UNSIGNED NULL AFTER bundle_origin_type',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'source_provider_price_list_item_id'
);
PREPARE s_quotation_section_items_source_provider_col FROM @stmt;
EXECUTE s_quotation_section_items_source_provider_col;
DEALLOCATE PREPARE s_quotation_section_items_source_provider_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN source_component_price_list_item_id BIGINT UNSIGNED NULL AFTER source_provider_price_list_item_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'source_component_price_list_item_id'
);
PREPARE s_quotation_section_items_source_component_col FROM @stmt;
EXECUTE s_quotation_section_items_source_component_col;
DEALLOCATE PREPARE s_quotation_section_items_source_component_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD COLUMN bundle_sort_order INT UNSIGNED NULL AFTER display_order',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND COLUMN_NAME = 'bundle_sort_order'
);
PREPARE s_quotation_section_items_bundle_sort_col FROM @stmt;
EXECUTE s_quotation_section_items_bundle_sort_col;
DEALLOCATE PREPARE s_quotation_section_items_bundle_sort_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD INDEX idx_quotation_section_items_bundle_parent (bundle_parent_item_id, bundle_sort_order, display_order)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND INDEX_NAME = 'idx_quotation_section_items_bundle_parent'
);
PREPARE s_quotation_section_items_bundle_parent_idx FROM @stmt;
EXECUTE s_quotation_section_items_bundle_parent_idx;
DEALLOCATE PREPARE s_quotation_section_items_bundle_parent_idx;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD CONSTRAINT fk_quotation_section_items_bundle_parent FOREIGN KEY (bundle_parent_item_id) REFERENCES quotation_section_items(id) ON DELETE CASCADE',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND CONSTRAINT_NAME = 'fk_quotation_section_items_bundle_parent'
);
PREPARE s_quotation_section_items_bundle_parent_fk FROM @stmt;
EXECUTE s_quotation_section_items_bundle_parent_fk;
DEALLOCATE PREPARE s_quotation_section_items_bundle_parent_fk;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD CONSTRAINT fk_quotation_section_items_source_provider_price_item FOREIGN KEY (source_provider_price_list_item_id) REFERENCES provider_price_list_items(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND CONSTRAINT_NAME = 'fk_quotation_section_items_source_provider_price_item'
);
PREPARE s_quotation_section_items_source_provider_fk FROM @stmt;
EXECUTE s_quotation_section_items_source_provider_fk;
DEALLOCATE PREPARE s_quotation_section_items_source_provider_fk;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE quotation_section_items ADD CONSTRAINT fk_quotation_section_items_source_component_price_item FOREIGN KEY (source_component_price_list_item_id) REFERENCES provider_price_list_items(id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'quotation_section_items'
    AND CONSTRAINT_NAME = 'fk_quotation_section_items_source_component_price_item'
);
PREPARE s_quotation_section_items_source_component_fk FROM @stmt;
EXECUTE s_quotation_section_items_source_component_fk;
DEALLOCATE PREPARE s_quotation_section_items_source_component_fk;

CREATE TABLE IF NOT EXISTS quotation_action_permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  status_id BIGINT UNSIGNED NULL,
  action_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  is_allowed TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_quotation_action_permissions UNIQUE (status_id, action_id, permission_id),
  CONSTRAINT fk_qap_status FOREIGN KEY (status_id) REFERENCES quotation_statuses(id) ON DELETE CASCADE,
  CONSTRAINT fk_qap_action FOREIGN KEY (action_id) REFERENCES quotation_actions(id) ON DELETE CASCADE,
  CONSTRAINT fk_qap_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE opportunities ADD COLUMN commercial_status_id BIGINT UNSIGNED NULL AFTER activation_status_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND COLUMN_NAME = 'commercial_status_id'
);
PREPARE s_opportunities_commercial_status_col FROM @stmt;
EXECUTE s_opportunities_commercial_status_col;
DEALLOCATE PREPARE s_opportunities_commercial_status_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE opportunities ADD COLUMN commercial_closed_at DATETIME(3) NULL AFTER commercial_status_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND COLUMN_NAME = 'commercial_closed_at'
);
PREPARE s_opportunities_commercial_closed_at_col FROM @stmt;
EXECUTE s_opportunities_commercial_closed_at_col;
DEALLOCATE PREPARE s_opportunities_commercial_closed_at_col;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE opportunities ADD COLUMN commercial_close_reason TEXT NULL AFTER commercial_closed_at',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND COLUMN_NAME = 'commercial_close_reason'
);
PREPARE s_opportunities_commercial_close_reason_col FROM @stmt;
EXECUTE s_opportunities_commercial_close_reason_col;
DEALLOCATE PREPARE s_opportunities_commercial_close_reason_col;

CREATE TABLE IF NOT EXISTS opportunity_stage_questions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sales_stage_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(80) NOT NULL,
  prompt TEXT NOT NULL,
  response_type VARCHAR(40) NOT NULL,
  display_order TINYINT UNSIGNED NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT uq_opportunity_stage_questions_code UNIQUE (code),
  CONSTRAINT uq_opportunity_stage_questions_stage_order UNIQUE (sales_stage_id, display_order),
  CONSTRAINT fk_opportunity_stage_questions_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id)
);

CREATE TABLE IF NOT EXISTS opportunity_stage_question_answers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  sales_stage_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  question_code_snapshot VARCHAR(80) NOT NULL,
  question_prompt_snapshot TEXT NOT NULL,
  answer_value TEXT NULL,
  answered_by_user_id BIGINT UNSIGNED NULL,
  answered_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_opportunity_stage_answers_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_stage_answers_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id),
  CONSTRAINT fk_opportunity_stage_answers_question FOREIGN KEY (question_id) REFERENCES opportunity_stage_questions(id),
  CONSTRAINT fk_opportunity_stage_answers_user FOREIGN KEY (answered_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_opportunity_stage_answers_opportunity_stage (opportunity_id, sales_stage_id, answered_at),
  INDEX idx_opportunity_stage_answers_question (question_id, answered_at)
);

CREATE TABLE IF NOT EXISTS opportunity_document_upload_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL,
  entity_type VARCHAR(40) NOT NULL DEFAULT 'opportunity_draft',
  entity_id BIGINT UNSIGNED NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  expires_at DATETIME(3) NULL,
  CONSTRAINT uq_opp_doc_sessions_public_id UNIQUE (public_id),
  CONSTRAINT fk_opp_doc_sessions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_opp_doc_sessions_entity (entity_type, entity_id),
  INDEX idx_opp_doc_sessions_created_by (created_by_user_id, created_at)
);

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(64) NOT NULL,
  upload_session_id BIGINT UNSIGNED NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  storage_provider VARCHAR(30) NOT NULL,
  storage_bucket VARCHAR(120) NULL,
  storage_key VARCHAR(500) NOT NULL,
  original_file_name VARCHAR(255) NOT NULL,
  stored_file_name VARCHAR(255) NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_extension VARCHAR(20) NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  document_kind VARCHAR(40) NULL,
  source_label VARCHAR(120) NULL,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'uploaded',
  processing_error TEXT NULL,
  duration_seconds INT UNSIGNED NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_documents_public_id UNIQUE (public_id),
  CONSTRAINT fk_documents_upload_session FOREIGN KEY (upload_session_id) REFERENCES opportunity_document_upload_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id),
  INDEX idx_documents_session (upload_session_id),
  INDEX idx_documents_entity (entity_type, entity_id, created_at),
  INDEX idx_documents_processing (processing_status, created_at),
  INDEX idx_documents_sha (sha256)
);

CREATE TABLE IF NOT EXISTS document_contents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT UNSIGNED NOT NULL,
  extraction_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  transcription_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  detected_format VARCHAR(30) NULL,
  detected_language VARCHAR(20) NULL,
  page_count INT UNSIGNED NULL,
  duration_seconds INT UNSIGNED NULL,
  raw_text LONGTEXT NULL,
  normalized_text LONGTEXT NULL,
  structured_content_json JSON NULL,
  transcript_text LONGTEXT NULL,
  transcription_language VARCHAR(20) NULL,
  transcription_confidence DECIMAL(5,4) NULL,
  content_summary TEXT NULL,
  extracted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_document_contents_document UNIQUE (document_id),
  CONSTRAINT fk_document_contents_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  INDEX idx_document_contents_extraction (extraction_status, extracted_at),
  INDEX idx_document_contents_transcription (transcription_status, extracted_at)
);

CREATE TABLE IF NOT EXISTS document_analyses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT UNSIGNED NOT NULL,
  analysis_scope VARCHAR(40) NOT NULL DEFAULT 'opportunity_draft',
  pipeline_version VARCHAR(40) NOT NULL,
  model_provider VARCHAR(40) NULL,
  model_name VARCHAR(120) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  draft_fields_json JSON NULL,
  stage_suggestions_json JSON NULL,
  entities_json JSON NULL,
  warnings_json JSON NULL,
  confidence VARCHAR(10) NULL,
  evidence_json JSON NULL,
  error_message TEXT NULL,
  analyzed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT fk_document_analyses_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  INDEX idx_document_analyses_document_scope (document_id, analysis_scope),
  INDEX idx_document_analyses_status (status, analyzed_at)
);

CREATE TABLE IF NOT EXISTS document_match_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_analysis_id BIGINT UNSIGNED NOT NULL,
  match_target VARCHAR(40) NOT NULL,
  detected_label VARCHAR(255) NOT NULL,
  normalized_label VARCHAR(255) NULL,
  match_status VARCHAR(30) NOT NULL,
  selected_entity_id BIGINT UNSIGNED NULL,
  selected_entity_label VARCHAR(255) NULL,
  candidate_entities_json JSON NULL,
  confidence_score DECIMAL(5,4) NULL,
  reason TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT fk_document_match_results_analysis FOREIGN KEY (document_analysis_id) REFERENCES document_analyses(id) ON DELETE CASCADE,
  CONSTRAINT fk_document_match_results_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_document_match_results_scope (document_analysis_id, match_target),
  INDEX idx_document_match_results_status (match_status, reviewed_at)
);

CREATE TABLE IF NOT EXISTS opportunity_document_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  link_type VARCHAR(40) NOT NULL DEFAULT 'source_document',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_opportunity_document_links UNIQUE (opportunity_id, document_id, link_type),
  CONSTRAINT fk_opportunity_document_links_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_document_links_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_document_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_opportunity_document_links_document (document_id)
);

CREATE TABLE IF NOT EXISTS opportunity_stage_document_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  sales_stage_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  link_role VARCHAR(40) NOT NULL DEFAULT 'evidence',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_opportunity_stage_document_links UNIQUE (opportunity_id, sales_stage_id, document_id, link_role),
  CONSTRAINT fk_opportunity_stage_document_links_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_stage_document_links_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id),
  CONSTRAINT fk_opportunity_stage_document_links_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_stage_document_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS opportunity_stage_answer_document_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stage_answer_id BIGINT UNSIGNED NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  evidence_excerpt TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  CONSTRAINT uq_opportunity_stage_answer_document_sources UNIQUE (stage_answer_id, document_id),
  CONSTRAINT fk_opportunity_stage_answer_document_sources_answer FOREIGN KEY (stage_answer_id) REFERENCES opportunity_stage_question_answers(id) ON DELETE CASCADE,
  CONSTRAINT fk_opportunity_stage_answer_document_sources_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
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
    COUNT(*) = 0,
    'ALTER TABLE opportunities ADD CONSTRAINT fk_opportunities_commercial_status FOREIGN KEY (commercial_status_id) REFERENCES opportunity_commercial_statuses(id)',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND CONSTRAINT_NAME = 'fk_opportunities_commercial_status'
);
PREPARE s_opportunities_commercial_status_fk FROM @stmt;
EXECUTE s_opportunities_commercial_status_fk;
DEALLOCATE PREPARE s_opportunities_commercial_status_fk;

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
  ('configuracion.read', 'configuracion', 'read', 'Ver configuracion general', NOW(3), NOW(3)),
  ('configuracion.update', 'configuracion', 'update', 'Actualizar configuracion general', NOW(3), NOW(3)),
  ('cuentas.read', 'cuentas', 'read', 'Ver cuentas', NOW(3), NOW(3)),
  ('cuentas.read_all', 'cuentas', 'read_all', 'Ver todas las cuentas', NOW(3), NOW(3)),
  ('cuentas.create', 'cuentas', 'create', 'Crear cuentas', NOW(3), NOW(3)),
  ('cuentas.request', 'cuentas', 'request', 'Solicitar creacion de cuentas', NOW(3), NOW(3)),
  ('cuentas.update', 'cuentas', 'update', 'Actualizar cuentas', NOW(3), NOW(3)),
  ('interacciones.read', 'interacciones', 'read', 'Ver interacciones', NOW(3), NOW(3)),
  ('interacciones.read_all', 'interacciones', 'read_all', 'Ver todas las interacciones', NOW(3), NOW(3)),
  ('interacciones.create', 'interacciones', 'create', 'Crear interacciones', NOW(3), NOW(3)),
  ('interacciones.update', 'interacciones', 'update', 'Actualizar interacciones', NOW(3), NOW(3)),
  ('interacciones.analyze', 'interacciones', 'analyze', 'Analizar interacciones', NOW(3), NOW(3)),
  ('interacciones.resolve', 'interacciones', 'resolve', 'Resolver interacciones', NOW(3), NOW(3)),
  ('contactos.read', 'contactos', 'read', 'Ver contactos', NOW(3), NOW(3)),
  ('contactos.read_all', 'contactos', 'read_all', 'Ver todos los contactos', NOW(3), NOW(3)),
  ('contactos.create', 'contactos', 'create', 'Crear contactos', NOW(3), NOW(3)),
  ('contactos.request', 'contactos', 'request', 'Solicitar creacion de contactos', NOW(3), NOW(3)),
  ('contactos.update', 'contactos', 'update', 'Actualizar contactos', NOW(3), NOW(3)),
  ('proveedores.read', 'proveedores', 'read', 'Ver proveedores', NOW(3), NOW(3)),
  ('proveedores.create', 'proveedores', 'create', 'Crear proveedores', NOW(3), NOW(3)),
  ('proveedores.update', 'proveedores', 'update', 'Actualizar proveedores', NOW(3), NOW(3)),
  ('proveedores_precios.read', 'proveedores_precios', 'read', 'Ver listas de precios de proveedores', NOW(3), NOW(3)),
  ('proveedores_precios.create', 'proveedores_precios', 'create', 'Crear listas de precios de proveedores', NOW(3), NOW(3)),
  ('proveedores_precios.update', 'proveedores_precios', 'update', 'Actualizar listas de precios de proveedores', NOW(3), NOW(3)),
  ('oportunidades.read', 'oportunidades', 'read', 'Ver oportunidades', NOW(3), NOW(3)),
  ('oportunidades.read_all', 'oportunidades', 'read_all', 'Ver todas las oportunidades', NOW(3), NOW(3)),
  ('oportunidades.create', 'oportunidades', 'create', 'Crear oportunidades', NOW(3), NOW(3)),
  ('oportunidades.request', 'oportunidades', 'request', 'Solicitar creacion de oportunidades', NOW(3), NOW(3)),
  ('oportunidades.update', 'oportunidades', 'update', 'Actualizar oportunidades', NOW(3), NOW(3)),
  ('oportunidades_potenciales.read', 'oportunidades_potenciales', 'read', 'Ver oportunidades potenciales', NOW(3), NOW(3)),
  ('oportunidades_potenciales.read_all', 'oportunidades_potenciales', 'read_all', 'Ver todas las oportunidades potenciales', NOW(3), NOW(3)),
  ('oportunidades_potenciales.review', 'oportunidades_potenciales', 'review', 'Revisar y detectar oportunidades potenciales', NOW(3), NOW(3)),
  ('oportunidades_potenciales.assign', 'oportunidades_potenciales', 'assign', 'Asignar responsables en oportunidades potenciales', NOW(3), NOW(3)),
  ('oportunidades_potenciales.convert', 'oportunidades_potenciales', 'convert', 'Convertir oportunidades potenciales', NOW(3), NOW(3)),
  ('oportunidades_potenciales.analytics', 'oportunidades_potenciales', 'analytics', 'Consultar analitica de oportunidades potenciales', NOW(3), NOW(3)),
  ('cotizaciones.operacion', 'cotizaciones', 'operacion', 'Operacion de cotizaciones', NOW(3), NOW(3)),
  ('cotizaciones.revision', 'cotizaciones', 'revision', 'Revision de cotizaciones', NOW(3), NOW(3)),
  ('cotizaciones.ingreso', 'cotizaciones', 'ingreso', 'Ingreso de cotizaciones', NOW(3), NOW(3)),
  ('cotizaciones.administracion', 'cotizaciones', 'administracion', 'Administracion de cotizaciones', NOW(3), NOW(3)),
  ('cotizaciones.externo', 'cotizaciones', 'externo', 'Acceso externo a cotizaciones', NOW(3), NOW(3)),
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

INSERT INTO provider_activation_statuses (code, name, is_active) VALUES
  ('activado', 'Activado', 1),
  ('desactivado', 'Desactivado', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO provider_price_list_item_statuses (code, name, is_active) VALUES
  ('activo', 'Activo', 1),
  ('inactivo', 'Inactivo', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO product_types (code, name, description, sort_order, is_active) VALUES
  ('producto', 'Productos', 'Producto de proveedor con precio directo.', 1, 1),
  ('servicio_propio', 'Servicios Propios', 'Servicio propio con precio directo.', 2, 1),
  ('grupo_productos', 'Bundle', 'Item compuesto por otros productos o servicios activos.', 3, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

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
  ('ganada', 'Ganada', 8, 0)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  stage_order = VALUES(stage_order),
  is_active = VALUES(is_active);

INSERT INTO opportunity_commercial_statuses (code, name, is_active) VALUES
  ('en_proceso', 'En proceso', 1),
  ('ganada', 'Ganada', 1),
  ('perdida', 'Perdida', 1),
  ('anulada', 'Anulada', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO opportunity_activation_statuses (code, name, is_active) VALUES
  ('activada', 'Activada', 1),
  ('desactivada', 'Desactivada', 1),
  ('pendiente_activacion', 'Pendiente de activacion', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO quotation_activation_statuses (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('activada', 'Activada', 1, 1, NOW(3), NOW(3)),
  ('desactivada', 'Desactivada', 2, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_statuses (code, name, ui_key, display_order, is_active, created_at, updated_at) VALUES
  ('borrador', 'Borrador', 'draft', 1, 1, NOW(3), NOW(3)),
  ('en_aprobacion', 'En aprobacion', 'pending', 2, 1, NOW(3), NOW(3)),
  ('rechazada', 'Rechazada', 'rejected', 3, 1, NOW(3), NOW(3)),
  ('aprobada', 'Aprobada', 'approved', 4, 1, NOW(3), NOW(3)),
  ('enviada', 'Enviada', 'sent', 5, 1, NOW(3), NOW(3)),
  ('ganada', 'Ganada', 'won', 6, 1, NOW(3), NOW(3)),
  ('perdida', 'Perdida', 'lost', 7, 1, NOW(3), NOW(3)),
  ('anulada', 'Anulada', 'cancelled', 8, 1, NOW(3), NOW(3)),
  ('aceptada', 'Aceptada', 'accepted', 9, 1, NOW(3), NOW(3)),
  ('no_vigente', 'No vigente', 'inactive', 10, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  ui_key = VALUES(ui_key),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_actions (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('crear_cotizacion', 'Crear cotizacion', 1, 1, NOW(3), NOW(3)),
  ('crear_version', 'Crear version', 2, 1, NOW(3), NOW(3)),
  ('ver', 'Ver', 3, 1, NOW(3), NOW(3)),
  ('modificar', 'Modificar', 4, 1, NOW(3), NOW(3)),
  ('solicitar_aprobacion', 'Solicitar aprobacion', 5, 1, NOW(3), NOW(3)),
  ('declarar_ganada', 'Declarar ganada', 6, 1, NOW(3), NOW(3)),
  ('declarar_perdida', 'Declarar perdida', 7, 1, NOW(3), NOW(3)),
  ('declarar_anulada', 'Declarar anulada', 8, 1, NOW(3), NOW(3)),
  ('enviar', 'Enviar', 9, 1, NOW(3), NOW(3)),
  ('aprobar', 'Aprobar', 10, 1, NOW(3), NOW(3)),
  ('rechazar', 'Rechazar', 11, 1, NOW(3), NOW(3)),
  ('ponerla_borrador', 'Ponerla borrador', 12, 1, NOW(3), NOW(3)),
  ('aceptar', 'Aceptar', 13, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_section_inclusion_types (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('incluida', 'Incluida', 1, 1, NOW(3), NOW(3)),
  ('no_incluida', 'No incluida', 2, 1, NOW(3), NOW(3)),
  ('opcional', 'Opcional', 3, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_delivery_times (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('inmediato', 'Inmediato', 1, 1, NOW(3), NOW(3)),
  ('5_dias', '5 días', 2, 1, NOW(3), NOW(3)),
  ('10_dias', '10 días', 3, 1, NOW(3), NOW(3)),
  ('15_dias', '15 días', 4, 1, NOW(3), NOW(3)),
  ('30_dias', '30 días', 5, 1, NOW(3), NOW(3)),
  ('45_dias', '45 días', 6, 1, NOW(3), NOW(3)),
  ('60_dias', '60 días', 7, 1, NOW(3), NOW(3)),
  ('segun_notas', 'De acuerdo a lo indicado en notas', 8, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_validity_terms (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('5_dias', '5 días', 1, 1, NOW(3), NOW(3)),
  ('10_dias', '10 días', 2, 1, NOW(3), NOW(3)),
  ('15_dias', '15 días', 3, 1, NOW(3), NOW(3)),
  ('30_dias', '30 días', 4, 1, NOW(3), NOW(3)),
  ('45_dias', '45 días', 5, 1, NOW(3), NOW(3)),
  ('60_dias', '60 días', 6, 1, NOW(3), NOW(3)),
  ('segun_notas', 'De acuerdo a lo indicado en notas', 7, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_warranty_terms (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('1_ano', '1 año', 1, 1, NOW(3), NOW(3)),
  ('2_anos', '2 años', 2, 1, NOW(3), NOW(3)),
  ('3_anos', '3 años', 3, 1, NOW(3), NOW(3)),
  ('4_anos', '4 años', 4, 1, NOW(3), NOW(3)),
  ('5_anos', '5 años', 5, 1, NOW(3), NOW(3)),
  ('segun_notas', 'De acuerdo a lo indicado en notas', 6, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

INSERT INTO quotation_payment_terms (code, name, display_order, is_active, created_at, updated_at) VALUES
  ('100_adelantado', '100% adelantado', 1, 1, NOW(3), NOW(3)),
  ('50_adelantado_50_entrega', '50% adelantado - 50% contra entrega', 2, 1, NOW(3), NOW(3)),
  ('100_entrega', '100% contra entrega', 3, 1, NOW(3), NOW(3)),
  ('15_dias_facturado', '15 días despues de facturado', 4, 1, NOW(3), NOW(3)),
  ('30_dias_facturado', '30 días despues de facturado', 5, 1, NOW(3), NOW(3)),
  ('45_dias_facturado', '45 días despues de facturado', 6, 1, NOW(3), NOW(3)),
  ('60_dias_facturado', '60 días despues de facturado', 7, 1, NOW(3), NOW(3)),
  ('90_dias_facturado', '90 días despues de facturado', 8, 1, NOW(3), NOW(3)),
  ('segun_notas', 'De acuerdo a lo indicado en notas', 9, 1, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  updated_at = VALUES(updated_at);

DELETE qap
FROM quotation_action_permissions qap
INNER JOIN permissions p ON p.id = qap.permission_id
WHERE p.code LIKE 'cotizaciones.%';

INSERT INTO quotation_action_permissions (status_id, action_id, permission_id, is_allowed, created_at, updated_at)
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'modificar', 'solicitar_aprobacion', 'declarar_perdida', 'declarar_anulada')
INNER JOIN permissions p ON p.code = 'cotizaciones.operacion'
WHERE s.code = 'borrador'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code = 'cotizaciones.revision'
WHERE s.code = 'borrador'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'modificar', 'solicitar_aprobacion')
INNER JOIN permissions p ON p.code = 'cotizaciones.ingreso'
WHERE s.code = 'borrador'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code = 'cotizaciones.operacion'
WHERE s.code = 'en_aprobacion'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'modificar', 'aprobar', 'rechazar')
INNER JOIN permissions p ON p.code = 'cotizaciones.revision'
WHERE s.code = 'en_aprobacion'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'aprobar')
INNER JOIN permissions p ON p.code = 'cotizaciones.ingreso'
WHERE s.code = 'en_aprobacion'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'modificar', 'declarar_perdida', 'declarar_anulada')
INNER JOIN permissions p ON p.code = 'cotizaciones.operacion'
WHERE s.code = 'rechazada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code IN ('cotizaciones.revision', 'cotizaciones.ingreso')
WHERE s.code = 'rechazada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'declarar_ganada', 'enviar')
INNER JOIN permissions p ON p.code = 'cotizaciones.operacion'
WHERE s.code = 'aprobada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code = 'cotizaciones.revision'
WHERE s.code = 'aprobada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'declarar_ganada')
INNER JOIN permissions p ON p.code = 'cotizaciones.ingreso'
WHERE s.code = 'aprobada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code = 'cotizaciones.externo'
WHERE s.code = 'aprobada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'declarar_ganada', 'declarar_perdida', 'declarar_anulada')
INNER JOIN permissions p ON p.code = 'cotizaciones.operacion'
WHERE s.code = 'enviada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code IN ('cotizaciones.revision', 'cotizaciones.ingreso', 'cotizaciones.externo')
WHERE s.code = 'enviada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code IN ('cotizaciones.operacion', 'cotizaciones.revision')
WHERE s.code = 'ganada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver', 'ponerla_borrador', 'aceptar')
INNER JOIN permissions p ON p.code = 'cotizaciones.ingreso'
WHERE s.code = 'ganada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code = 'cotizaciones.externo'
WHERE s.code = 'ganada'
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code IN ('cotizaciones.operacion', 'cotizaciones.revision', 'cotizaciones.ingreso')
WHERE s.code IN ('perdida', 'anulada', 'aceptada', 'no_vigente')
UNION ALL
SELECT s.id, a.id, p.id, 1, NOW(3), NOW(3)
FROM quotation_statuses s
INNER JOIN quotation_actions a ON a.code IN ('ver')
INNER JOIN permissions p ON p.code = 'cotizaciones.externo'
WHERE s.code = 'aceptada';

UPDATE opportunities o
INNER JOIN opportunity_sales_stages won_stage ON won_stage.id = o.sales_stage_id AND won_stage.code = 'ganada'
INNER JOIN opportunity_sales_stages waiting_stage ON waiting_stage.code = 'waiting'
INNER JOIN opportunity_commercial_statuses won_status ON won_status.code = 'ganada'
SET o.sales_stage_id = waiting_stage.id,
    o.commercial_status_id = won_status.id,
    o.commercial_closed_at = COALESCE(o.commercial_closed_at, o.updated_at, o.created_at, NOW(3))
WHERE o.sales_stage_id = won_stage.id;

UPDATE opportunities o
INNER JOIN opportunity_commercial_statuses in_progress_status ON in_progress_status.code = 'en_proceso'
SET o.commercial_status_id = in_progress_status.id
WHERE o.commercial_status_id IS NULL;

SET @stmt := (
  SELECT IF(
    COUNT(*) = 1,
    'ALTER TABLE opportunities MODIFY COLUMN commercial_status_id BIGINT UNSIGNED NOT NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'opportunities'
    AND COLUMN_NAME = 'commercial_status_id'
    AND IS_NULLABLE = 'YES'
);
PREPARE s_opportunities_commercial_status_not_null FROM @stmt;
EXECUTE s_opportunities_commercial_status_not_null;
DEALLOCATE PREPARE s_opportunities_commercial_status_not_null;

INSERT INTO opportunity_stage_questions (sales_stage_id, code, prompt, response_type, display_order, is_required, is_active) VALUES
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'contacto_inicial' LIMIT 1), 'contacto_inicial_interes_cliente', '¿Qué necesidad, iniciativa, problema o interés concreto expresa el cliente que justifique abrir esta oportunidad?', 'long_text', 1, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_requerimiento_tecnico', '¿Qué requerimiento técnico, funcional, operativo o de integración solicita el cliente?', 'long_text', 1, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_motivacion_principal', '¿Cuál es el motivo de negocio principal detrás de este requerimiento y qué problema quiere resolver o qué resultado quiere lograr el cliente?', 'long_text', 2, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_presupuesto_cliente', '¿Qué se sabe del presupuesto del cliente, de sus restricciones presupuestales o de cómo conseguiría el presupuesto para este proyecto?', 'long_text', 3, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_fecha_adquisicion', '¿Cuál es la fecha objetivo para adquirir o implementar la solución, por qué debe cumplirse esa fecha y qué impacto tendría no hacerlo a tiempo?', 'long_text', 4, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_decisor_proceso_compra', '¿Quiénes participan en la decisión de compra y cómo es el proceso de aprobación o adquisición para esta oportunidad?', 'long_text', 5, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_ventajas_fortalezas', '¿Qué ventajas o fortalezas tenemos para esta oportunidad en función de las necesidades y prioridades del cliente?', 'long_text', 6, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'identificacion_oportunidad' LIMIT 1), 'identificacion_estrategia', '¿Qué estrategia comercial y técnica se seguirá para avanzar esta oportunidad con base en la información disponible?', 'long_text', 7, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_informacion_adicional', '¿Qué información adicional relevante se obtuvo en las reuniones o sesiones de desarrollo sobre alcance, necesidades, restricciones o prioridades?', 'long_text', 1, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_presentacion_solucion', '¿Cómo se presentó o explicó la solución técnica al cliente y cómo se relacionó con su problema o necesidad?', 'long_text', 2, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_propuesta', '¿Qué solución, alcance, arquitectura, servicio o alternativa se ha propuesto al cliente?', 'long_text', 3, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_puntos_tecnicos', '¿Cuáles son los puntos técnicos más importantes para el proyecto y cuáles son críticos para el éxito de la solución?', 'long_text', 4, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_aceptacion_propuesta', '¿Qué nivel de aceptación, validación o conformidad ha mostrado el cliente respecto de la propuesta técnica?', 'long_text', 5, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_observaciones_condiciones', '¿Qué observaciones, dudas, restricciones o condiciones indicó el cliente como requisito para aceptar o avanzar con la propuesta técnica?', 'long_text', 6, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'desarrollo' LIMIT 1), 'desarrollo_riesgo_tecnico', '¿Qué riesgos técnicos, dependencias, vacíos de información o factores de complejidad podrían afectar la solución o su implementación?', 'long_text', 7, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'cotizacion' LIMIT 1), 'cotizacion_propuesta_economica', '¿La propuesta económica se alinea con el presupuesto, rango esperado o expectativas del cliente para este proyecto?', 'long_text', 1, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'cotizacion' LIMIT 1), 'cotizacion_condiciones_comerciales', '¿Las condiciones comerciales de la propuesta coinciden con las necesidades del cliente para este proyecto?', 'long_text', 2, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'demostracion' LIMIT 1), 'demostracion_motivo', '¿Por qué el cliente solicitó o aceptó una demostración y qué quería validar?', 'long_text', 1, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'demostracion' LIMIT 1), 'demostracion_criterios_exito', '¿Cuáles son los criterios concretos de éxito o validación para considerar exitosa la demostración?', 'long_text', 2, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'demostracion' LIMIT 1), 'demostracion_siguientes_pasos', '¿Cuáles son los siguientes pasos esperados después de cumplir los criterios de éxito de la demostración?', 'long_text', 3, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'demostracion' LIMIT 1), 'demostracion_resultado', '¿Cuál fue el resultado de la demostración y cuál fue la reacción o conclusión del cliente?', 'long_text', 4, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'negociacion' LIMIT 1), 'negociacion_precio_condiciones', '¿Cuáles son el precio objetivo, los límites de negociación y las mejores condiciones que podrían aceptarse para cerrar con este cliente?', 'long_text', 1, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'negociacion' LIMIT 1), 'negociacion_puntos_cliente', '¿Cuáles son los puntos, condiciones o factores que el cliente valora más en esta negociación?', 'long_text', 2, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'negociacion' LIMIT 1), 'negociacion_puntos_nosotros', '¿Cuáles son los puntos más importantes que debemos proteger o priorizar nosotros en esta negociación?', 'long_text', 3, 1, 1),
  ((SELECT id FROM opportunity_sales_stages WHERE code = 'waiting' LIMIT 1), 'waiting_acuerdo_o_postores', '¿Se llegó a un acuerdo o el cliente sigue evaluando la decisión entre varios postores?', 'long_text', 1, 1, 1)
ON DUPLICATE KEY UPDATE
  sales_stage_id = VALUES(sales_stage_id),
  prompt = VALUES(prompt),
  response_type = VALUES(response_type),
  display_order = VALUES(display_order),
  is_required = VALUES(is_required),
  is_active = VALUES(is_active);

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

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW(3)
FROM roles r
JOIN permissions p ON p.code IN (
  'oportunidades_potenciales.read',
  'oportunidades_potenciales.convert'
)
WHERE LOWER(TRIM(r.name)) = 'vendedor'
ON DUPLICATE KEY UPDATE created_at = VALUES(created_at);

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW(3)
FROM roles r
JOIN permissions p ON p.code IN (
  'oportunidades_potenciales.read',
  'oportunidades_potenciales.read_all',
  'oportunidades_potenciales.review',
  'oportunidades_potenciales.assign',
  'oportunidades_potenciales.convert',
  'oportunidades_potenciales.analytics'
)
WHERE LOWER(TRIM(r.name)) IN (
  'gerente comercial',
  'gerente de ventas',
  'director comercial',
  'director de ventas',
  'lider comercial',
  'coordinador comercial',
  'jefe comercial'
)
ON DUPLICATE KEY UPDATE created_at = VALUES(created_at);
