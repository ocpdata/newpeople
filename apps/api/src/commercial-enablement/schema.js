import { query } from "../db.js";

let ensureCommercialEnablementSchemaPromise;

const COMMERCIAL_ENABLEMENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS commercial_enablement_resources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    kind VARCHAR(60) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    title VARCHAR(190) NOT NULL,
    summary TEXT NULL,
    body_markdown LONGTEXT NULL,
    solution_codes_json JSON NULL,
    industry_tags_json JSON NULL,
    stage_codes_json JSON NULL,
    theme_tags_json JSON NULL,
    competitor_tags_json JSON NULL,
    persona_tags_json JSON NULL,
    need_tags_json JSON NULL,
    recommended_role_tags_json JSON NULL,
    valid_until DATE NULL,
    owner_user_id BIGINT UNSIGNED NULL,
    usage_count INT UNSIGNED NOT NULL DEFAULT 0,
    helpful_count INT UNSIGNED NOT NULL DEFAULT 0,
    not_helpful_count INT UNSIGNED NOT NULL DEFAULT 0,
    metadata_json JSON NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_resources_public_id UNIQUE (public_id),
    CONSTRAINT fk_commercial_enablement_resources_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_enablement_resources_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_enablement_resources_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_resources_kind (kind, status),
    INDEX idx_commercial_enablement_resources_status (status, valid_until),
    INDEX idx_commercial_enablement_resources_owner (owner_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_assets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    resource_id BIGINT UNSIGNED NOT NULL,
    storage_provider VARCHAR(30) NOT NULL,
    storage_bucket VARCHAR(120) NULL,
    storage_key VARCHAR(500) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    stored_file_name VARCHAR(255) NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_extension VARCHAR(20) NULL,
    byte_size BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) NOT NULL,
    uploaded_by_user_id BIGINT UNSIGNED NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_assets_public_id UNIQUE (public_id),
    CONSTRAINT fk_commercial_enablement_assets_resource FOREIGN KEY (resource_id) REFERENCES commercial_enablement_resources(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_assets_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_assets_resource (resource_id, is_deleted)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_usage_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    resource_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(40) NOT NULL,
    context_type VARCHAR(40) NULL,
    context_entity_id BIGINT UNSIGNED NULL,
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_enablement_usage_resource FOREIGN KEY (resource_id) REFERENCES commercial_enablement_resources(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_usage_resource (resource_id, event_type, created_at),
    INDEX idx_commercial_enablement_usage_context (context_type, context_entity_id, created_at)
  )`,
];

export async function ensureCommercialEnablementSchema() {
  if (!ensureCommercialEnablementSchemaPromise) {
    ensureCommercialEnablementSchemaPromise = (async () => {
      for (const statement of COMMERCIAL_ENABLEMENT_SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ensureCommercialEnablementSchemaPromise = null;
      throw error;
    });
  }

  return ensureCommercialEnablementSchemaPromise;
}
