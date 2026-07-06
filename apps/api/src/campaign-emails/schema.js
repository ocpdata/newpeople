import { query } from "../db.js";

let ensureCampaignEmailDispatchSchemaPromise;
let ensureCampaignEmailDispatchSchemaColumnsPromise;

const CAMPAIGN_EMAIL_DISPATCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS campaign_email_dispatches (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    campaign_id BIGINT UNSIGNED NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    subject VARCHAR(220) NOT NULL,
    preheader VARCHAR(300) NULL,
    cta_label VARCHAR(190) NULL,
    cta_url VARCHAR(2000) NULL,
    shared_document_public_id VARCHAR(64) NULL,
    shared_document_link_mode VARCHAR(30) NULL,
    shared_document_expires_days INT UNSIGNED NULL,
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
    contact_id BIGINT UNSIGNED NULL,
    account_id BIGINT UNSIGNED NULL,
    contact_name VARCHAR(190) NULL,
    account_name VARCHAR(190) NULL,
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
  `CREATE TABLE IF NOT EXISTS campaign_email_shared_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    campaign_id BIGINT UNSIGNED NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    source_type VARCHAR(30) NOT NULL,
    title VARCHAR(190) NOT NULL,
    description TEXT NULL,
    mime_type VARCHAR(160) NULL,
    original_file_name VARCHAR(255) NULL,
    byte_size BIGINT UNSIGNED NULL,
    storage_provider VARCHAR(30) NULL,
    storage_bucket VARCHAR(120) NULL,
    storage_key VARCHAR(500) NULL,
    library_asset_public_id VARCHAR(64) NULL,
    library_file_public_id VARCHAR(64) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_campaign_email_shared_documents_public UNIQUE (public_id),
    CONSTRAINT fk_campaign_email_shared_documents_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
    CONSTRAINT fk_campaign_email_shared_documents_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    INDEX idx_campaign_email_shared_documents_campaign (campaign_id, created_at),
    INDEX idx_campaign_email_shared_documents_source (source_type, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS campaign_email_share_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    shared_document_id BIGINT UNSIGNED NOT NULL,
    dispatch_id BIGINT UNSIGNED NULL,
    dispatch_recipient_id BIGINT UNSIGNED NULL,
    share_mode VARCHAR(30) NOT NULL DEFAULT 'general',
    recipient_email VARCHAR(190) NULL,
    contact_id BIGINT UNSIGNED NULL,
    account_id BIGINT UNSIGNED NULL,
    contact_name VARCHAR(190) NULL,
    account_name VARCHAR(190) NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    first_accessed_at DATETIME(3) NULL,
    last_accessed_at DATETIME(3) NULL,
    access_count INT UNSIGNED NOT NULL DEFAULT 0,
    download_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_campaign_email_share_links_public UNIQUE (public_id),
    CONSTRAINT uq_campaign_email_share_links_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_campaign_email_share_links_document FOREIGN KEY (shared_document_id) REFERENCES campaign_email_shared_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_email_share_links_dispatch FOREIGN KEY (dispatch_id) REFERENCES campaign_email_dispatches(id) ON DELETE SET NULL,
    CONSTRAINT fk_campaign_email_share_links_dispatch_recipient FOREIGN KEY (dispatch_recipient_id) REFERENCES campaign_email_dispatch_recipients(id) ON DELETE SET NULL,
    INDEX idx_campaign_email_share_links_dispatch (dispatch_id, dispatch_recipient_id),
    INDEX idx_campaign_email_share_links_document (shared_document_id, expires_at),
    INDEX idx_campaign_email_share_links_recipient (recipient_email, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function ensureColumnExists({ tableName, columnName, alterSql }) {
  const rows = await query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName],
  );

  if (!rows.length) {
    await query(alterSql);
  }
}

export async function ensureCampaignEmailDispatchSchema() {
  if (!ensureCampaignEmailDispatchSchemaPromise) {
    ensureCampaignEmailDispatchSchemaPromise = (async () => {
      for (const statement of CAMPAIGN_EMAIL_DISPATCH_SCHEMA_STATEMENTS) {
        await query(statement);
      }

      if (!ensureCampaignEmailDispatchSchemaColumnsPromise) {
        ensureCampaignEmailDispatchSchemaColumnsPromise = (async () => {
          await ensureColumnExists({
            tableName: "campaign_email_dispatch_recipients",
            columnName: "contact_id",
            alterSql:
              "ALTER TABLE campaign_email_dispatch_recipients ADD COLUMN contact_id BIGINT UNSIGNED NULL AFTER email",
          });
          await ensureColumnExists({
            tableName: "campaign_email_dispatch_recipients",
            columnName: "account_id",
            alterSql:
              "ALTER TABLE campaign_email_dispatch_recipients ADD COLUMN account_id BIGINT UNSIGNED NULL AFTER contact_id",
          });
          await ensureColumnExists({
            tableName: "campaign_email_dispatch_recipients",
            columnName: "contact_name",
            alterSql:
              "ALTER TABLE campaign_email_dispatch_recipients ADD COLUMN contact_name VARCHAR(190) NULL AFTER account_id",
          });
          await ensureColumnExists({
            tableName: "campaign_email_dispatch_recipients",
            columnName: "account_name",
            alterSql:
              "ALTER TABLE campaign_email_dispatch_recipients ADD COLUMN account_name VARCHAR(190) NULL AFTER contact_name",
          });
        })().catch((error) => {
          ensureCampaignEmailDispatchSchemaColumnsPromise = undefined;
          throw error;
        });
      }

      await ensureCampaignEmailDispatchSchemaColumnsPromise;

      await ensureColumnExists({
        tableName: "campaign_email_dispatches",
        columnName: "cta_label",
        alterSql:
          "ALTER TABLE campaign_email_dispatches ADD COLUMN cta_label VARCHAR(190) NULL AFTER preheader",
      });
      await ensureColumnExists({
        tableName: "campaign_email_dispatches",
        columnName: "cta_url",
        alterSql:
          "ALTER TABLE campaign_email_dispatches ADD COLUMN cta_url VARCHAR(2000) NULL AFTER cta_label",
      });
      await ensureColumnExists({
        tableName: "campaign_email_dispatches",
        columnName: "shared_document_public_id",
        alterSql:
          "ALTER TABLE campaign_email_dispatches ADD COLUMN shared_document_public_id VARCHAR(64) NULL AFTER cta_url",
      });
      await ensureColumnExists({
        tableName: "campaign_email_dispatches",
        columnName: "shared_document_link_mode",
        alterSql:
          "ALTER TABLE campaign_email_dispatches ADD COLUMN shared_document_link_mode VARCHAR(30) NULL AFTER shared_document_public_id",
      });
      await ensureColumnExists({
        tableName: "campaign_email_dispatches",
        columnName: "shared_document_expires_days",
        alterSql:
          "ALTER TABLE campaign_email_dispatches ADD COLUMN shared_document_expires_days INT UNSIGNED NULL AFTER shared_document_link_mode",
      });
    })().catch((error) => {
      ensureCampaignEmailDispatchSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureCampaignEmailDispatchSchemaPromise;
}
