import { query } from "../db.js";

let ensureProspectResearchSchemaPromise;

const PROSPECT_RESEARCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS prospect_research_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    company_name VARCHAR(190) NOT NULL,
    country VARCHAR(120) NOT NULL,
    website VARCHAR(500) NULL,
    industry VARCHAR(160) NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    request_json JSON NULL,
    result_json JSON NULL,
    chat_history_json JSON NULL,
    error_message VARCHAR(1000) NULL,
    converted_account_id BIGINT UNSIGNED NULL,
    external_researched_at DATETIME(3) NULL,
    discarded_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    finished_at DATETIME(3) NULL,
    CONSTRAINT uq_prospect_research_sessions_public UNIQUE (public_id),
    CONSTRAINT fk_prospect_research_sessions_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_sessions_converted_account FOREIGN KEY (converted_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    INDEX idx_prospect_research_sessions_requester (requested_by_user_id, status, updated_at),
    INDEX idx_prospect_research_sessions_company (company_name, country)
  )`,
  `CREATE TABLE IF NOT EXISTS prospect_research_findings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    category VARCHAR(60) NOT NULL,
    title VARCHAR(190) NOT NULL,
    summary TEXT NULL,
    evidence_text TEXT NULL,
    source_type VARCHAR(60) NOT NULL DEFAULT 'seller_input',
    source_reference VARCHAR(500) NULL,
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
    certainty VARCHAR(20) NOT NULL DEFAULT 'inferred',
    status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    metadata_json JSON NULL,
    validated_by_user_id BIGINT UNSIGNED NULL,
    validated_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_prospect_research_findings_public UNIQUE (public_id),
    CONSTRAINT fk_prospect_research_findings_session FOREIGN KEY (session_id) REFERENCES prospect_research_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_findings_validated_by FOREIGN KEY (validated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_prospect_research_findings_session (session_id, status)
  )`,
  `CREATE TABLE IF NOT EXISTS prospect_research_contacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(190) NULL,
    role_title VARCHAR(190) NOT NULL,
    area VARCHAR(160) NOT NULL,
    email VARCHAR(190) NULL,
    source_type VARCHAR(60) NOT NULL DEFAULT 'inferred_role',
    source_reference VARCHAR(500) NULL,
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_prospect_research_contacts_public UNIQUE (public_id),
    CONSTRAINT fk_prospect_research_contacts_session FOREIGN KEY (session_id) REFERENCES prospect_research_sessions(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_contacts_session (session_id, status)
  )`,
  `CREATE TABLE IF NOT EXISTS prospect_research_opportunity_hypotheses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(190) NOT NULL,
    business_challenge TEXT NULL,
    technology_area VARCHAR(160) NULL,
    target_area VARCHAR(160) NULL,
    suggested_contact_role VARCHAR(190) NULL,
    validation_question TEXT NULL,
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_prospect_research_hypotheses_public UNIQUE (public_id),
    CONSTRAINT fk_prospect_research_hypotheses_session FOREIGN KEY (session_id) REFERENCES prospect_research_sessions(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_hypotheses_session (session_id, status)
  )`,
];

export async function ensureProspectResearchSchema() {
  if (!ensureProspectResearchSchemaPromise) {
    ensureProspectResearchSchemaPromise = (async () => {
      for (const statement of PROSPECT_RESEARCH_SCHEMA_STATEMENTS) {
        await query(statement);
      }
      const columns = await query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'prospect_research_sessions'
           AND COLUMN_NAME IN ('external_researched_at', 'chat_history_json')`,
      );
      const existingColumns = new Set(
        columns.map((column) => column.COLUMN_NAME),
      );
      if (!existingColumns.has("external_researched_at")) {
        await query(
          "ALTER TABLE prospect_research_sessions ADD COLUMN external_researched_at DATETIME(3) NULL AFTER converted_account_id",
        );
      }
      if (!existingColumns.has("chat_history_json")) {
        await query(
          "ALTER TABLE prospect_research_sessions ADD COLUMN chat_history_json JSON NULL AFTER result_json",
        );
      }
    })().catch((error) => {
      ensureProspectResearchSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProspectResearchSchemaPromise;
}
