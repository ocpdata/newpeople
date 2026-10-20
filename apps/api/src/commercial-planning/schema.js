import { query } from "../db.js";

let ensureCommercialPlanningSchemaPromise;

const CREATE_PERIODS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_periods (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plan_year SMALLINT NOT NULL,
    plan_quarter TINYINT NOT NULL,
    base_currency_code VARCHAR(10) NOT NULL,
    status ENUM('active') NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT uq_commercial_planning_period UNIQUE (plan_year, plan_quarter),
    CONSTRAINT fk_commercial_planning_period_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_period_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_commercial_planning_period_quarter CHECK (plan_quarter BETWEEN 1 AND 4)
  )
`;

const CREATE_PERIOD_TARGETS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_period_targets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    period_id BIGINT UNSIGNED NOT NULL,
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
    CONSTRAINT uq_commercial_planning_period_target UNIQUE (period_id, seller_user_id),
    CONSTRAINT fk_commercial_planning_period_target_period FOREIGN KEY (period_id) REFERENCES commercial_planning_periods(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_planning_period_target_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_commercial_planning_period_target_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_period_target_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`;

async function migrateLegacyPlanningTargets() {
  const legacyVersions = await query(
    "SHOW TABLES LIKE 'commercial_planning_versions'",
  );
  const legacyTargets = await query(
    "SHOW TABLES LIKE 'commercial_planning_targets'",
  );
  if (legacyVersions.length && legacyTargets.length) {
    const legacyTargetColumns = await query(
      "SHOW COLUMNS FROM commercial_planning_targets LIKE 'version_id'",
    );
    if (legacyTargetColumns.length) {
      await query(`
        INSERT IGNORE INTO commercial_planning_period_targets
          (period_id, seller_user_id, sales_quota_amount, currency_code,
           expected_margin_percent, expected_contribution_amount, notes, status,
           created_by_user_id, updated_by_user_id, created_at, updated_at)
        SELECT selected.period_id, target.seller_user_id, target.sales_quota_amount,
               target.currency_code, target.expected_margin_percent,
               target.expected_contribution_amount, target.notes, target.status,
               target.created_by_user_id, target.updated_by_user_id,
               target.created_at, target.updated_at
        FROM (
          SELECT period.id AS period_id,
                 COALESCE(
                   (SELECT active_version.id
                    FROM commercial_planning_versions active_version
                    WHERE active_version.period_id = period.id
                      AND active_version.status = 'active'
                    ORDER BY active_version.version_number DESC, active_version.id DESC
                    LIMIT 1),
                   (SELECT latest_version.id
                    FROM commercial_planning_versions latest_version
                    WHERE latest_version.period_id = period.id
                    ORDER BY latest_version.version_number DESC, latest_version.id DESC
                    LIMIT 1)
                 ) AS version_id
          FROM commercial_planning_periods period
        ) selected
        INNER JOIN commercial_planning_targets target
          ON target.version_id = selected.version_id
        WHERE selected.version_id IS NOT NULL
      `);
      await query("DROP TABLE commercial_planning_targets");
    }
  }
  if (legacyVersions.length) {
    await query("DROP TABLE commercial_planning_versions");
  }
}

async function migrateLegacyPeriodState() {
  const columnRows = await query("SHOW COLUMNS FROM commercial_planning_periods");
  const columns = new Map(columnRows.map((column) => [column.Field, column]));
  const statusType = String(columns.get("status")?.Type || "").toLowerCase();
  if (statusType !== "enum('active')") {
    await query(
      "UPDATE commercial_planning_periods SET status = 'active' WHERE status <> 'active'",
    );
    await query(
      "ALTER TABLE commercial_planning_periods MODIFY COLUMN status ENUM('active') NOT NULL DEFAULT 'active'",
    );
  }
  if (columns.has("closed_by_user_id")) {
    try {
      await query(
        "ALTER TABLE commercial_planning_periods DROP FOREIGN KEY fk_commercial_planning_period_closed_by",
      );
    } catch (error) {
      if (Number(error?.errno) !== 1091) throw error;
    }
    await query(
      "ALTER TABLE commercial_planning_periods DROP COLUMN closed_by_user_id",
    );
  }
  if (columns.has("closed_at")) {
    await query(
      "ALTER TABLE commercial_planning_periods DROP COLUMN closed_at",
    );
  }
  if (columns.has("published_by_user_id")) {
    try {
      await query(
        "ALTER TABLE commercial_planning_periods DROP FOREIGN KEY fk_commercial_planning_period_published_by",
      );
    } catch (error) {
      if (Number(error?.errno) !== 1091) throw error;
    }
    await query(
      "ALTER TABLE commercial_planning_periods DROP COLUMN published_by_user_id",
    );
  }
  if (columns.has("published_at")) {
    await query(
      "ALTER TABLE commercial_planning_periods DROP COLUMN published_at",
    );
  }
}

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

