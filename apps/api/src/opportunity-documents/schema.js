import { query } from "../db.js";

let ensureOpportunityDocumentSchemaPromise;

const OPPORTUNITY_DOCUMENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS opportunity_document_upload_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    entity_type VARCHAR(40) NOT NULL DEFAULT 'opportunity_draft',
    entity_id BIGINT UNSIGNED NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    expires_at DATETIME(3) NULL,
    CONSTRAINT uq_opp_doc_sessions_public_id UNIQUE (public_id),
    CONSTRAINT fk_opp_doc_sessions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    INDEX idx_opp_doc_sessions_entity (entity_type, entity_id),
    INDEX idx_opp_doc_sessions_created_by (created_by_user_id, created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    upload_session_id BIGINT UNSIGNED NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,
    storage_provider VARCHAR(30) NOT NULL,
    storage_bucket VARCHAR(120) NULL,
    storage_key VARCHAR(500) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    stored_file_name VARCHAR(255) NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_extension VARCHAR(20) NULL,
    byte_size BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) NOT NULL,
    document_kind VARCHAR(40) NULL,
    source_label VARCHAR(120) NULL,
    processing_status VARCHAR(30) NOT NULL DEFAULT 'uploaded',
    processing_error TEXT NULL,
    duration_seconds INT UNSIGNED NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_documents_public_id UNIQUE (public_id),
    CONSTRAINT fk_documents_upload_session FOREIGN KEY (upload_session_id) REFERENCES opportunity_document_upload_sessions(id) ON DELETE SET NULL,
    CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id),
    INDEX idx_documents_session (upload_session_id),
    INDEX idx_documents_entity (entity_type, entity_id, created_at),
    INDEX idx_documents_processing (processing_status, created_at),
    INDEX idx_documents_sha (sha256)
  )`,
  `CREATE TABLE IF NOT EXISTS document_contents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT UNSIGNED NOT NULL,
    extraction_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    transcription_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    detected_format VARCHAR(30) NULL,
    detected_language VARCHAR(20) NULL,
    page_count INT UNSIGNED NULL,
    duration_seconds INT UNSIGNED NULL,
    raw_text LONGTEXT NULL,
    normalized_text LONGTEXT NULL,
    structured_content_json JSON NULL,
    transcript_text LONGTEXT NULL,
    transcription_language VARCHAR(20) NULL,
    transcription_confidence DECIMAL(5,4) NULL,
    content_summary TEXT NULL,
    extracted_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_document_contents_document UNIQUE (document_id),
    CONSTRAINT fk_document_contents_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    INDEX idx_document_contents_extraction (extraction_status, extracted_at),
    INDEX idx_document_contents_transcription (transcription_status, extracted_at)
  )`,
  `CREATE TABLE IF NOT EXISTS document_analyses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT UNSIGNED NOT NULL,
    analysis_scope VARCHAR(40) NOT NULL DEFAULT 'opportunity_draft',
    pipeline_version VARCHAR(40) NOT NULL,
    model_provider VARCHAR(40) NULL,
    model_name VARCHAR(120) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    draft_fields_json JSON NULL,
    stage_suggestions_json JSON NULL,
    entities_json JSON NULL,
    warnings_json JSON NULL,
    confidence VARCHAR(10) NULL,
    evidence_json JSON NULL,
    error_message TEXT NULL,
    analyzed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_document_analyses_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    INDEX idx_document_analyses_document_scope (document_id, analysis_scope),
    INDEX idx_document_analyses_status (status, analyzed_at)
  )`,
  `CREATE TABLE IF NOT EXISTS document_match_results (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    document_analysis_id BIGINT UNSIGNED NOT NULL,
    match_target VARCHAR(40) NOT NULL,
    detected_label VARCHAR(255) NOT NULL,
    normalized_label VARCHAR(255) NULL,
    match_status VARCHAR(30) NOT NULL,
    selected_entity_id BIGINT UNSIGNED NULL,
    selected_entity_label VARCHAR(255) NULL,
    candidate_entities_json JSON NULL,
    confidence_score DECIMAL(5,4) NULL,
    reason TEXT NULL,
    reviewed_by_user_id BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_document_match_results_analysis FOREIGN KEY (document_analysis_id) REFERENCES document_analyses(id) ON DELETE CASCADE,
    CONSTRAINT fk_document_match_results_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_document_match_results_scope (document_analysis_id, match_target),
    INDEX idx_document_match_results_status (match_status, reviewed_at)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_document_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    document_id BIGINT UNSIGNED NOT NULL,
    link_type VARCHAR(40) NOT NULL DEFAULT 'source_document',
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_document_links UNIQUE (opportunity_id, document_id, link_type),
    CONSTRAINT fk_opportunity_document_links_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_document_links_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_document_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_document_links_document (document_id)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_stage_document_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    sales_stage_id BIGINT UNSIGNED NOT NULL,
    document_id BIGINT UNSIGNED NOT NULL,
    link_role VARCHAR(40) NOT NULL DEFAULT 'evidence',
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_stage_document_links UNIQUE (opportunity_id, sales_stage_id, document_id, link_role),
    CONSTRAINT fk_opportunity_stage_document_links_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_stage_document_links_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id),
    CONSTRAINT fk_opportunity_stage_document_links_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_stage_document_links_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_stage_answer_document_sources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stage_answer_id BIGINT UNSIGNED NOT NULL,
    document_id BIGINT UNSIGNED NOT NULL,
    evidence_excerpt TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_stage_answer_document_sources UNIQUE (stage_answer_id, document_id),
    CONSTRAINT fk_opportunity_stage_answer_document_sources_answer FOREIGN KEY (stage_answer_id) REFERENCES opportunity_stage_question_answers(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_stage_answer_document_sources_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  )`,
];

export async function ensureOpportunityDocumentSchema() {
  if (!ensureOpportunityDocumentSchemaPromise) {
    ensureOpportunityDocumentSchemaPromise = (async () => {
      for (const statement of OPPORTUNITY_DOCUMENT_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureOpportunityDocumentSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureOpportunityDocumentSchemaPromise;
}
