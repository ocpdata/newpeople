import { query } from "../db.js";

let ensureCommercialExecutionSchemaPromise;

const COMMERCIAL_EXECUTION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS commercial_execution_cadences (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    cadence_type VARCHAR(80) NOT NULL,
    title VARCHAR(180) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    current_step_index INT UNSIGNED NOT NULL DEFAULT 0,
    steps_json JSON NOT NULL,
    next_run_at DATETIME(3) NULL,
    last_executed_at DATETIME(3) NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_execution_cadences_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_execution_cadences_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_execution_cadences_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_commercial_execution_cadences_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_commercial_execution_cadences_status (opportunity_id, status, next_run_at)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_execution_dependencies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    dependency_type VARCHAR(80) NOT NULL,
    title VARCHAR(180) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    owner_user_id BIGINT UNSIGNED NULL,
    due_date DATETIME(3) NULL,
    expected_outcome TEXT NULL,
    details TEXT NULL,
    resolution_note TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_execution_dependencies_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_execution_dependencies_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_execution_dependencies_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_commercial_execution_dependencies_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_commercial_execution_dependencies_status (opportunity_id, status, due_date)
  )`,
];

export async function ensureCommercialExecutionSchema() {
  if (!ensureCommercialExecutionSchemaPromise) {
    ensureCommercialExecutionSchemaPromise = (async () => {
      for (const statement of COMMERCIAL_EXECUTION_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureCommercialExecutionSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureCommercialExecutionSchemaPromise;
}
