import { query } from "../db.js";

let ensureProposalDocumentSchemaPromise;

const PROPOSAL_DOCUMENT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS proposal_documents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(190) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    account_id BIGINT UNSIGNED NULL,
    contact_id BIGINT UNSIGNED NULL,
    opportunity_id BIGINT UNSIGNED NULL,
    quotation_id BIGINT UNSIGNED NULL,
    current_version_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_by BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    INDEX idx_proposal_documents_status (status, updated_at),
    INDEX idx_proposal_documents_opportunity (opportunity_id),
    CONSTRAINT fk_proposal_documents_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    CONSTRAINT fk_proposal_documents_contact FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
    CONSTRAINT fk_proposal_documents_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
    CONSTRAINT fk_proposal_documents_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_proposal_documents_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS proposal_document_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    proposal_document_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    content_json JSON NOT NULL,
    publish_notes VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    published_by BIGINT UNSIGNED NULL,
    published_at DATETIME(3) NULL,
    CONSTRAINT uq_proposal_document_versions_version UNIQUE (proposal_document_id, version_number),
    INDEX idx_proposal_document_versions_active (proposal_document_id, is_active),
    CONSTRAINT fk_proposal_document_versions_document FOREIGN KEY (proposal_document_id) REFERENCES proposal_documents(id) ON DELETE CASCADE,
    CONSTRAINT fk_proposal_document_versions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_proposal_document_versions_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS proposal_document_section_catalog (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    title VARCHAR(190) NOT NULL,
    display_order INT UNSIGNED NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_proposal_document_section_catalog_code UNIQUE (code),
    INDEX idx_proposal_document_section_catalog_order (is_active, display_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS proposal_document_imports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    proposal_document_id BIGINT UNSIGNED NULL,
    source_file_name VARCHAR(255) NOT NULL,
    source_kind VARCHAR(20) NOT NULL,
    extracted_chars INT UNSIGNED NOT NULL DEFAULT 0,
    section_count INT UNSIGNED NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'previewed',
    diagnostics_json JSON NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_proposal_document_imports_document FOREIGN KEY (proposal_document_id) REFERENCES proposal_documents(id) ON DELETE SET NULL,
    INDEX idx_proposal_document_imports_document (proposal_document_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const DEFAULT_PROPOSAL_DOCUMENT_SECTION_CATALOG = [
  { code: "document_rights", title: "Derechos del documento", order: 10 },
  { code: "certifications", title: "Certificaciones", order: 20 },
  { code: "presentation", title: "Presentación", order: 30 },
  { code: "mission", title: "Misión", order: 40 },
  { code: "vision", title: "Visión", order: 50 },
  { code: "key_partners", title: "Socios principales", order: 60 },
  { code: "key_clients", title: "Principales clientes", order: 70 },
  { code: "executive_summary", title: "Resumen ejecutivo", order: 80 },
  { code: "background", title: "Antecedentes", order: 90 },
  { code: "solution_description", title: "Descripción de la solución", order: 100 },
  { code: "services", title: "Servicios", order: 110 },
  { code: "product_brochures", title: "Folletos de los productos", order: 120 },
  { code: "next_steps", title: "Siguientes pasos", order: 130 },
];

export async function ensureProposalDocumentSchema() {
  if (!ensureProposalDocumentSchemaPromise) {
    ensureProposalDocumentSchemaPromise = (async () => {
      for (const statement of PROPOSAL_DOCUMENT_SCHEMA_STATEMENTS) {
        await query(statement);
      }

      await query(
        `ALTER TABLE proposal_documents
         ADD CONSTRAINT fk_proposal_documents_current_version
         FOREIGN KEY (current_version_id) REFERENCES proposal_document_versions(id)
         ON DELETE SET NULL`,
      ).catch(() => {});

      for (const section of DEFAULT_PROPOSAL_DOCUMENT_SECTION_CATALOG) {
        await query(
          `INSERT IGNORE INTO proposal_document_section_catalog
             (code, title, display_order, is_active)
           VALUES (?, ?, ?, 1)`,
          [section.code, section.title, section.order],
        );
      }
    })().catch((error) => {
      ensureProposalDocumentSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureProposalDocumentSchemaPromise;
}
