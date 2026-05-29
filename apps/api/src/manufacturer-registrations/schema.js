import { query } from "../db.js";

let ensureManufacturerRegistrationsSchemaPromise;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS opportunity_manufacturer_registrations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id BIGINT UNSIGNED NOT NULL,
    provider_id BIGINT UNSIGNED NOT NULL,
    status_code VARCHAR(30) NOT NULL DEFAULT 'sin_aprobar',
    requested_at DATETIME(3) NOT NULL,
    approved_at DATETIME(3) NULL,
    expires_at DATETIME(3) NULL,
    registration_folio VARCHAR(120) NULL,
    renewal_count INT UNSIGNED NOT NULL DEFAULT 0,
    last_renewed_at DATETIME(3) NULL,
    rejected_at DATETIME(3) NULL,
    notes TEXT NULL,
    rejection_notes TEXT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_opportunity_manufacturer_registrations_opportunity_provider UNIQUE (opportunity_id, provider_id),
    CONSTRAINT uq_opportunity_manufacturer_registrations_provider_folio UNIQUE (provider_id, registration_folio),
    CONSTRAINT fk_opportunity_manufacturer_registrations_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_manufacturer_registrations_provider FOREIGN KEY (provider_id) REFERENCES providers(id),
    CONSTRAINT fk_opportunity_manufacturer_registrations_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_opportunity_manufacturer_registrations_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_opportunity_manufacturer_registrations_status (status_code, expires_at),
    INDEX idx_opportunity_manufacturer_registrations_opportunity (opportunity_id, updated_at),
    INDEX idx_opportunity_manufacturer_registrations_expires (expires_at)
  )`,
  `CREATE TABLE IF NOT EXISTS opportunity_manufacturer_registration_renewals (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id BIGINT UNSIGNED NOT NULL,
    previous_folio VARCHAR(120) NULL,
    new_folio VARCHAR(120) NULL,
    previous_expires_at DATETIME(3) NULL,
    new_expires_at DATETIME(3) NOT NULL,
    notes TEXT NULL,
    renewed_by_user_id BIGINT UNSIGNED NOT NULL,
    renewed_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT fk_opportunity_manufacturer_registration_renewals_registration FOREIGN KEY (registration_id) REFERENCES opportunity_manufacturer_registrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_opportunity_manufacturer_registration_renewals_user FOREIGN KEY (renewed_by_user_id) REFERENCES users(id),
    INDEX idx_opportunity_manufacturer_registration_renewals_registration (registration_id, renewed_at)
  )`,
];

async function ensureColumn(tableName, columnName, definition) {
  const safeTableName = String(tableName || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();
  const safeColumnName = String(columnName || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();
  if (!safeTableName || !safeColumnName) {
    throw new Error("Invalid table or column name for manufacturer schema");
  }
  const rows = await query(
    `SHOW COLUMNS FROM \`${safeTableName}\` LIKE '${safeColumnName}'`,
  );
  if (rows.length) {
    return;
  }

  await query(`ALTER TABLE \`${safeTableName}\` ADD COLUMN ${definition}`);
}

export async function ensureManufacturerRegistrationsSchema() {
  if (!ensureManufacturerRegistrationsSchemaPromise) {
    ensureManufacturerRegistrationsSchemaPromise = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await query(statement);
      }

      await ensureColumn(
        "opportunity_manufacturer_registrations",
        "rejection_notes",
        "rejection_notes TEXT NULL AFTER notes",
      );
      await ensureColumn(
        "opportunity_manufacturer_registrations",
        "renewal_count",
        "renewal_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER registration_folio",
      );
      await ensureColumn(
        "opportunity_manufacturer_registrations",
        "last_renewed_at",
        "last_renewed_at DATETIME(3) NULL AFTER renewal_count",
      );
      await ensureColumn(
        "opportunity_manufacturer_registrations",
        "rejected_at",
        "rejected_at DATETIME(3) NULL AFTER last_renewed_at",
      );
    })().catch((error) => {
      ensureManufacturerRegistrationsSchemaPromise = undefined;
      throw error;
    });
  }

  return ensureManufacturerRegistrationsSchemaPromise;
}
