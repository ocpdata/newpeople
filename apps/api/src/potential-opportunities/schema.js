import { query } from "../db.js";

let ensurePotentialOpportunitySchemaPromise;

async function columnExists(tableName, columnName) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  );

  return rows.length > 0;
}

async function constraintExists(tableName, constraintName) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName],
  );

  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const rows = await query(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName],
  );

  return rows.length > 0;
}

async function ensurePotentialOpportunityCaseColumns() {
  if (!(await columnExists("potential_opportunity_cases", "primary_contact_id"))) {
    await query(
      `ALTER TABLE potential_opportunity_cases
       ADD COLUMN primary_contact_id BIGINT UNSIGNED NULL
       AFTER account_id`,
    );
  }

  if (!(await indexExists("potential_opportunity_cases", "idx_potential_opportunity_cases_primary_contact"))) {
    await query(
      `ALTER TABLE potential_opportunity_cases
       ADD INDEX idx_potential_opportunity_cases_primary_contact (primary_contact_id)`,
    );
  }

  if (!(await constraintExists(
    "potential_opportunity_cases",
    "fk_potential_opportunity_cases_primary_contact",
  ))) {
    await query(
      `ALTER TABLE potential_opportunity_cases
       ADD CONSTRAINT fk_potential_opportunity_cases_primary_contact
       FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL`,
    );
  }
}

