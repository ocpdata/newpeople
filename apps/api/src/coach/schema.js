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
          pending_question TEXT NULL,
          session_version INT UNSIGNED NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          closed_at DATETIME(3) NULL,
          INDEX idx_coach_sessions_user_status (user_id, status, updated_at),
          INDEX idx_coach_sessions_context (user_id, opportunity_id, updated_at)
        )
      `);
      const sessionColumns = await query(
        `SHOW COLUMNS FROM coach_conversation_sessions`,
      );
      const sessionColumnNames = new Set(
        sessionColumns.map((column) => column.Field),
      );
      if (!sessionColumnNames.has("pending_question")) {
        await query(
          `ALTER TABLE coach_conversation_sessions ADD COLUMN pending_question TEXT NULL AFTER draft_operation`,
        );
      }
      if (!sessionColumnNames.has("session_version")) {
        await query(
          `ALTER TABLE coach_conversation_sessions ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER pending_question`,
        );
      }
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
      await query(`
        CREATE TABLE IF NOT EXISTS coach_session_operations (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          session_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          source_job_id BIGINT UNSIGNED NULL,
          operation_index TINYINT UNSIGNED NOT NULL DEFAULT 0,
          operation_kind VARCHAR(80) NOT NULL,
          status ENUM('proposed', 'collecting', 'ready', 'handed_off', 'executing', 'completed', 'failed', 'rejected', 'cancelled', 'superseded', 'reverted') NOT NULL DEFAULT 'proposed',
          original_intent TEXT NOT NULL,
          identified_entities JSON NOT NULL,
          collected_fields JSON NOT NULL,
          missing_fields JSON NOT NULL,
          evidence JSON NOT NULL,
          target_module VARCHAR(80) NULL,
          target_route VARCHAR(500) NULL,
          handoff_token CHAR(36) NULL,
          handoff_expires_at DATETIME(3) NULL,
          handoff_consumed_at DATETIME(3) NULL,
          original_operation JSON NOT NULL,
          pending_operation JSON NOT NULL,
          result_payload JSON NULL,
          error_detail VARCHAR(1000) NULL,
          cancellation_reason VARCHAR(1000) NULL,
          execution_key VARCHAR(100) NULL,
          domain_audit_id BIGINT UNSIGNED NULL,
          version INT UNSIGNED NOT NULL DEFAULT 1,
          handed_off_at DATETIME(3) NULL,
          approved_at DATETIME(3) NULL,
          reviewed_at DATETIME(3) NULL,
          executing_at DATETIME(3) NULL,
          completed_at DATETIME(3) NULL,
          failed_at DATETIME(3) NULL,
          rejected_at DATETIME(3) NULL,
          cancelled_at DATETIME(3) NULL,
          reverted_at DATETIME(3) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          UNIQUE KEY uq_coach_operation_job_index (source_job_id, operation_index),
          UNIQUE KEY uq_coach_operation_handoff_token (handoff_token),
          UNIQUE KEY uq_coach_operation_execution_key (user_id, execution_key),
          INDEX idx_coach_operations_session_status (session_id, status, updated_at),
          INDEX idx_coach_operations_user_status (user_id, status, updated_at)
        )
      `);
      await query(`
        ALTER TABLE coach_session_operations
        MODIFY COLUMN original_intent TEXT NOT NULL,
        MODIFY COLUMN status ENUM('proposed', 'collecting', 'ready', 'handed_off', 'executing', 'completed', 'failed', 'rejected', 'cancelled', 'superseded', 'reverted') NOT NULL DEFAULT 'proposed'
      `);
      const operationColumns = await query(
        `SHOW COLUMNS FROM coach_session_operations`,
      );
      const operationColumnNames = new Set(
        operationColumns.map((column) => column.Field),
      );
      for (const [column, definition] of [
        ["execution_key", "VARCHAR(100) NULL AFTER cancellation_reason"],
        ["domain_audit_id", "BIGINT UNSIGNED NULL AFTER execution_key"],
        ["approved_at", "DATETIME(3) NULL AFTER handed_off_at"],
        ["reviewed_at", "DATETIME(3) NULL AFTER approved_at"],
        ["executing_at", "DATETIME(3) NULL AFTER reviewed_at"],
        ["failed_at", "DATETIME(3) NULL AFTER completed_at"],
        ["rejected_at", "DATETIME(3) NULL AFTER failed_at"],
        ["reverted_at", "DATETIME(3) NULL AFTER cancelled_at"],
      ]) {
        if (!operationColumnNames.has(column)) {
          await query(
            `ALTER TABLE coach_session_operations ADD COLUMN ${column} ${definition}`,
          );
        }
      }
      const executionIndexes = await query(
        `SHOW INDEX FROM coach_session_operations WHERE Key_name = 'uq_coach_operation_execution_key'`,
      );
      if (!executionIndexes.length) {
        await query(
          `ALTER TABLE coach_session_operations ADD UNIQUE KEY uq_coach_operation_execution_key (user_id, execution_key)`,
        );
      }
      if (!operationColumnNames.has("handoff_token")) {
        await query(`
          ALTER TABLE coach_session_operations
          ADD COLUMN handoff_token CHAR(36) NULL AFTER target_route
        `);
      }
      if (!operationColumnNames.has("handoff_expires_at")) {
        await query(`
          ALTER TABLE coach_session_operations
          ADD COLUMN handoff_expires_at DATETIME(3) NULL AFTER handoff_token
        `);
      }
      if (!operationColumnNames.has("handoff_consumed_at")) {
        await query(`
          ALTER TABLE coach_session_operations
          ADD COLUMN handoff_consumed_at DATETIME(3) NULL AFTER handoff_expires_at
        `);
      }
      const handoffIndexes = await query(`
        SHOW INDEX FROM coach_session_operations
        WHERE Key_name = 'uq_coach_operation_handoff_token'
      `);
      if (!handoffIndexes.length) {
        await query(`
          CREATE UNIQUE INDEX uq_coach_operation_handoff_token
          ON coach_session_operations (handoff_token)
        `);
      }
      await query(`
        CREATE TABLE IF NOT EXISTS coach_operation_events (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          operation_id BIGINT UNSIGNED NOT NULL,
          session_id BIGINT UNSIGNED NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          actor_user_id BIGINT UNSIGNED NULL,
          event_type ENUM('proposed', 'fields_collected', 'ready', 'approved', 'handed_off', 'execution_started', 'completed', 'validation_blocked', 'execution_failed', 'rejected', 'cancelled', 'superseded', 'expired', 'reverted') NOT NULL,
          from_status VARCHAR(30) NULL,
          to_status VARCHAR(30) NULL,
          source ENUM('user', 'coach', 'system', 'domain_module', 'handoff', 'legacy') NOT NULL,
          domain_module VARCHAR(80) NULL,
          domain_entity_type VARCHAR(80) NULL,
          domain_entity_id BIGINT UNSIGNED NULL,
          domain_audit_id BIGINT UNSIGNED NULL,
          idempotency_key VARCHAR(100) NULL,
          event_key VARCHAR(160) NOT NULL,
          reason_code VARCHAR(80) NULL,
          detail VARCHAR(1000) NULL,
          metadata JSON NULL,
          created_at_utc DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          UNIQUE KEY uq_coach_operation_event_key (operation_id, event_key),
          INDEX idx_coach_events_user_created (user_id, created_at_utc),
          INDEX idx_coach_events_actor_created (actor_user_id, created_at_utc),
          INDEX idx_coach_events_type_created (event_type, created_at_utc),
          INDEX idx_coach_events_operation_created (operation_id, created_at_utc)
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS coach_turn_quality_traces (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          channel VARCHAR(40) NOT NULL,
          process_key VARCHAR(80) NOT NULL,
          case_id VARCHAR(80) NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          session_id BIGINT UNSIGNED NULL,
          job_id BIGINT UNSIGNED NULL,
          intent_type VARCHAR(80) NULL,
          intent_subtype VARCHAR(100) NULL,
          primary_entity VARCHAR(40) NOT NULL DEFAULT 'none',
          entity_resolution_json JSON NOT NULL,
          applied_rules_json JSON NOT NULL,
          validation_status ENUM('valid', 'invalid', 'clarification', 'error') NOT NULL,
          validation_reasons_json JSON NOT NULL,
          response_type VARCHAR(40) NULL,
          confidence VARCHAR(20) NULL,
          evidence_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          tools_used_json JSON NOT NULL,
          operations_proposed SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          operations_rejected SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
          error_code VARCHAR(100) NULL,
          feedback_rating ENUM('positive', 'negative') NULL,
          feedback_category ENUM('intent', 'entity', 'response', 'evidence', 'other') NULL,
          feedback_corrected BOOLEAN NOT NULL DEFAULT FALSE,
          feedback_at DATETIME(3) NULL,
          created_at_utc DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          INDEX idx_coach_quality_channel_date (channel, created_at_utc),
          INDEX idx_coach_quality_process_date (channel, process_key, created_at_utc),
          INDEX idx_coach_quality_user_date (user_id, created_at_utc),
          INDEX idx_coach_quality_session (channel, session_id, created_at_utc),
          INDEX idx_coach_quality_validation (validation_status, created_at_utc)
        )
      `);
      const qualityTraceColumns = await query(
        `SHOW COLUMNS FROM coach_turn_quality_traces`,
      );
      if (!qualityTraceColumns.some((column) => column.Field === "case_id")) {
        await query(
          `ALTER TABLE coach_turn_quality_traces ADD COLUMN case_id VARCHAR(80) NULL AFTER process_key`,
        );
      }
      await query(`
        CREATE TABLE IF NOT EXISTS coach_channel_rollouts (
          channel VARCHAR(40) PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          rollout_percentage TINYINT UNSIGNED NOT NULL DEFAULT 100,
          allowlist_json JSON NOT NULL,
          updated_by_user_id BIGINT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          CONSTRAINT fk_coach_channel_rollout_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
      for (const channel of ["coach", "customer_account", "prospect"]) {
        await query(
          `INSERT INTO coach_channel_rollouts
            (channel, enabled, rollout_percentage, allowlist_json, created_at, updated_at)
           SELECT ?, TRUE, 100, JSON_ARRAY(), NOW(3), NOW(3)
           WHERE NOT EXISTS (SELECT 1 FROM coach_channel_rollouts WHERE channel = ?)`,
          [channel, channel],
        );
      }
      const eventColumns = await query(
        `SHOW COLUMNS FROM coach_operation_events`,
      );
      if (!eventColumns.some((column) => column.Field === "actor_user_id")) {
        await query(`
          ALTER TABLE coach_operation_events
          ADD COLUMN actor_user_id BIGINT UNSIGNED NULL AFTER user_id,
          ADD INDEX idx_coach_events_actor_created (actor_user_id, created_at_utc)
        `);
      }
      await query(`
        INSERT IGNORE INTO coach_operation_events
          (operation_id, session_id, user_id, actor_user_id, event_type, to_status, source,
           event_key, metadata, created_at_utc)
        SELECT id, session_id, user_id, NULL, 'proposed', 'proposed', 'legacy',
               'proposed', JSON_OBJECT('backfilled', TRUE), created_at
        FROM coach_session_operations
      `);
      for (const [eventType, status, timestampColumn] of [
        ["approved", "executing", "approved_at"],
        ["handed_off", "handed_off", "handed_off_at"],
        ["execution_started", "executing", "executing_at"],
        ["completed", "completed", "completed_at"],
        ["execution_failed", "failed", "failed_at"],
        ["rejected", "rejected", "rejected_at"],
        ["cancelled", "cancelled", "cancelled_at"],
        ["reverted", "reverted", "reverted_at"],
      ]) {
        await query(`
          INSERT IGNORE INTO coach_operation_events
            (operation_id, session_id, user_id, actor_user_id, event_type, to_status, source,
             domain_audit_id, event_key, metadata, created_at_utc)
          SELECT id, session_id, user_id, NULL, '${eventType}', '${status}', 'legacy',
                 domain_audit_id, 'legacy:${eventType}',
                 JSON_OBJECT('backfilled', TRUE), ${timestampColumn}
          FROM coach_session_operations
          WHERE ${timestampColumn} IS NOT NULL
        `);
      }
      const auditColumns = await query(`SHOW COLUMNS FROM audit_log`);
      if (
        !auditColumns.some((column) => column.Field === "coach_operation_id")
      ) {
        await query(`
          ALTER TABLE audit_log
          ADD COLUMN coach_operation_id BIGINT UNSIGNED NULL AFTER entity_id,
          ADD INDEX idx_audit_log_coach_operation (coach_operation_id)
        `);
      }
      await query(`
        INSERT INTO coach_session_operations
          (session_id, user_id, operation_index, operation_kind, status,
           original_intent, identified_entities, collected_fields, missing_fields,
           evidence, target_module, original_operation, pending_operation)
        SELECT s.id, s.user_id, 0,
               COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.draft_operation, '$.kind')), 'unknown'),
               'collecting', 'Borrador migrado de la sesión',
               COALESCE(s.context_snapshot, JSON_OBJECT()), JSON_OBJECT(), JSON_ARRAY(),
               JSON_ARRAY(), NULL, s.draft_operation, s.draft_operation
        FROM coach_conversation_sessions s
        WHERE s.draft_operation IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM coach_session_operations o
            WHERE o.session_id = s.id AND o.source_job_id IS NULL
          )
      `);
    })().catch((error) => {
      ensureCoachSchemaPromise = undefined;
      throw error;
    });
  }
  await ensureCoachSchemaPromise;
}
