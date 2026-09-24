import { query } from "../db.js";

let ensureCoachSchemaPromise;

export async function ensureCoachSchema() {
  if (!ensureCoachSchemaPromise) {
    ensureCoachSchemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS coach_conversation_sessions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id BIGINT UNSIGNED NOT NULL,
          status ENUM('active', 'closed') NOT NULL DEFAULT 'active',
          account_id BIGINT UNSIGNED NULL,
          contact_id BIGINT UNSIGNED NULL,
          opportunity_id BIGINT UNSIGNED NULL,
          quotation_id BIGINT UNSIGNED NULL,
          proposal_id BIGINT UNSIGNED NULL,
          lead_id BIGINT UNSIGNED NULL,
          context_snapshot JSON NULL,
          messages JSON NOT NULL,
          draft_operation JSON NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          closed_at DATETIME(3) NULL,
          INDEX idx_coach_sessions_user_status (user_id, status, updated_at),
          INDEX idx_coach_sessions_context (user_id, opportunity_id, updated_at)
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS coach_operation_audits (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          session_id BIGINT UNSIGNED NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          operation_kind VARCHAR(80) NOT NULL,
          operation_payload JSON NOT NULL,
          before_state JSON NULL,
          after_state JSON NULL,
          result ENUM('proposed', 'confirmed', 'success', 'error', 'rejected', 'undone') NOT NULL,
          error_message VARCHAR(1000) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          INDEX idx_coach_audits_user_created (user_id, created_at),
          INDEX idx_coach_audits_session_created (session_id, created_at)
        )
      `);
    })().catch((error) => {
      ensureCoachSchemaPromise = undefined;
      throw error;
    });
  }
  await ensureCoachSchemaPromise;
}
