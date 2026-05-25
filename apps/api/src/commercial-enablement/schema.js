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
    INDEX idx_commercial_enablement_resources_status (status),
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
  `CREATE TABLE IF NOT EXISTS commercial_enablement_catalog_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    catalog_type VARCHAR(40) NOT NULL,
    code VARCHAR(100) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_catalog_public UNIQUE (public_id),
    CONSTRAINT uq_commercial_enablement_catalog_type_code UNIQUE (catalog_type, code),
    INDEX idx_commercial_enablement_catalog_type (catalog_type, sort_order, is_active)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_catalog_seed_tombstones (
    catalog_type VARCHAR(40) NOT NULL,
    code VARCHAR(100) NOT NULL,
    deleted_by_user_id BIGINT UNSIGNED NULL,
    deleted_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (catalog_type, code),
    CONSTRAINT fk_commercial_enablement_catalog_seed_tombstones_user FOREIGN KEY (deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_catalog_seed_tombstones_deleted_at (deleted_at)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    title VARCHAR(190) NOT NULL,
    summary TEXT NULL,
    internal_description LONGTEXT NULL,
    asset_type_code VARCHAR(80) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    source_type VARCHAR(20) NOT NULL DEFAULT 'mixed',
    visibility_level VARCHAR(40) NOT NULL DEFAULT 'internal_sales',
    audience_code VARCHAR(40) NOT NULL DEFAULT 'seller',
    language_code VARCHAR(20) NOT NULL DEFAULT 'es',
    owner_user_id BIGINT UNSIGNED NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    is_internal TINYINT(1) NOT NULL DEFAULT 0,
    is_downloadable TINYINT(1) NOT NULL DEFAULT 1,
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    search_text LONGTEXT NULL,
    source_legacy_resource_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_items_public UNIQUE (public_id),
    CONSTRAINT uq_commercial_enablement_items_legacy UNIQUE (source_legacy_resource_id),
    CONSTRAINT fk_commercial_enablement_items_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_enablement_items_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_commercial_enablement_items_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_items_status (status, visibility_level),
    INDEX idx_commercial_enablement_items_deleted (is_deleted, updated_at),
    INDEX idx_commercial_enablement_items_owner (owner_user_id),
    INDEX idx_commercial_enablement_items_type (asset_type_code, audience_code)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_item_catalog_links (
    item_id BIGINT UNSIGNED NOT NULL,
    catalog_entry_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (item_id, catalog_entry_id),
    CONSTRAINT fk_commercial_enablement_item_catalog_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_item_catalog_entry FOREIGN KEY (catalog_entry_id) REFERENCES commercial_enablement_catalog_entries(id) ON DELETE CASCADE,
    INDEX idx_commercial_enablement_item_catalog_entry (catalog_entry_id, item_id)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_item_tags (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id BIGINT UNSIGNED NOT NULL,
    tag_group VARCHAR(40) NOT NULL,
    value_code VARCHAR(100) NOT NULL,
    value_label VARCHAR(160) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_enablement_item_tags_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT uq_commercial_enablement_item_tag UNIQUE (item_id, tag_group, value_code),
    INDEX idx_commercial_enablement_item_tags_group (tag_group, value_code)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_item_files (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
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
    source_legacy_asset_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_item_files_public UNIQUE (public_id),
    CONSTRAINT uq_commercial_enablement_item_files_legacy UNIQUE (source_legacy_asset_id),
    CONSTRAINT fk_commercial_enablement_item_files_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_item_files_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_item_files_item (item_id, is_deleted)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_item_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    url VARCHAR(1000) NOT NULL,
    link_type VARCHAR(40) NOT NULL DEFAULT 'external',
    label VARCHAR(190) NOT NULL,
    description TEXT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    created_by_user_id BIGINT UNSIGNED NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_item_links_public UNIQUE (public_id),
    CONSTRAINT fk_commercial_enablement_item_links_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_item_links_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_item_links_item (item_id, is_deleted, is_primary)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_item_relations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id BIGINT UNSIGNED NOT NULL,
    related_item_id BIGINT UNSIGNED NOT NULL,
    relation_type VARCHAR(60) NOT NULL,
    created_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_enablement_item_relations_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_item_relations_related FOREIGN KEY (related_item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_item_relations_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_item_relations_item (item_id, relation_type)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_usage_events_v2 (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    event_type VARCHAR(40) NOT NULL,
    context_type VARCHAR(40) NULL,
    context_entity_id BIGINT UNSIGNED NULL,
    metadata_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_enablement_usage_v2_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_usage_v2_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_usage_v2_item (item_id, event_type, created_at),
    INDEX idx_commercial_enablement_usage_v2_context (context_type, context_entity_id, created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_favorites (
    user_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (user_id, item_id),
    CONSTRAINT fk_commercial_enablement_favorites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_favorites_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_collections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(190) NOT NULL,
    description TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_collections_public UNIQUE (public_id),
    CONSTRAINT fk_commercial_enablement_collections_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_commercial_enablement_collections_user (user_id, updated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_collection_items (
    collection_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    sort_order INT NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    PRIMARY KEY (collection_id, item_id),
    CONSTRAINT fk_commercial_enablement_collection_items_collection FOREIGN KEY (collection_id) REFERENCES commercial_enablement_collections(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_collection_items_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    INDEX idx_commercial_enablement_collection_items_sort (collection_id, sort_order)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_intake_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'uploaded',
    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
    source_file_name VARCHAR(255) NOT NULL,
    source_mime_type VARCHAR(120) NOT NULL,
    source_size_bytes BIGINT UNSIGNED NOT NULL,
    source_checksum CHAR(64) NOT NULL,
    storage_provider VARCHAR(30) NOT NULL,
    storage_bucket VARCHAR(120) NULL,
    storage_key VARCHAR(500) NOT NULL,
    extraction_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    extraction_error_code VARCHAR(80) NULL,
    extraction_error_message TEXT NULL,
    analysis_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    analysis_model VARCHAR(80) NULL,
    analysis_error_code VARCHAR(80) NULL,
    analysis_error_message TEXT NULL,
    source_hint TEXT NULL,
    source_summary TEXT NULL,
    language_detected VARCHAR(20) NULL,
    page_count INT NULL,
    extraction_preview LONGTEXT NULL,
    draft_payload_json JSON NULL,
    accepted_payload_json JSON NULL,
    accepted_field_decisions_json JSON NULL,
    warnings_json JSON NULL,
    review_confirmed TINYINT(1) NOT NULL DEFAULT 0,
    review_started_at DATETIME(3) NULL,
    completed_asset_id BIGINT UNSIGNED NULL,
    expires_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_commercial_enablement_intake_sessions_public UNIQUE (public_id),
    CONSTRAINT fk_commercial_enablement_intake_sessions_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_intake_sessions_asset FOREIGN KEY (completed_asset_id) REFERENCES commercial_enablement_items(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_intake_sessions_status (status, updated_at),
    INDEX idx_commercial_enablement_intake_sessions_user (uploaded_by_user_id, updated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_intake_extracted_content (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    intake_session_id BIGINT UNSIGNED NOT NULL,
    content_kind VARCHAR(40) NOT NULL,
    page_number INT NULL,
    text_content LONGTEXT NULL,
    char_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_enablement_intake_extracted_content_session FOREIGN KEY (intake_session_id) REFERENCES commercial_enablement_intake_sessions(id) ON DELETE CASCADE,
    INDEX idx_commercial_enablement_intake_extracted_content_session (intake_session_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_enablement_item_source_contents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_id BIGINT UNSIGNED NOT NULL,
    intake_session_id BIGINT UNSIGNED NULL,
    source_file_name VARCHAR(255) NOT NULL,
    source_mime_type VARCHAR(120) NOT NULL,
    source_checksum CHAR(64) NOT NULL,
    extracted_text LONGTEXT NULL,
    extracted_text_summary TEXT NULL,
    accepted_suggestions_json JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_commercial_enablement_item_source_contents_item FOREIGN KEY (item_id) REFERENCES commercial_enablement_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_commercial_enablement_item_source_contents_session FOREIGN KEY (intake_session_id) REFERENCES commercial_enablement_intake_sessions(id) ON DELETE SET NULL,
    INDEX idx_commercial_enablement_item_source_contents_item (item_id, created_at)
  )`,
];

