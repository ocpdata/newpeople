import { query } from "../db.js";

let ensureInteractionSchemaPromise;

const INTERACTION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS interactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    source_notes LONGTEXT NULL,
    summary LONGTEXT NULL,
    analysis_status VARCHAR(40) NOT NULL DEFAULT 'uploaded',
    warnings_json LONGTEXT NULL,
    topics_json LONGTEXT NULL,
    actions_taken_json LONGTEXT NULL,
    next_steps_json LONGTEXT NULL,
    suggested_account_json LONGTEXT NULL,
    suggested_contacts_json LONGTEXT NULL,
    suggested_opportunities_json LONGTEXT NULL,
    account_id BIGINT UNSIGNED NULL,
    primary_opportunity_id BIGINT UNSIGNED NULL,
    analyzed_at DATETIME(3) NULL,
    resolved_at DATETIME(3) NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_interactions_public_id UNIQUE (public_id),
    CONSTRAINT fk_interactions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_interactions_primary_opportunity FOREIGN KEY (primary_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_interactions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_interactions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
    INDEX idx_interactions_status_created (analysis_status, created_at),
    INDEX idx_interactions_account_created (account_id, created_at),
    INDEX idx_interactions_primary_opportunity (primary_opportunity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS interaction_contact_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    interaction_id BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_interaction_contact_links UNIQUE (interaction_id, contact_id),
    CONSTRAINT fk_interaction_contact_links_interaction FOREIGN KEY (interaction_id) REFERENCES interactions(id) ON DELETE CASCADE,
    CONSTRAINT fk_interaction_contact_links_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    INDEX idx_interaction_contact_links_contact (contact_id)
  )`,
  `CREATE TABLE IF NOT EXISTS interaction_opportunity_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    interaction_id BIGINT UNSIGNED NOT NULL,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_interaction_opportunity_links UNIQUE (interaction_id, opportunity_id),
    CONSTRAINT fk_interaction_opportunity_links_interaction FOREIGN KEY (interaction_id) REFERENCES interactions(id) ON DELETE CASCADE,
    CONSTRAINT fk_interaction_opportunity_links_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    INDEX idx_interaction_opportunity_links_opportunity (opportunity_id),
    INDEX idx_interaction_opportunity_links_primary (interaction_id, is_primary)
  )`,
];

export async function ensureInteractionSchema() {
  if (!ensureInteractionSchemaPromise) {
    ensureInteractionSchemaPromise = (async () => {
      for (const statement of INTERACTION_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureInteractionSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureInteractionSchemaPromise;
}
