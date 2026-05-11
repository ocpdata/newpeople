import { query } from "../db.js";

let ensureOpportunityWorkspaceSchemaPromise;

const OPPORTUNITY_WORKSPACE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS opportunity_playbooks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_playbooks_code UNIQUE (code)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_playbook_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    playbook_id BIGINT UNSIGNED NOT NULL,
    version_label VARCHAR(80) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_playbook_versions UNIQUE (playbook_id, version_label),
    CONSTRAINT fk_opportunity_playbook_versions_playbook FOREIGN KEY (playbook_id) REFERENCES opportunity_playbooks(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_playbook_stage_templates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    playbook_version_id BIGINT UNSIGNED NOT NULL,
    sales_stage_id BIGINT UNSIGNED NOT NULL,
    display_order INT UNSIGNED NOT NULL DEFAULT 1,
    objective TEXT NULL,
    exit_criteria_summary TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_playbook_stage_templates UNIQUE (playbook_version_id, sales_stage_id),
    CONSTRAINT fk_opportunity_playbook_stage_templates_version FOREIGN KEY (playbook_version_id) REFERENCES opportunity_playbook_versions(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_playbook_stage_templates_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_playbook_stage_criteria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stage_template_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(120) NOT NULL,
    title VARCHAR(220) NOT NULL,
    description TEXT NULL,
    theme_code VARCHAR(80) NULL,
    display_order INT UNSIGNED NOT NULL DEFAULT 1,
    is_required TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_playbook_stage_criteria UNIQUE (stage_template_id, code),
    CONSTRAINT fk_opportunity_playbook_stage_criteria_template FOREIGN KEY (stage_template_id) REFERENCES opportunity_playbook_stage_templates(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_criterion_assessments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    criterion_code VARCHAR(120) NOT NULL,
    sales_stage_id BIGINT UNSIGNED NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'missing',
    score TINYINT UNSIGNED NOT NULL DEFAULT 0,
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
    summary TEXT NULL,
    evidence_count INT UNSIGNED NOT NULL DEFAULT 0,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_workspace_criterion_assessments UNIQUE (opportunity_id, criterion_code),
    CONSTRAINT fk_opportunity_workspace_criterion_assessments_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_criterion_assessments_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_criterion_assessments_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_weaknesses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(220) NOT NULL,
    category VARCHAR(80) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    sales_stage_id BIGINT UNSIGNED NULL,
    theme_code VARCHAR(80) NULL,
    detail TEXT NULL,
    mitigation_plan TEXT NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    due_date DATE NULL,
    resolved_note TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_workspace_weaknesses_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_weaknesses_stage FOREIGN KEY (sales_stage_id) REFERENCES opportunity_sales_stages(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_weaknesses_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_weaknesses_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_opportunity_workspace_weaknesses_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_workspace_weaknesses_status (opportunity_id, status, severity)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_theme_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    theme_code VARCHAR(80) NOT NULL,
    claim TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'supported',
    confidence VARCHAR(20) NOT NULL DEFAULT 'medium',
    source_type VARCHAR(40) NOT NULL DEFAULT 'manual_note',
    source_ref_id BIGINT UNSIGNED NULL,
    evidence_excerpt TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_workspace_theme_entries_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_theme_entries_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_opportunity_workspace_theme_entries_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_workspace_theme_entries_theme (opportunity_id, theme_code, status)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_stakeholders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(180) NOT NULL,
    role_code VARCHAR(80) NOT NULL,
    role_label VARCHAR(120) NULL,
    influence_level VARCHAR(20) NOT NULL DEFAULT 'medium',
    support_level VARCHAR(20) NOT NULL DEFAULT 'neutral',
    status VARCHAR(30) NOT NULL DEFAULT 'identified',
    priorities TEXT NULL,
    concerns TEXT NULL,
    next_action TEXT NULL,
    last_contact_at DATETIME(3) NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_workspace_stakeholders_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_stakeholders_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_opportunity_workspace_stakeholders_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_workspace_stakeholders_status (opportunity_id, status, support_level)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_actions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(220) NOT NULL,
    action_type VARCHAR(80) NOT NULL DEFAULT 'follow_up',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    linked_stage_id BIGINT UNSIGNED NULL,
    linked_theme_code VARCHAR(80) NULL,
    linked_weakness_id BIGINT UNSIGNED NULL,
    stakeholder_id BIGINT UNSIGNED NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    due_date DATE NULL,
    success_criteria TEXT NULL,
    notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_workspace_actions_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_actions_stage FOREIGN KEY (linked_stage_id) REFERENCES opportunity_sales_stages(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_actions_weakness FOREIGN KEY (linked_weakness_id) REFERENCES opportunity_workspace_weaknesses(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_actions_stakeholder FOREIGN KEY (stakeholder_id) REFERENCES opportunity_workspace_stakeholders(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_actions_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_actions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_opportunity_workspace_actions_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_workspace_actions_status (opportunity_id, status, due_date)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_deliverables (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    deliverable_type VARCHAR(80) NOT NULL,
    title VARCHAR(220) NOT NULL,
    audience VARCHAR(180) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'missing',
    version_label VARCHAR(80) NULL,
    linked_stage_id BIGINT UNSIGNED NULL,
    sent_at DATETIME(3) NULL,
    outcome_summary TEXT NULL,
    document_public_id VARCHAR(64) NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_workspace_deliverables_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_deliverables_stage FOREIGN KEY (linked_stage_id) REFERENCES opportunity_sales_stages(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_deliverables_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_opportunity_workspace_deliverables_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_workspace_deliverables_status (opportunity_id, status, deliverable_type)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_workspace_recommended_strategy (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    heading TEXT NOT NULL,
    route TEXT NOT NULL,
    final_objective TEXT NOT NULL,
    steps_json JSON NOT NULL,
    derived_from_stage_id BIGINT UNSIGNED NULL,
    derived_from_stage_code VARCHAR(80) NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_workspace_recommended_strategy UNIQUE (opportunity_id),
    CONSTRAINT fk_opportunity_workspace_recommended_strategy_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_workspace_recommended_strategy_stage FOREIGN KEY (derived_from_stage_id) REFERENCES opportunity_sales_stages(id) ON DELETE SET NULL,
    CONSTRAINT fk_opportunity_workspace_recommended_strategy_user FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
];

async function ensureWorkspaceActionColumn(columnName, definition) {
  const rows = await query(
    `SHOW COLUMNS FROM opportunity_workspace_actions LIKE ?`,
    [columnName],
  );
  if (rows.length) {
    return;
  }

  await query(
    `ALTER TABLE opportunity_workspace_actions ADD COLUMN ${definition}`,
  );
}

export async function ensureOpportunityWorkspaceSchema() {
  if (!ensureOpportunityWorkspaceSchemaPromise) {
    ensureOpportunityWorkspaceSchemaPromise = (async () => {
      for (const statement of OPPORTUNITY_WORKSPACE_SCHEMA_STATEMENTS) {
        await query(statement);
      }
      await ensureWorkspaceActionColumn(
        "scheduled_at",
        "scheduled_at DATETIME(3) NULL AFTER due_date",
      );
      await ensureWorkspaceActionColumn(
        "is_primary_next_step",
        "is_primary_next_step TINYINT(1) NOT NULL DEFAULT 0 AFTER notes",
      );
      await ensureWorkspaceActionColumn(
        "details_json",
        "details_json JSON NULL AFTER is_primary_next_step",
      );
    })().catch((error) => {
      ensureOpportunityWorkspaceSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureOpportunityWorkspaceSchemaPromise;
}
