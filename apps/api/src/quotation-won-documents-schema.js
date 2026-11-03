import { query } from "./db.js";

let schemaPromise;

export async function ensureQuotationWonDocumentsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS quotation_won_documents (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          quotation_id BIGINT UNSIGNED NOT NULL,
          quotation_version_id BIGINT UNSIGNED NOT NULL,
          opportunity_id BIGINT UNSIGNED NOT NULL,
          document_id BIGINT UNSIGNED NOT NULL,
          document_source VARCHAR(40) NOT NULL,
          document_role VARCHAR(40) NOT NULL,
          purchase_order_amount DECIMAL(15, 2) NULL,
          purchase_order_currency CHAR(3) NULL,
          created_by_user_id BIGINT UNSIGNED NOT NULL,
          created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
          accepted_at DATETIME(3) NULL,
          accepted_by_user_id BIGINT UNSIGNED NULL,
          CONSTRAINT fk_qwd_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
          CONSTRAINT fk_qwd_version FOREIGN KEY (quotation_version_id) REFERENCES quotation_versions(id) ON DELETE CASCADE,
          CONSTRAINT fk_qwd_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
          CONSTRAINT fk_qwd_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          CONSTRAINT fk_qwd_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
          CONSTRAINT fk_qwd_accepted_by FOREIGN KEY (accepted_by_user_id) REFERENCES users(id),
          CONSTRAINT uq_qwd_version_role_document UNIQUE (quotation_version_id, document_role, document_id),
          INDEX idx_qwd_version_role (quotation_version_id, document_role, created_at),
          INDEX idx_qwd_version_source (quotation_version_id, document_source)
        )`,
      );
      for (const [column, definition] of [
        ["purchase_order_amount", "DECIMAL(15, 2) NULL"],
        ["purchase_order_currency", "CHAR(3) NULL"],
      ]) {
        let rows;
        try {
          rows = await query(
            `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'quotation_won_documents' AND COLUMN_NAME = '${column}' LIMIT 1`,
          );
        } catch (_error) {
          rows = await query(`SHOW COLUMNS FROM quotation_won_documents LIKE '${column}'`);
        }
        if (!rows.length) {
          await query(`ALTER TABLE quotation_won_documents ADD COLUMN ${column} ${definition}`);
        }
      }
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
}