async function ensureCommercialEnablementItemsColumn(columnName, definition) {
  const rows = await query(
    `SHOW COLUMNS FROM commercial_enablement_items LIKE ?`,
    [columnName],
  );
  if (rows.length) {
    return;
  }

  await query(
    `ALTER TABLE commercial_enablement_items ADD COLUMN ${definition}`,
  );
}

async function dropTableColumnIfExists(tableName, columnName) {
  const rows = await query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [
    columnName,
  ]);
  if (rows.length) {
    await query(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  }
}

async function replaceTableIndex(tableName, indexName, definition) {
  const rows = await query(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [
    indexName,
  ]);
  if (rows.length) {
    await query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  }
  await query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} ${definition}`);
}

export async function ensureCommercialEnablementSchema() {
  if (!ensureCommercialEnablementSchemaPromise) {
    ensureCommercialEnablementSchemaPromise = (async () => {
      for (const statement of COMMERCIAL_ENABLEMENT_SCHEMA_STATEMENTS) {
        await query(statement);
      }
      await dropTableColumnIfExists(
        "commercial_enablement_resources",
        "valid_until",
      );
      await dropTableColumnIfExists(
        "commercial_enablement_items",
        "valid_from",
      );
      await dropTableColumnIfExists(
        "commercial_enablement_items",
        "valid_until",
      );
      await replaceTableIndex(
        "commercial_enablement_resources",
        "idx_commercial_enablement_resources_status",
        "(status)",
      );
      await replaceTableIndex(
        "commercial_enablement_items",
        "idx_commercial_enablement_items_status",
        "(status, visibility_level)",
      );
      await ensureCommercialEnablementItemsColumn(
        "is_deleted",
        "is_deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_featured",
      );
    })().catch((error) => {
      ensureCommercialEnablementSchemaPromise = null;
      throw error;
    });
  }

  return ensureCommercialEnablementSchemaPromise;
}
