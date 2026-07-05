import { query } from "../db.js";

let ensureCampaignEmailDispatchSchemaPromise;

const CAMPAIGN_EMAIL_DISPATCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS campaign_email_dispatches (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    campaign_id BIGINT UNSIGNED NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    subject VARCHAR(220) NOT NULL,
    preheader VARCHAR(300) NULL,
    html_content MEDIUMTEXT NOT NULL,
    batch_size INT UNSIGNED NOT NULL DEFAULT 50,
    max_sends_per_hour INT UNSIGNED NOT NULL DEFAULT 50,
    max_sends_per_day INT UNSIGNED NOT NULL DEFAULT 300,
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    started_at DATETIME(3) NULL,
    paused_at DATETIME(3) NULL,
    resumed_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    last_error_message TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_campaign_email_dispatches_public_id UNIQUE (public_id),
    INDEX idx_campaign_email_dispatches_status (status, updated_at),
    INDEX idx_campaign_email_dispatches_campaign (campaign_id, created_at),
    CONSTRAINT fk_campaign_email_dispatches_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
    CONSTRAINT fk_campaign_email_dispatches_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS campaign_email_dispatch_recipients (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    dispatch_id BIGINT UNSIGNED NOT NULL,
    email VARCHAR(190) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    lease_token VARCHAR(64) NULL,
    lease_expires_at DATETIME(3) NULL,
    next_retry_at DATETIME(3) NULL,
    sent_at DATETIME(3) NULL,
    last_error_message TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_campaign_email_dispatch_recipients_email UNIQUE (dispatch_id, email),
    INDEX idx_campaign_email_dispatch_recipients_status (dispatch_id, status, next_retry_at, id),
    INDEX idx_campaign_email_dispatch_recipients_lease (dispatch_id, lease_expires_at),
    INDEX idx_campaign_email_dispatch_recipients_sent (dispatch_id, sent_at),
    CONSTRAINT fk_campaign_email_dispatch_recipients_dispatch FOREIGN KEY (dispatch_id) REFERENCES campaign_email_dispatches(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function ensureCampaignEmailDispatchSchema() {
  if (!ensureCampaignEmailDispatchSchemaPromise) {
    ensureCampaignEmailDispatchSchemaPromise = (async () => {
      for (const statement of CAMPAIGN_EMAIL_DISPATCH_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureCampaignEmailDispatchSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureCampaignEmailDispatchSchemaPromise;
}