const POTENTIAL_OPPORTUNITY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS commercial_signal_rulesets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    fit_weight DECIMAL(5,2) NOT NULL DEFAULT 0.20,
    signal_strength_weight DECIMAL(5,2) NOT NULL DEFAULT 0.25,
    urgency_weight DECIMAL(5,2) NOT NULL DEFAULT 0.15,
    engagement_weight DECIMAL(5,2) NOT NULL DEFAULT 0.15,
    coverage_weight DECIMAL(5,2) NOT NULL DEFAULT 0.15,
    momentum_weight DECIMAL(5,2) NOT NULL DEFAULT 0.10,
    min_signal_score DECIMAL(5,2) NOT NULL DEFAULT 35.00,
    min_case_score DECIMAL(5,2) NOT NULL DEFAULT 45.00,
    suggest_convert_score DECIMAL(5,2) NOT NULL DEFAULT 60.00,
    priority_critical_threshold DECIMAL(5,2) NOT NULL DEFAULT 85.00,
    priority_high_threshold DECIMAL(5,2) NOT NULL DEFAULT 70.00,
    priority_medium_threshold DECIMAL(5,2) NOT NULL DEFAULT 55.00,
    priority_low_threshold DECIMAL(5,2) NOT NULL DEFAULT 40.00,
    dedupe_window_days INT NOT NULL DEFAULT 21,
    topic_similarity_threshold DECIMAL(5,2) NOT NULL DEFAULT 0.75,
    stale_penalty_start_days INT NOT NULL DEFAULT 15,
    stale_penalty_per_day DECIMAL(5,2) NOT NULL DEFAULT 1.50,
    stale_penalty_cap DECIMAL(5,2) NOT NULL DEFAULT 25.00,
    reactivation_lookback_days INT NOT NULL DEFAULT 60,
    created_by_user_id BIGINT UNSIGNED NULL,
    activated_by_user_id BIGINT UNSIGNED NULL,
    activated_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_signal_rulesets_code UNIQUE (code),
    CONSTRAINT fk_commercial_signal_rulesets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_signal_rulesets_activated_by FOREIGN KEY (activated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS potential_opportunity_cases (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    case_type ENUM('nueva', 'reactivacion', 'expansion', 'promovible', 'riesgo_fuga') NOT NULL,
    title VARCHAR(255) NOT NULL,
    topic_key VARCHAR(255) NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    primary_contact_id BIGINT UNSIGNED NULL,
    related_opportunity_id BIGINT UNSIGNED NULL,
    converted_opportunity_id BIGINT UNSIGNED NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    assigned_by_user_id BIGINT UNSIGNED NULL,
    source_kind VARCHAR(40) NOT NULL DEFAULT 'interaction',
    source_entity_id BIGINT UNSIGNED NULL,
    commercial_hypothesis TEXT NOT NULL,
    business_need_summary TEXT NULL,
    next_step_suggestion TEXT NULL,
    recommended_action ENUM('crear_oportunidad', 'agendar_reunion', 'llamar_contacto', 'enviar_material', 'investigar_cuenta', 'validar_necesidad', 'reasignar_owner', 'descartar') NOT NULL,
    recommended_action_due_date DATE NULL,
    fit_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    signal_strength_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    urgency_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    engagement_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    coverage_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    momentum_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    staleness_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    duplicate_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    total_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    priority_level ENUM('critical', 'high', 'medium', 'low', 'observe') NOT NULL DEFAULT 'observe',
    top_positive_factors_json LONGTEXT NULL,
    top_negative_factors_json LONGTEXT NULL,
    signal_count INT NOT NULL DEFAULT 0,
    state ENUM('new', 'in_review', 'accepted', 'converted', 'postponed', 'dismissed', 'expired') NOT NULL DEFAULT 'new',
    state_reason VARCHAR(255) NULL,
    dismissed_reason_code VARCHAR(64) NULL,
    dismissed_reason_note VARCHAR(500) NULL,
    postponed_until DATE NULL,
    snooze_count INT NOT NULL DEFAULT 0,
    first_detected_at DATETIME(3) NOT NULL,
    last_detected_at DATETIME(3) NOT NULL,
    latest_evidence_at DATETIME(3) NULL,
    review_sla_at DATETIME(3) NULL,
    converted_at DATETIME(3) NULL,
    converted_by_user_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_potential_opportunity_cases_public_id UNIQUE (public_id),
    CONSTRAINT fk_potential_opportunity_cases_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_potential_opportunity_cases_primary_contact FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    CONSTRAINT fk_potential_opportunity_cases_related_opportunity FOREIGN KEY (related_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_potential_opportunity_cases_converted_opportunity FOREIGN KEY (converted_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_potential_opportunity_cases_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_potential_opportunity_cases_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_potential_opportunity_cases_converted_by FOREIGN KEY (converted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_potential_opportunity_cases_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_potential_opportunity_cases_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
    INDEX idx_potential_opportunity_cases_owner (owner_user_id),
    INDEX idx_potential_opportunity_cases_state (state),
    INDEX idx_potential_opportunity_cases_priority (priority_level),
    INDEX idx_potential_opportunity_cases_review_sla (review_sla_at)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_signals (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    case_id BIGINT UNSIGNED NULL,
    ruleset_id BIGINT UNSIGNED NOT NULL,
    signal_type ENUM('nueva_oportunidad', 'reactivacion', 'expansion', 'interaccion_promovible', 'riesgo_fuga') NOT NULL,
    signal_subtype VARCHAR(64) NOT NULL,
    source_type ENUM('interaction') NOT NULL DEFAULT 'interaction',
    source_entity_id BIGINT UNSIGNED NOT NULL,
    interaction_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    evidence_summary TEXT NULL,
    topic_key VARCHAR(255) NOT NULL,
    fit_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    signal_strength_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    urgency_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    engagement_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    coverage_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    momentum_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    staleness_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    duplicate_penalty DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    total_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    top_positive_factors_json LONGTEXT NULL,
    top_negative_factors_json LONGTEXT NULL,
    status ENUM('new', 'attached', 'dismissed', 'expired') NOT NULL DEFAULT 'new',
    detected_at DATETIME(3) NOT NULL,
    review_required TINYINT(1) NOT NULL DEFAULT 1,
    reviewed_by_user_id BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(3) NULL,
    review_outcome ENUM('accepted', 'dismissed', 'postponed') NULL,
    dismissed_reason_code VARCHAR(64) NULL,
    dismissed_reason_note VARCHAR(500) NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_signals_public_id UNIQUE (public_id),
    CONSTRAINT uq_commercial_signals_interaction UNIQUE (interaction_id),
    CONSTRAINT fk_commercial_signals_case FOREIGN KEY (case_id) REFERENCES potential_opportunity_cases(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_signals_ruleset FOREIGN KEY (ruleset_id) REFERENCES commercial_signal_rulesets(id),
    CONSTRAINT fk_commercial_signals_interaction FOREIGN KEY (interaction_id) REFERENCES interactions(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_signals_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_signals_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_signals_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_signals_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_signals_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_commercial_signals_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
    INDEX idx_commercial_signals_case (case_id),
    INDEX idx_commercial_signals_account_detected (account_id, detected_at)
  )`,
  `CREATE TABLE IF NOT EXISTS potential_opportunity_case_transitions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    from_state ENUM('new', 'in_review', 'accepted', 'converted', 'postponed', 'dismissed', 'expired') NULL,
    to_state ENUM('new', 'in_review', 'accepted', 'converted', 'postponed', 'dismissed', 'expired') NOT NULL,
    reason_code VARCHAR(64) NULL,
    reason_note VARCHAR(500) NULL,
    changed_by_user_id BIGINT UNSIGNED NULL,
    changed_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_potential_opportunity_case_transitions_case FOREIGN KEY (case_id) REFERENCES potential_opportunity_cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_potential_opportunity_case_transitions_changed_by FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_potential_opportunity_case_transitions_case (case_id, changed_at)
  )`,
];

const DEFAULT_RULESET_INSERT = `
  INSERT INTO commercial_signal_rulesets (
    code, name, is_active,
    fit_weight, signal_strength_weight, urgency_weight,
    engagement_weight, coverage_weight, momentum_weight,
    min_signal_score, min_case_score, suggest_convert_score,
    priority_critical_threshold, priority_high_threshold,
    priority_medium_threshold, priority_low_threshold,
    dedupe_window_days, topic_similarity_threshold,
    stale_penalty_start_days, stale_penalty_per_day,
    stale_penalty_cap, reactivation_lookback_days,
    created_at, updated_at, activated_at
  )
  SELECT
    'default_v1', 'Scoring default v1', 1,
    0.20, 0.25, 0.15,
    0.15, 0.15, 0.10,
    35.00, 45.00, 60.00,
    85.00, 70.00,
    55.00, 40.00,
    21, 0.75,
    15, 1.50,
    25.00, 60,
    NOW(3), NOW(3), NOW(3)
  WHERE NOT EXISTS (
    SELECT 1 FROM commercial_signal_rulesets WHERE code = 'default_v1'
  )`;

export async function ensurePotentialOpportunitySchema() {
  if (!ensurePotentialOpportunitySchemaPromise) {
    ensurePotentialOpportunitySchemaPromise = (async () => {
      for (const statement of POTENTIAL_OPPORTUNITY_SCHEMA_STATEMENTS) {
        await query(statement);
      }
      await ensurePotentialOpportunityCaseColumns();
      await query(DEFAULT_RULESET_INSERT);
      await query(
        `UPDATE commercial_signal_rulesets
         SET is_active = CASE WHEN code = 'default_v1' THEN 1 ELSE is_active END,
             activated_at = COALESCE(activated_at, NOW(3)),
             updated_at = NOW(3)
         WHERE code = 'default_v1'`,
      );
    })().catch((error) => {
      ensurePotentialOpportunitySchemaPromise = undefined;
      throw error;
    });
  }

  await ensurePotentialOpportunitySchemaPromise;
}
