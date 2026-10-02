import { query } from "../db.js";

let ensureCommercialIntelligenceSchemaPromise;

const COMMERCIAL_INTELLIGENCE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS customer_intelligence_chat_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NULL,
    opportunity_id BIGINT UNSIGNED NULL,
    contact_id BIGINT UNSIGNED NULL,
    history_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_customer_intelligence_chat_sessions_public UNIQUE (public_id),
    CONSTRAINT fk_customer_intelligence_chat_sessions_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_customer_intelligence_chat_sessions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_chat_sessions_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_chat_sessions_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    INDEX idx_customer_intelligence_chat_sessions_scope (requested_by_user_id, account_id, opportunity_id, contact_id, updated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_intelligence_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    account_id BIGINT UNSIGNED NULL,
    opportunity_id BIGINT UNSIGNED NULL,
    contact_id BIGINT UNSIGNED NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    job_type VARCHAR(40) NOT NULL DEFAULT 'customer_research',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    request_json JSON NULL,
    result_json JSON NULL,
    error_message VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    finished_at DATETIME(3) NULL,
    CONSTRAINT uq_customer_intelligence_jobs_public UNIQUE (public_id),
    CONSTRAINT fk_customer_intelligence_jobs_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_jobs_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_jobs_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_jobs_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_customer_intelligence_jobs_requester (requested_by_user_id, status, updated_at),
    INDEX idx_customer_intelligence_jobs_account (account_id, updated_at),
    INDEX idx_customer_intelligence_jobs_opportunity (opportunity_id, updated_at),
    INDEX idx_customer_intelligence_jobs_contact (contact_id, updated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_intelligence_findings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    job_id BIGINT UNSIGNED NULL,
    account_id BIGINT UNSIGNED NULL,
    opportunity_id BIGINT UNSIGNED NULL,
    contact_id BIGINT UNSIGNED NULL,
    category VARCHAR(60) NOT NULL,
    title VARCHAR(190) NOT NULL,
    summary TEXT NULL,
    evidence_text TEXT NULL,
    source_type VARCHAR(60) NOT NULL DEFAULT 'crm',
    source_reference VARCHAR(500) NULL,
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
    certainty VARCHAR(20) NOT NULL DEFAULT 'inferred',
    status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    metadata_json JSON NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    validated_by_user_id BIGINT UNSIGNED NULL,
    validated_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_customer_intelligence_findings_public UNIQUE (public_id),
    CONSTRAINT fk_customer_intelligence_findings_job FOREIGN KEY (job_id) REFERENCES customer_intelligence_jobs(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_findings_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_findings_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_findings_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_findings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_customer_intelligence_findings_validated_by FOREIGN KEY (validated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_customer_intelligence_findings_account (account_id, status, updated_at),
    INDEX idx_customer_intelligence_findings_opportunity (opportunity_id, status, updated_at),
    INDEX idx_customer_intelligence_findings_contact (contact_id, status, updated_at),
    INDEX idx_customer_intelligence_findings_job (job_id)
  )`,
  `CREATE TABLE IF NOT EXISTS mi_coach_governance_settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    singleton_key VARCHAR(40) NOT NULL,
    settings_json JSON NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_mi_coach_governance_singleton UNIQUE (singleton_key),
    CONSTRAINT fk_mi_coach_governance_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
];

export async function ensureCommercialIntelligenceSchema() {
  if (!ensureCommercialIntelligenceSchemaPromise) {
    ensureCommercialIntelligenceSchemaPromise = (async () => {
      for (const statement of COMMERCIAL_INTELLIGENCE_SCHEMA_STATEMENTS) {
        await query(statement);
      }
      await query(
        `INSERT INTO mi_coach_governance_settings
          (singleton_key, settings_json, updated_by_user_id, created_at, updated_at)
         SELECT 'default', ?, NULL, NOW(3), NOW(3)
         WHERE NOT EXISTS (
           SELECT 1 FROM mi_coach_governance_settings WHERE singleton_key = 'default'
         )`,
        [
          JSON.stringify({
            externalSourcesEnabled: false,
            includeWonOpportunities: true,
            includeLostOpportunities: true,
            includeCancelledOpportunities: false,
            dailyResearchLimitPerUser: 25,
            findingRetentionDays: 365,
            requireEvidenceForExternalFindings: true,
            allowProspectConversion: true,
            qualifiedOpportunityStageCodes: [
              "desarrollo",
              "cotizacion",
              "demostracion",
              "negociacion",
              "waiting",
            ],
            committedOpportunityStageCodes: ["negociacion", "waiting"],
            notes: "Configuracion inicial de gobierno de Mi Coach",
          }),
        ],
      );
    })().catch((error) => {
      ensureCommercialIntelligenceSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureCommercialIntelligenceSchemaPromise;
}
