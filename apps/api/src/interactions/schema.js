import { query } from "../db.js";

let ensureInteractionSchemaPromise;

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

async function ensureInteractionLeadColumns() {
  if (!(await columnExists("interactions", "processing_status"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN processing_status VARCHAR(40) NOT NULL DEFAULT 'pending'
       AFTER analysis_status`,
    );
  }

  if (!(await columnExists("interactions", "lead_source"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_source VARCHAR(64) NOT NULL DEFAULT 'otro'
       AFTER title`,
    );
  }

  const leadSourceBackfillRows = await query(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN lead_source IN ('otro', '') OR lead_source IS NULL THEN 1 ELSE 0 END) AS placeholder_total
     FROM interactions`,
  );
  const totalInteractions = Number(leadSourceBackfillRows[0]?.total || 0);
  const placeholderSourceTotal = Number(
    leadSourceBackfillRows[0]?.placeholder_total || 0,
  );
  if (totalInteractions > 0 && totalInteractions === placeholderSourceTotal) {
    await query(
      `UPDATE interactions
       SET lead_source = 'empresa_marketing'
       WHERE lead_source IN ('otro', '') OR lead_source IS NULL`,
    );
  }

  if (!(await columnExists("interactions", "seller_user_id"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN seller_user_id BIGINT UNSIGNED NULL
       AFTER primary_opportunity_id`,
    );
  }

  if (!(await columnExists("interactions", "disqualification_reason"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN disqualification_reason LONGTEXT NULL
       AFTER resolved_at`,
    );
  }

  if (!(await columnExists("interactions", "lead_substatus_code"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_substatus_code VARCHAR(80) NULL
       AFTER disqualification_reason`,
    );
  }

  if (!(await columnExists("interactions", "lead_reason_code"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_reason_code VARCHAR(80) NULL
       AFTER lead_substatus_code`,
    );
  }

  if (!(await columnExists("interactions", "lead_required_action_code"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_required_action_code VARCHAR(80) NULL
       AFTER lead_reason_code`,
    );
  }

  if (!(await columnExists("interactions", "lead_commercial_comment"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_commercial_comment LONGTEXT NULL
       AFTER lead_required_action_code`,
    );
  }

  if (!(await columnExists("interactions", "lead_next_action_due_at"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_next_action_due_at DATETIME(3) NULL
       AFTER lead_commercial_comment`,
    );
  }

  if (!(await columnExists("interactions", "lead_referred_contact_name"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_referred_contact_name VARCHAR(255) NULL
       AFTER lead_next_action_due_at`,
    );
  }

  if (!(await columnExists("interactions", "lead_referred_area_name"))) {
    await query(
      `ALTER TABLE interactions
       ADD COLUMN lead_referred_area_name VARCHAR(255) NULL
       AFTER lead_referred_contact_name`,
    );
  }

  if (
    !(await indexExists("interactions", "idx_interactions_processing_created"))
  ) {
    await query(
      `ALTER TABLE interactions
       ADD INDEX idx_interactions_processing_created (processing_status, created_at)`,
    );
  }

  if (!(await indexExists("interactions", "idx_interactions_seller"))) {
    await query(
      `ALTER TABLE interactions
       ADD INDEX idx_interactions_seller (seller_user_id)`,
    );
  }

  if (!(await constraintExists("interactions", "fk_interactions_seller"))) {
    await query(
      `ALTER TABLE interactions
       ADD CONSTRAINT fk_interactions_seller
       FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE SET NULL`,
    );
  }

  await query(
    `UPDATE interactions
     SET processing_status = CASE
       WHEN processing_status IS NOT NULL AND processing_status <> '' THEN processing_status
       WHEN analysis_status = 'analyzed' THEN 'analyzed'
       WHEN analysis_status = 'requires_review' THEN 'requires_review'
       WHEN analysis_status = 'resolved' THEN 'analyzed'
       ELSE 'pending'
     END`,
  );

  await query(
    `UPDATE interactions i
     LEFT JOIN opportunities o ON o.id = i.primary_opportunity_id
     SET i.seller_user_id = COALESCE(i.seller_user_id, o.seller_user_id)
     WHERE i.seller_user_id IS NULL
       AND i.primary_opportunity_id IS NOT NULL`,
  );

  await query(
    `UPDATE interactions
     SET analysis_status = CASE
       WHEN seller_user_id IS NOT NULL AND primary_opportunity_id IS NOT NULL THEN 'lead_qualified'
       WHEN seller_user_id IS NOT NULL AND account_id IS NOT NULL AND EXISTS (
         SELECT 1
         FROM interaction_contact_links icl
         WHERE icl.interaction_id = interactions.id
       ) THEN 'lead_assigned'
       WHEN account_id IS NOT NULL AND EXISTS (
         SELECT 1
         FROM interaction_contact_links icl
         WHERE icl.interaction_id = interactions.id
       ) THEN 'lead_unassigned'
       ELSE 'created'
     END
     WHERE analysis_status NOT IN ('created', 'lead_unassigned', 'lead_assigned', 'lead_qualified', 'lead_disqualified')`,
  );
}

const INTERACTION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS interactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    lead_source VARCHAR(64) NOT NULL DEFAULT 'otro',
    source_notes LONGTEXT NULL,
    summary LONGTEXT NULL,
    analysis_status VARCHAR(40) NOT NULL DEFAULT 'created',
    processing_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    warnings_json LONGTEXT NULL,
    topics_json LONGTEXT NULL,
    actions_taken_json LONGTEXT NULL,
    next_steps_json LONGTEXT NULL,
    suggested_account_json LONGTEXT NULL,
    suggested_contacts_json LONGTEXT NULL,
    suggested_opportunities_json LONGTEXT NULL,
    account_id BIGINT UNSIGNED NULL,
    primary_opportunity_id BIGINT UNSIGNED NULL,
    seller_user_id BIGINT UNSIGNED NULL,
    analyzed_at DATETIME(3) NULL,
    resolved_at DATETIME(3) NULL,
    disqualification_reason LONGTEXT NULL,
    lead_substatus_code VARCHAR(80) NULL,
    lead_reason_code VARCHAR(80) NULL,
    lead_required_action_code VARCHAR(80) NULL,
    lead_commercial_comment LONGTEXT NULL,
    lead_next_action_due_at DATETIME(3) NULL,
    lead_referred_contact_name VARCHAR(255) NULL,
    lead_referred_area_name VARCHAR(255) NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    updated_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_interactions_public_id UNIQUE (public_id),
    CONSTRAINT fk_interactions_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_interactions_primary_opportunity FOREIGN KEY (primary_opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_interactions_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_interactions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_interactions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
    INDEX idx_interactions_status_created (analysis_status, created_at),
    INDEX idx_interactions_processing_created (processing_status, created_at),
    INDEX idx_interactions_account_created (account_id, created_at),
    INDEX idx_interactions_primary_opportunity (primary_opportunity_id),
    INDEX idx_interactions_seller (seller_user_id)
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
      await ensureInteractionLeadColumns();
    })().catch((error) => {
      ensureInteractionSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureInteractionSchemaPromise;
}
