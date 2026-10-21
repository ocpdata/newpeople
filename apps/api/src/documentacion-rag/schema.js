import { randomUUID } from "node:crypto";
import { query } from "../db.js";

let schemaPromise;

const RAG_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS documentacion_rag_topics (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_user_id BIGINT UNSIGNED NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_documentacion_rag_topics_public UNIQUE (public_id),
    CONSTRAINT uq_documentacion_rag_topics_name UNIQUE (name),
    CONSTRAINT fk_documentacion_rag_topics_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_documentacion_rag_topics_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_documentacion_rag_topics_active (is_active, sort_order)
  )`,
  `CREATE TABLE IF NOT EXISTS documentacion_rag_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id VARCHAR(64) NOT NULL,
    topic_id BIGINT UNSIGNED NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    byte_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
    source_type VARCHAR(30) NOT NULL DEFAULT 'upload',
    source_url TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'processing',
    active_file_id VARCHAR(128) NULL,
    active_version_id VARCHAR(64) NULL,
    pending_file_id VARCHAR(128) NULL,
    pending_version_id VARCHAR(64) NULL,
    pending_file_name VARCHAR(255) NULL,
    pending_mime_type VARCHAR(120) NULL,
    pending_byte_size BIGINT UNSIGNED NULL,
    pending_source_type VARCHAR(30) NULL,
    pending_source_url TEXT NULL,
    upload_operation_id VARCHAR(128) NULL,
    retired_file_id VARCHAR(128) NULL,
    delete_operation_id VARCHAR(128) NULL,
    delete_file_ids_json MEDIUMTEXT NULL,
    summary TEXT NULL,
    summary_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    summary_error TEXT NULL,
    error_message TEXT NULL,
    uploaded_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_documentacion_rag_documents_public UNIQUE (public_id),
    CONSTRAINT fk_documentacion_rag_documents_topic FOREIGN KEY (topic_id) REFERENCES documentacion_rag_topics(id) ON DELETE RESTRICT,
    CONSTRAINT fk_documentacion_rag_documents_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_documentacion_rag_documents_topic (topic_id, status, updated_at),
    INDEX idx_documentacion_rag_documents_status (status, updated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS documentacion_rag_meta (
    meta_key VARCHAR(80) PRIMARY KEY,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3)
  )`,
];

async function ensureSchema() {
  for (const statement of RAG_SCHEMA_STATEMENTS) {
    await query(statement);
  }

  const columns = [
    ["source_type", "VARCHAR(30) NOT NULL DEFAULT 'upload'"],
    ["source_url", "TEXT NULL"],
    ["pending_source_type", "VARCHAR(30) NULL"],
    ["pending_source_url", "TEXT NULL"],
  ];
  for (const [columnName, definition] of columns) {
    const existing = await query(
      `SELECT COUNT(*) AS column_count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'documentacion_rag_documents'
         AND COLUMN_NAME = ?`,
      [columnName],
    );
    if (!Number(existing[0]?.column_count || 0)) {
      await query(
        `ALTER TABLE documentacion_rag_documents ADD COLUMN ${columnName} ${definition}`,
      );
    }
  }

  const seedMarker = await query(
    `INSERT IGNORE INTO documentacion_rag_meta (meta_key, created_at)
     VALUES ('starter_topics_seeded', NOW(3))`,
  );
  if (!seedMarker?.affectedRows) return;

  const seedTopics = [
    ["proceso-comercial", "Proceso comercial", "Etapas y prácticas del proceso de ventas."],
    ["f5", "F5", "Documentación de soluciones y productos F5."],
    ["bluecat", "BlueCat", "Documentación de soluciones y productos BlueCat."],
  ];

  for (const [index, [code, name, description]] of seedTopics.entries()) {
    await query(
      `INSERT INTO documentacion_rag_topics
         (public_id, name, description, sort_order, created_at, updated_at)
       SELECT ?, ?, ?, ?, NOW(3), NOW(3)
       WHERE NOT EXISTS (
         SELECT 1 FROM documentacion_rag_topics WHERE public_id = ?
       )`,
      [`rag-topic-${code}`, name, description, index * 10, `rag-topic-${code}`],
    );
  }
}

export async function ensureDocumentacionRagSchema() {
  if (!schemaPromise) {
    schemaPromise = ensureSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export function buildRagPublicId() {
  return `rag-${randomUUID().replace(/-/g, "")}`;
}