const CREATE_SELLER_PARAMETERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS commercial_planning_seller_parameters (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    seller_user_id BIGINT UNSIGNED NOT NULL,
    average_sale_ticket_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    leads_to_opportunities_ratio DECIMAL(9,4) NOT NULL DEFAULT 0,
    opportunities_to_wins_ratio DECIMAL(9,4) NOT NULL DEFAULT 0,
    average_opportunity_to_win_days DECIMAL(9,2) NOT NULL DEFAULT 0,
    use_hist_avg_ticket_quota_prob TINYINT(1) NOT NULL DEFAULT 0,
    use_hist_l2o_quota_prob TINYINT(1) NOT NULL DEFAULT 0,
    use_hist_o2w_quota_prob TINYINT(1) NOT NULL DEFAULT 0,
    use_hist_avg_o2w_days_quota_prob TINYINT(1) NOT NULL DEFAULT 0,
    use_historical_values_for_quota_probability TINYINT(1) NOT NULL DEFAULT 0,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT uq_commercial_planning_seller_parameters UNIQUE (seller_user_id),
    CONSTRAINT fk_commercial_planning_seller_parameters_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_commercial_planning_seller_parameters_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_planning_seller_parameters_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`;

const ADD_SELLER_PARAMETERS_TOGGLE_COLUMN_SQL = `
  ALTER TABLE commercial_planning_seller_parameters
  ADD COLUMN use_historical_values_for_quota_probability TINYINT(1) NOT NULL DEFAULT 0
`;

const ADD_SELLER_PARAMETERS_TICKET_TOGGLE_COLUMN_SQL = `
  ALTER TABLE commercial_planning_seller_parameters
  ADD COLUMN use_hist_avg_ticket_quota_prob TINYINT(1) NOT NULL DEFAULT 0
`;

const ADD_SELLER_PARAMETERS_L2O_TOGGLE_COLUMN_SQL = `
  ALTER TABLE commercial_planning_seller_parameters
  ADD COLUMN use_hist_l2o_quota_prob TINYINT(1) NOT NULL DEFAULT 0
`;

const ADD_SELLER_PARAMETERS_O2W_TOGGLE_COLUMN_SQL = `
  ALTER TABLE commercial_planning_seller_parameters
  ADD COLUMN use_hist_o2w_quota_prob TINYINT(1) NOT NULL DEFAULT 0
`;

const ADD_SELLER_PARAMETERS_O2W_DAYS_TOGGLE_COLUMN_SQL = `
  ALTER TABLE commercial_planning_seller_parameters
  ADD COLUMN use_hist_avg_o2w_days_quota_prob TINYINT(1) NOT NULL DEFAULT 0
`;

export async function ensureCommercialPlanningSchema() {
  if (!ensureCommercialPlanningSchemaPromise) {
    ensureCommercialPlanningSchemaPromise = (async () => {
      await query(CREATE_PERIODS_TABLE_SQL);
      await query(CREATE_PERIOD_TARGETS_TABLE_SQL);
      await migrateLegacyPlanningTargets();
      await migrateLegacyPeriodState();
      await query(CREATE_COMMISSION_CONFIGS_TABLE_SQL);
      await query(CREATE_SELLER_PARAMETERS_TABLE_SQL);
      try {
        await query(ADD_SELLER_PARAMETERS_TOGGLE_COLUMN_SQL);
      } catch (error) {
        if (String(error?.code || "") !== "ER_DUP_FIELDNAME") {
          throw error;
        }
      }
      for (const alterSql of [
        ADD_SELLER_PARAMETERS_TICKET_TOGGLE_COLUMN_SQL,
        ADD_SELLER_PARAMETERS_L2O_TOGGLE_COLUMN_SQL,
        ADD_SELLER_PARAMETERS_O2W_TOGGLE_COLUMN_SQL,
        ADD_SELLER_PARAMETERS_O2W_DAYS_TOGGLE_COLUMN_SQL,
      ]) {
        try {
          await query(alterSql);
        } catch (error) {
          if (String(error?.code || "") !== "ER_DUP_FIELDNAME") {
            throw error;
          }
        }
      }
    })().finally(() => {
      ensureCommercialPlanningSchemaPromise = undefined;
    });
  }

  await ensureCommercialPlanningSchemaPromise;
}
