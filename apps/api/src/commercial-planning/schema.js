import { query } from "../db.js";

let ensureCommercialPlanningSchemaPromise;

const CREATE_PERIODS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_periods (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_year SMALLINT NOT NULL,
    plan_quarter TINYINT NOT NULL,
    base_currency_code VARCHAR(10) NOT NULL,
    status ENUM('draft', 'active', 'closed') NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    published_at DATETIME(3) NULL,
    published_by_user_id BIGINT UNSIGNED NULL,
    closed_at DATETIME(3) NULL,
    closed_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT uq_commercial_planning_period UNIQUE (plan_year, plan_quarter),
    CONSTRAINT fk_commercial_planning_period_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_period_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_period_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_period_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_commercial_planning_period_quarter CHECK (plan_quarter BETWEEN 1 AND 4)
  )
`;

const CREATE_VERSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    period_id BIGINT UNSIGNED NOT NULL,
    version_number INT NOT NULL,
    label VARCHAR(80) NOT NULL,
    status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    published_at DATETIME(3) NULL,
    published_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT uq_commercial_planning_version UNIQUE (period_id, version_number),
    CONSTRAINT fk_commercial_planning_version_period FOREIGN KEY (period_id) REFERENCES commercial_planning_periods(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_planning_version_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_version_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_version_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`;

const CREATE_TARGETS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_targets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    version_id BIGINT UNSIGNED NOT NULL,
    seller_user_id BIGINT UNSIGNED NOT NULL,
    sales_quota_amount DECIMAL(18,2) NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    expected_margin_percent DECIMAL(6,2) NOT NULL,
    expected_contribution_amount DECIMAL(18,2) NOT NULL,
    notes TEXT NULL,
    status ENUM('complete', 'incomplete', 'void') NOT NULL DEFAULT 'complete',
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT uq_commercial_planning_target UNIQUE (version_id, seller_user_id),
    CONSTRAINT fk_commercial_planning_target_version FOREIGN KEY (version_id) REFERENCES commercial_planning_versions(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_planning_target_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_commercial_planning_target_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_target_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`;

const CREATE_COMMISSION_CONFIGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_commission_configs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    period_id BIGINT UNSIGNED NOT NULL,
    seller_user_id BIGINT UNSIGNED NOT NULL,
    product_commission_pct DECIMAL(7,4) NOT NULL DEFAULT 0,
    service_commission_pct DECIMAL(7,4) NOT NULL DEFAULT 0,
    renewal_commission_pct DECIMAL(7,4) NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT uq_commercial_planning_commission_config UNIQUE (period_id, seller_user_id),
    CONSTRAINT fk_commercial_planning_commission_config_period FOREIGN KEY (period_id) REFERENCES commercial_planning_periods(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_planning_commission_config_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_commercial_planning_commission_config_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_commission_config_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`;

export async function ensureCommercialPlanningSchema() {
  if (!ensureCommercialPlanningSchemaPromise) {
    ensureCommercialPlanningSchemaPromise = (async () => {
      await query(CREATE_PERIODS_TABLE_SQL);
      await query(CREATE_VERSIONS_TABLE_SQL);
      await query(CREATE_TARGETS_TABLE_SQL);
      await query(CREATE_COMMISSION_CONFIGS_TABLE_SQL);
    })().finally(() => {
      ensureCommercialPlanningSchemaPromise = undefined;
    });
  }

  await ensureCommercialPlanningSchemaPromise;
}
