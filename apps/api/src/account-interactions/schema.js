import { query } from "../db.js";

let ensureAccountInteractionsSchemaPromise;

const ACCOUNT_INTERACTIONS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS account_interaction_types (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(120) NOT NULL,
    display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_account_interaction_types_code UNIQUE (code)
  )`,
  `CREATE TABLE IF NOT EXISTS account_interaction_results (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(120) NOT NULL,
    display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_account_interaction_results_code UNIQUE (code)
  )`,
  `CREATE TABLE IF NOT EXISTS account_interactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    interaction_type_id BIGINT UNSIGNED NOT NULL,
    result_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL,
    summary LONGTEXT NOT NULL,
    next_step LONGTEXT NULL,
    occurred_at DATETIME(3) NOT NULL,
    follow_up_at DATETIME(3) NULL,
    linked_opportunity_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_account_interactions_public_id UNIQUE (public_id),
    CONSTRAINT fk_account_interactions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_account_interactions_type FOREIGN KEY (interaction_type_id) REFERENCES account_interaction_types(id),
    CONSTRAINT fk_account_interactions_result FOREIGN KEY (result_id) REFERENCES account_interaction_results(id),
    CONSTRAINT fk_account_interactions_opportunity FOREIGN KEY (linked_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_account_interactions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_account_interactions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
    INDEX idx_account_interactions_account_date (account_id, occurred_at),
    INDEX idx_account_interactions_result (account_id, result_id, occurred_at),
    INDEX idx_account_interactions_linked_opportunity (linked_opportunity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS account_interaction_contacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    interaction_id BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_account_interaction_contacts UNIQUE (interaction_id, contact_id),
    CONSTRAINT fk_account_interaction_contacts_interaction FOREIGN KEY (interaction_id) REFERENCES account_interactions(id) ON DELETE CASCADE,
    CONSTRAINT fk_account_interaction_contacts_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    INDEX idx_account_interaction_contacts_contact (contact_id)
  )`,
  `INSERT INTO account_interaction_types (code, name, display_order, is_active, created_at, updated_at)
   VALUES
     ('meeting', 'Reunion', 1, 1, NOW(3), NOW(3)),
     ('call', 'Llamada', 2, 1, NOW(3), NOW(3)),
     ('presentation', 'Presentacion', 3, 1, NOW(3), NOW(3)),
     ('demo', 'Demo', 4, 1, NOW(3), NOW(3)),
     ('workshop', 'Workshop', 5, 1, NOW(3), NOW(3)),
     ('follow_up', 'Seguimiento', 6, 1, NOW(3), NOW(3)),
     ('email', 'Correo relevante', 7, 1, NOW(3), NOW(3)),
     ('other', 'Otro', 8, 1, NOW(3), NOW(3))
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     display_order = VALUES(display_order),
     is_active = VALUES(is_active),
     updated_at = VALUES(updated_at)`,
  `INSERT INTO account_interaction_results (code, name, display_order, is_active, created_at, updated_at)
   VALUES
     ('no_defined_opportunity', 'Sin oportunidad definida', 1, 1, NOW(3), NOW(3)),
     ('exploring', 'En exploracion', 2, 1, NOW(3), NOW(3)),
     ('future_interest', 'Interes futuro', 3, 1, NOW(3), NOW(3)),
     ('follow_up_required', 'Requiere seguimiento', 4, 1, NOW(3), NOW(3)),
     ('not_interested_for_now', 'No interesado por ahora', 5, 1, NOW(3), NOW(3)),
     ('opportunity_detected', 'Oportunidad detectada', 6, 1, NOW(3), NOW(3)),
     ('converted_to_opportunity', 'Derivo en oportunidad creada', 7, 1, NOW(3), NOW(3))
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     display_order = VALUES(display_order),
     is_active = VALUES(is_active),
     updated_at = VALUES(updated_at)`,
];

export async function ensureAccountInteractionsSchema() {
  if (!ensureAccountInteractionsSchemaPromise) {
    ensureAccountInteractionsSchemaPromise = (async () => {
      for (const statement of ACCOUNT_INTERACTIONS_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureAccountInteractionsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureAccountInteractionsSchemaPromise;
}
