import { query } from "../db.js";

let ensureCampaignsSchemaPromise;

async function hasColumn(tableName, columnName) {
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

const CAMPAIGNS_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS campaigns (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    description TEXT NULL,
    campaign_goal_text TEXT NULL,
    classification_guide_context TEXT NULL,
    classification_guide_examples_json JSON NULL,
    campaign_email_guide_json JSON NULL,
    campaign_email_draft_json JSON NULL,
    tipo_campana VARCHAR(60) NOT NULL,
    subtipo_campana VARCHAR(60) NOT NULL,
    compatibilidad_nivel VARCHAR(40) NOT NULL DEFAULT 'permitido',
    compatibilidad_aprobada TINYINT(1) NOT NULL DEFAULT 0,
    compatibilidad_justificacion VARCHAR(500) NULL,
    compatibilidad_evaluada_at DATETIME(3) NULL,
    estado_campana VARCHAR(40) NOT NULL DEFAULT 'borrador',
    etapa_ciclo_vida VARCHAR(40) NULL,
    starts_at DATETIME(3) NULL,
    ends_at DATETIME(3) NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    INDEX idx_campaigns_estado (estado_campana),
    INDEX idx_campaigns_tipo_subtipo (tipo_campana, subtipo_campana),
    CONSTRAINT fk_campaigns_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_campaigns_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS campaign_account_interactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    etapa_ciclo_vida VARCHAR(40) NULL,
    estado_interaccion VARCHAR(40) NOT NULL DEFAULT 'no_enviado',
    notes VARCHAR(500) NULL,
    last_interaction_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_by BIGINT UNSIGNED NULL,
    CONSTRAINT uq_campaign_account_interaction UNIQUE (campaign_id, account_id),
    INDEX idx_campaign_account_interaction_estado (campaign_id, estado_interaccion),
    CONSTRAINT fk_campaign_account_interaction_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_account_interaction_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_account_interaction_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS campaign_account_interaction_contacts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    campaign_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    contact_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_by BIGINT UNSIGNED NULL,
    CONSTRAINT uq_campaign_account_interaction_contact UNIQUE (campaign_id, account_id, contact_id),
    INDEX idx_campaign_account_interaction_contact_campaign_account (campaign_id, account_id),
    CONSTRAINT fk_campaign_account_interaction_contact_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_account_interaction_contact_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_account_interaction_contact_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    CONSTRAINT fk_campaign_account_interaction_contact_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export async function ensureCampaignsSchema() {
  if (!ensureCampaignsSchemaPromise) {
    ensureCampaignsSchemaPromise = (async () => {
      for (const statement of CAMPAIGNS_SCHEMA_STATEMENTS) {
        await query(statement);
      }

      if (!(await hasColumn("campaigns", "compatibilidad_nivel"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN compatibilidad_nivel VARCHAR(40) NOT NULL DEFAULT 'permitido'
           AFTER subtipo_campana`,
        );
      }

      if (!(await hasColumn("campaigns", "campaign_goal_text"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN campaign_goal_text TEXT NULL
           AFTER description`,
        );
      }

      if (!(await hasColumn("campaigns", "classification_guide_context"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN classification_guide_context TEXT NULL
           AFTER campaign_goal_text`,
        );
      }

      if (
        !(await hasColumn("campaigns", "classification_guide_examples_json"))
      ) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN classification_guide_examples_json JSON NULL
           AFTER classification_guide_context`,
        );
      }

      if (!(await hasColumn("campaigns", "campaign_email_guide_json"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN campaign_email_guide_json JSON NULL
           AFTER classification_guide_examples_json`,
        );
      }

      if (!(await hasColumn("campaigns", "campaign_email_draft_json"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN campaign_email_draft_json JSON NULL
           AFTER campaign_email_guide_json`,
        );
      }

      if (!(await hasColumn("campaigns", "compatibilidad_aprobada"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN compatibilidad_aprobada TINYINT(1) NOT NULL DEFAULT 0
           AFTER compatibilidad_nivel`,
        );
      }

      if (!(await hasColumn("campaigns", "compatibilidad_justificacion"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN compatibilidad_justificacion VARCHAR(500) NULL
           AFTER compatibilidad_aprobada`,
        );
      }

      if (!(await hasColumn("campaigns", "compatibilidad_evaluada_at"))) {
        await query(
          `ALTER TABLE campaigns
           ADD COLUMN compatibilidad_evaluada_at DATETIME(3) NULL
           AFTER compatibilidad_justificacion`,
        );
      }
    })().catch((error) => {
      ensureCampaignsSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureCampaignsSchemaPromise;
}
