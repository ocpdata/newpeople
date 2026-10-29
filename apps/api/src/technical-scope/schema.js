import { query } from "../db.js";
import { ensureProposalDocumentSchema } from "../proposal-documents/schema.js";

let ensureTechnicalScopeSchemaPromise;

const TECHNICAL_SCOPE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tech_playbooks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    manufacturer VARCHAR(80) NOT NULL DEFAULT '',
    rag_topic_name VARCHAR(160) NOT NULL DEFAULT '',
    detection_keywords_json TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'borrador_ia',
    origin VARCHAR(30) NOT NULL DEFAULT 'seed',
    current_version_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_tech_playbooks_code UNIQUE (code),
    INDEX idx_tech_playbooks_status (status, name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tech_playbook_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    playbook_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'borrador_ia',
    content_json LONGTEXT NOT NULL,
    source_notes TEXT NULL,
    generated_by VARCHAR(40) NOT NULL DEFAULT 'manual',
    created_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_tech_playbook_versions UNIQUE (playbook_id, version_number),
    CONSTRAINT fk_tech_playbook_versions_playbook FOREIGN KEY (playbook_id) REFERENCES tech_playbooks(id) ON DELETE CASCADE,
    CONSTRAINT fk_tech_playbook_versions_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tech_playbook_suggestions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    playbook_id BIGINT UNSIGNED NOT NULL,
    proposal_document_id BIGINT UNSIGNED NULL,
    kind VARCHAR(40) NOT NULL,
    subject_code VARCHAR(120) NOT NULL DEFAULT '',
    detail_json LONGTEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_tech_playbook_suggestions_playbook FOREIGN KEY (playbook_id) REFERENCES tech_playbooks(id) ON DELETE CASCADE,
    INDEX idx_tech_playbook_suggestions (playbook_id, status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS opportunity_technical_answers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    playbook_code VARCHAR(80) NOT NULL,
    question_code VARCHAR(120) NOT NULL,
    value_json LONGTEXT NULL,
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_ref VARCHAR(500) NULL,
    confidence DECIMAL(4,3) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_technical_answers UNIQUE (opportunity_id, playbook_code, question_code),
    CONSTRAINT fk_opportunity_technical_answers_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_technical_answers_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS opportunity_technical_answer_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    playbook_code VARCHAR(80) NOT NULL,
    question_code VARCHAR(120) NOT NULL,
    previous_value_json LONGTEXT NULL,
    new_value_json LONGTEXT NULL,
    source_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    INDEX idx_opportunity_technical_answer_history (opportunity_id, playbook_code, question_code, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS opportunity_document_tech_extractions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    document_public_id VARCHAR(64) NOT NULL,
    document_name VARCHAR(255) NOT NULL DEFAULT '',
    detected_kind VARCHAR(40) NOT NULL DEFAULT 'unknown',
    facts_json LONGTEXT NULL,
    topology_json LONGTEXT NULL,
    redaction_json TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    error_message TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_document_tech_extractions_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    INDEX idx_opportunity_document_tech_extractions (opportunity_id, document_public_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS proposal_technical_scopes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    proposal_document_id BIGINT UNSIGNED NOT NULL,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    quotation_version_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    playbook_codes_json TEXT NULL,
    profile_snapshot_json LONGTEXT NULL,
    sections_json LONGTEXT NULL,
    topology_json LONGTEXT NULL,
    asis_topology_json LONGTEXT NULL,
    content_hash CHAR(64) NULL,
    approved_hash CHAR(64) NULL,
    requested_by_user_id BIGINT UNSIGNED NULL,
    requested_at DATETIME(3) NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME(3) NULL,
    approval_checklist_json TEXT NULL,
    approval_comment VARCHAR(1000) NULL,
    self_approved TINYINT(1) NOT NULL DEFAULT 0,
    last_edited_by_user_id BIGINT UNSIGNED NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_proposal_technical_scopes_document UNIQUE (proposal_document_id),
    CONSTRAINT fk_ptscope_document FOREIGN KEY (proposal_document_id) REFERENCES proposal_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_ptscope_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    INDEX idx_proposal_technical_scopes_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS proposal_technical_scope_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scope_id BIGINT UNSIGNED NOT NULL,
    document_type VARCHAR(20) NOT NULL DEFAULT 'scope',
    event_code VARCHAR(40) NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    detail_json TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_ptscope_events_scope FOREIGN KEY (scope_id) REFERENCES proposal_technical_scopes(id) ON DELETE CASCADE,
    INDEX idx_proposal_technical_scope_events (scope_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS proposal_sow_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scope_id BIGINT UNSIGNED NOT NULL,
    proposal_document_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    sections_json LONGTEXT NULL,
    base_scope_hash CHAR(64) NULL,
    content_hash CHAR(64) NULL,
    approved_hash CHAR(64) NULL,
    approved_by_user_id BIGINT UNSIGNED NULL,
    approved_at DATETIME(3) NULL,
    approval_checklist_json TEXT NULL,
    approval_comment VARCHAR(1000) NULL,
    self_approved TINYINT(1) NOT NULL DEFAULT 0,
    last_edited_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_proposal_sow_documents_scope UNIQUE (scope_id),
    CONSTRAINT fk_ptsow_scope FOREIGN KEY (scope_id) REFERENCES proposal_technical_scopes(id) ON DELETE CASCADE,
    CONSTRAINT fk_ptsow_document FOREIGN KEY (proposal_document_id) REFERENCES proposal_documents(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// The scope used to hang from the quotation-linked proposals; it now hangs from proposal documents.
// Empty legacy tables are dropped and tables with data are kept under a *_legacy name.
async function migrateLegacyProposalAnchor() {
  const legacyColumn = await query(
    `SELECT 1 AS found FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'proposal_technical_scopes' AND column_name = 'proposal_id'
     LIMIT 1`,
  );
  if (legacyColumn.length) {
    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM proposal_technical_scopes`);
    if (Number(total) === 0) {
      await query(`DROP TABLE IF EXISTS proposal_sow_documents`);
      await query(`DROP TABLE IF EXISTS proposal_technical_scope_events`);
      await query(`DROP TABLE proposal_technical_scopes`);
    } else {
      await query(
        `RENAME TABLE proposal_sow_documents TO proposal_sow_documents_legacy,
                      proposal_technical_scope_events TO proposal_technical_scope_events_legacy,
                      proposal_technical_scopes TO proposal_technical_scopes_legacy`,
      );
    }
  }
  const legacySuggestions = await query(
    `SELECT 1 AS found FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'tech_playbook_suggestions' AND column_name = 'proposal_id'
     LIMIT 1`,
  );
  if (legacySuggestions.length) {
    await query(
      `ALTER TABLE tech_playbook_suggestions CHANGE proposal_id proposal_document_id BIGINT UNSIGNED NULL`,
    );
  }
}

export async function ensureTechnicalScopeSchema() {
  if (!ensureTechnicalScopeSchemaPromise) {
    ensureTechnicalScopeSchemaPromise = (async () => {
      await ensureProposalDocumentSchema();
      // The legacy migration only applies once the playbook tables exist.
      for (const statement of TECHNICAL_SCOPE_SCHEMA_STATEMENTS.slice(0, 3)) {
        await query(statement);
      }
      await migrateLegacyProposalAnchor();
      for (const statement of TECHNICAL_SCOPE_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureTechnicalScopeSchemaPromise = undefined;
      throw error;
    });
  }
  await ensureTechnicalScopeSchemaPromise;
}
