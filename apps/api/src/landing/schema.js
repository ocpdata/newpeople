import { query } from "../db.js";

let ensureLandingSchemaPromise;

async function columnExists(tableName, columnName) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  );
  return rows.length > 0;
}

const LANDING_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS landing_pages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_id BIGINT UNSIGNED NOT NULL,
    event_name VARCHAR(180) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    current_version_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_by BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_landing_pages_event UNIQUE (event_id),
    CONSTRAINT uq_landing_pages_slug UNIQUE (slug),
    INDEX idx_landing_pages_status (status),
    CONSTRAINT fk_landing_pages_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_landing_pages_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS landing_page_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    landing_page_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    source_type VARCHAR(40) NOT NULL,
    source_url VARCHAR(1000) NULL,
    html_content LONGTEXT NOT NULL,
    assets_manifest_json JSON NULL,
    form_schema_json JSON NOT NULL,
    publish_notes VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    published_by BIGINT UNSIGNED NULL,
    published_at DATETIME(3) NULL,
    CONSTRAINT uq_landing_page_versions_version UNIQUE (landing_page_id, version_number),
    INDEX idx_landing_page_versions_active (landing_page_id, is_active),
    CONSTRAINT fk_landing_versions_page FOREIGN KEY (landing_page_id) REFERENCES landing_pages(id) ON DELETE CASCADE,
    CONSTRAINT fk_landing_versions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_landing_versions_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS landing_submissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    landing_page_id BIGINT UNSIGNED NOT NULL,
    landing_version_id BIGINT UNSIGNED NOT NULL,
    event_id BIGINT UNSIGNED NOT NULL,
    submitted_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    ip_address VARCHAR(64) NOT NULL,
    user_agent VARCHAR(500) NULL,
    referrer_url VARCHAR(1000) NULL,
    idempotency_key VARCHAR(120) NULL,
    payload_raw_json JSON NOT NULL,
    payload_normalized_json JSON NOT NULL,
    validation_status VARCHAR(20) NOT NULL DEFAULT 'valid',
    crm_processing_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    crm_error_message VARCHAR(1000) NULL,
    crm_processed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    INDEX idx_landing_submissions_event_date (event_id, submitted_at),
    INDEX idx_landing_submissions_crm_status (crm_processing_status, submitted_at),
    UNIQUE KEY uq_landing_submissions_idempotency (landing_page_id, idempotency_key),
    CONSTRAINT fk_landing_submissions_page FOREIGN KEY (landing_page_id) REFERENCES landing_pages(id) ON DELETE CASCADE,
    CONSTRAINT fk_landing_submissions_version FOREIGN KEY (landing_version_id) REFERENCES landing_page_versions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS landing_submission_crm_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    submission_id BIGINT UNSIGNED NOT NULL,
    action_taken_json JSON NOT NULL,
    lead_id BIGINT UNSIGNED NULL,
    account_id BIGINT UNSIGNED NULL,
    contact_id BIGINT UNSIGNED NULL,
    processed_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    worker_run_id VARCHAR(80) NOT NULL,
    CONSTRAINT uq_landing_crm_submission UNIQUE (submission_id),
    CONSTRAINT fk_landing_crm_submission FOREIGN KEY (submission_id) REFERENCES landing_submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_landing_crm_lead FOREIGN KEY (lead_id) REFERENCES interactions(id) ON DELETE SET NULL,
    CONSTRAINT fk_landing_crm_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_landing_crm_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS landing_import_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    landing_page_id BIGINT UNSIGNED NOT NULL,
    source_url VARCHAR(1000) NOT NULL,
    fetched_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    html_hash CHAR(64) NOT NULL,
    import_status VARCHAR(20) NOT NULL,
    diagnostics_json JSON NULL,
    CONSTRAINT fk_landing_import_runs_page FOREIGN KEY (landing_page_id) REFERENCES landing_pages(id) ON DELETE CASCADE,
    INDEX idx_landing_import_runs_page (landing_page_id, fetched_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function ensureLandingSchema() {
  if (!ensureLandingSchemaPromise) {
    ensureLandingSchemaPromise = (async () => {
      for (const statement of LANDING_SCHEMA_STATEMENTS) {
        await query(statement);
      }

      await query(
        `ALTER TABLE landing_pages
         ADD CONSTRAINT fk_landing_pages_current_version
         FOREIGN KEY (current_version_id) REFERENCES landing_page_versions(id)
         ON DELETE SET NULL`,
      ).catch(() => {});

      if (!(await columnExists("interactions", "landing_submission_id"))) {
        await query(
          `ALTER TABLE interactions
           ADD COLUMN landing_submission_id BIGINT UNSIGNED NULL
           AFTER lead_execution_plan_json`,
        );
      }

      if (!(await columnExists("landing_pages", "confirmation_config_json"))) {
        await query(
          `ALTER TABLE landing_pages
           ADD COLUMN confirmation_config_json JSON NULL
           AFTER status`,
        );
      }
    })().catch((error) => {
      ensureLandingSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureLandingSchemaPromise;
}
