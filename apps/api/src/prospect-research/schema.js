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
    is_target TINYINT(1) NOT NULL DEFAULT 0,
    target_added_at DATETIME(3) NULL,
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
  `CREATE TABLE IF NOT EXISTS prospect_research_chat_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    request_json JSON NULL,
    result_json JSON NULL,
    error_message VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    finished_at DATETIME(3) NULL,
    CONSTRAINT uq_prospect_research_chat_jobs_public UNIQUE (public_id),
    CONSTRAINT fk_prospect_research_chat_jobs_session FOREIGN KEY (session_id) REFERENCES prospect_research_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_chat_jobs_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_chat_jobs_session (session_id, created_at),
    INDEX idx_prospect_research_chat_jobs_requester (requested_by_user_id, status, updated_at)
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
  `CREATE TABLE IF NOT EXISTS prospect_research_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    query_text VARCHAR(1000) NOT NULL,
    provider VARCHAR(60) NOT NULL DEFAULT 'tavily',
    finding_count INT UNSIGNED NOT NULL DEFAULT 0,
    contact_count INT UNSIGNED NOT NULL DEFAULT 0,
    hypothesis_count INT UNSIGNED NOT NULL DEFAULT 0,
    warnings_json JSON NULL,
    track_results_json JSON NULL,
    started_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    finished_at DATETIME(3) NULL,
    CONSTRAINT uq_prospect_research_runs_public UNIQUE (public_id),
    CONSTRAINT fk_prospect_research_runs_session FOREIGN KEY (session_id) REFERENCES prospect_research_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_runs_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_runs_session (session_id, started_at)
  )`,
  `CREATE TABLE IF NOT EXISTS prospect_research_run_findings (
    run_id BIGINT UNSIGNED NOT NULL,
    finding_id BIGINT UNSIGNED NOT NULL,
    observation_status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (run_id, finding_id),
    CONSTRAINT fk_prospect_research_run_findings_run FOREIGN KEY (run_id) REFERENCES prospect_research_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_run_findings_finding FOREIGN KEY (finding_id) REFERENCES prospect_research_findings(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_run_findings_finding (finding_id)
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
  `CREATE TABLE IF NOT EXISTS prospect_research_run_contacts (
    run_id BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NOT NULL,
    observation_status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (run_id, contact_id),
    CONSTRAINT fk_prospect_research_run_contacts_run FOREIGN KEY (run_id) REFERENCES prospect_research_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_run_contacts_contact FOREIGN KEY (contact_id) REFERENCES prospect_research_contacts(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_run_contacts_contact (contact_id)
  )`,
  `CREATE TABLE IF NOT EXISTS prospect_research_run_hypotheses (
    run_id BIGINT UNSIGNED NOT NULL,
    hypothesis_id BIGINT UNSIGNED NOT NULL,
    observation_status VARCHAR(20) NOT NULL DEFAULT 'new',
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (run_id, hypothesis_id),
    CONSTRAINT fk_prospect_research_run_hypotheses_run FOREIGN KEY (run_id) REFERENCES prospect_research_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_prospect_research_run_hypotheses_hypothesis FOREIGN KEY (hypothesis_id) REFERENCES prospect_research_opportunity_hypotheses(id) ON DELETE CASCADE,
    INDEX idx_prospect_research_run_hypotheses_hypothesis (hypothesis_id)
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
           AND COLUMN_NAME IN ('external_researched_at', 'chat_history_json', 'is_target', 'target_added_at')`,
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
      if (!existingColumns.has("is_target")) {
        await query(
          "ALTER TABLE prospect_research_sessions ADD COLUMN is_target TINYINT(1) NOT NULL DEFAULT 0 AFTER converted_account_id",
        );
      }
      if (!existingColumns.has("target_added_at")) {
        await query(
          "ALTER TABLE prospect_research_sessions ADD COLUMN target_added_at DATETIME(3) NULL AFTER is_target",
        );
      }
      const runColumns = await query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'prospect_research_runs'
           AND COLUMN_NAME IN ('track_results_json', 'contact_count', 'hypothesis_count')`,
      );
      const existingRunColumns = new Set(
        runColumns.map((column) => column.COLUMN_NAME),
      );
      if (!existingRunColumns.has("track_results_json")) {
        await query(
          "ALTER TABLE prospect_research_runs ADD COLUMN track_results_json JSON NULL AFTER warnings_json",
        );
      }
      if (!existingRunColumns.has("contact_count")) {
        await query(
          "ALTER TABLE prospect_research_runs ADD COLUMN contact_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER finding_count",
        );
      }
      if (!existingRunColumns.has("hypothesis_count")) {
        await query(
          "ALTER TABLE prospect_research_runs ADD COLUMN hypothesis_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER contact_count",
        );
      }
    })().catch((error) => {
      ensureProspectResearchSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProspectResearchSchemaPromise;
}
