import { query } from "../db.js";

let ensureOpportunityStageAnswerSuggestionJobSchemaPromise;

const OPPORTUNITY_STAGE_ANSWER_SUGGESTION_JOB_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS opportunity_stage_answer_suggestion_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    sales_stage_id BIGINT UNSIGNED NOT NULL,
    requested_by_user_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    request_fingerprint CHAR(71) NOT NULL,
    pipeline_version VARCHAR(40) NOT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    lease_token VARCHAR(64) NULL,
    lease_expires_at DATETIME(3) NULL,
    started_at DATETIME(3) NULL,
    finished_at DATETIME(3) NULL,
    expires_at DATETIME(3) NULL,
    result_json JSON NULL,
    summary_json JSON NULL,
    meta_json JSON NULL,
    source_snapshot_json JSON NULL,
    error_code VARCHAR(60) NULL,
    error_message TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opp_stage_answer_suggestion_jobs_public_id UNIQUE (public_id),
    CONSTRAINT fk_opp_stage_answer_suggestion_jobs_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opp_stage_answer_suggestion_jobs_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id),
    CONSTRAINT fk_opp_stage_answer_suggestion_jobs_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
    INDEX idx_opp_stage_answer_suggestion_jobs_scope (opportunity_id, sales_stage_id, status, created_at),
    INDEX idx_opp_stage_answer_suggestion_jobs_status (status, updated_at),
    INDEX idx_opp_stage_answer_suggestion_jobs_fingerprint (request_fingerprint, status, created_at),
    INDEX idx_opp_stage_answer_suggestion_jobs_expiry (expires_at)
  )`,
];

export async function ensureOpportunityStageAnswerSuggestionJobSchema() {
  if (!ensureOpportunityStageAnswerSuggestionJobSchemaPromise) {
    ensureOpportunityStageAnswerSuggestionJobSchemaPromise = (async () => {
      for (const statement of OPPORTUNITY_STAGE_ANSWER_SUGGESTION_JOB_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureOpportunityStageAnswerSuggestionJobSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureOpportunityStageAnswerSuggestionJobSchemaPromise;
}
