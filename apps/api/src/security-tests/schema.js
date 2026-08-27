import { query } from "../db.js";

let ensureSecurityTestSchemaPromise;

export async function ensureSecurityTestSchema() {
  if (!ensureSecurityTestSchemaPromise) {
    ensureSecurityTestSchemaPromise = query(`
      CREATE TABLE IF NOT EXISTS security_test_jobs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        public_id VARCHAR(80) NOT NULL,
        script_key VARCHAR(80) NOT NULL,
        profile_key VARCHAR(80) NOT NULL,
        status ENUM('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled') NOT NULL DEFAULT 'pending',
        requested_by_user_id BIGINT UNSIGNED NULL,
        options_json JSON NULL,
        result_json JSON NULL,
        progress_json JSON NULL,
        report_text LONGTEXT NULL,
        stdout_text MEDIUMTEXT NULL,
        stderr_text MEDIUMTEXT NULL,
        exit_code INT NULL,
        process_signal VARCHAR(40) NULL,
        error_code VARCHAR(80) NULL,
        error_message VARCHAR(500) NULL,
        started_at DATETIME(3) NULL,
        finished_at DATETIME(3) NULL,
        expires_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_security_test_jobs_public_id (public_id),
        KEY idx_security_test_jobs_status_created (status, created_at),
        KEY idx_security_test_jobs_requested_by (requested_by_user_id),
        CONSTRAINT fk_security_test_jobs_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `).then(async () => {
      await query(
        "ALTER TABLE security_test_jobs ADD COLUMN progress_json JSON NULL",
      ).catch((error) => {
        if (error?.code !== "ER_DUP_FIELDNAME") throw error;
      });
    }).catch((error) => {
      ensureSecurityTestSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureSecurityTestSchemaPromise;
}
