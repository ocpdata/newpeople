import { query } from "../db.js";

let ensurePromise = null;

export async function ensureCommercialNarrativeJobSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS commercial_opportunity_narrative_jobs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          public_id VARCHAR(64) NOT NULL,
          opportunity_id BIGINT UNSIGNED NOT NULL,
          requested_by_user_id BIGINT UNSIGNED NOT NULL,
          status ENUM('pending','running','completed','failed','stale') NOT NULL DEFAULT 'pending',
          request_fingerprint CHAR(64) NOT NULL,
          source_snapshot_json JSON NULL,
          fallback_json JSON NULL,
          result_json JSON NULL,
          error_code VARCHAR(64) NULL,
          error_message TEXT NULL,
          attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
          lease_token VARCHAR(64) NULL,
          lease_expires_at DATETIME(3) NULL,
          started_at DATETIME(3) NULL,
          finished_at DATETIME(3) NULL,
          expires_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          UNIQUE KEY uq_commercial_narrative_jobs_public_id (public_id),
          KEY idx_commercial_narrative_jobs_lookup (opportunity_id, requested_by_user_id, created_at),
          KEY idx_commercial_narrative_jobs_process (status, lease_expires_at, created_at),
          CONSTRAINT fk_commercial_narrative_jobs_opportunity
            FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
            ON DELETE CASCADE,
          CONSTRAINT fk_commercial_narrative_jobs_requested_by
            FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
            ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })();
  }

  return ensurePromise;
}