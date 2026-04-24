import { query } from "./db.js";

const PRODUCT_TYPE_SEED = [
  {
    code: "producto",
    name: "Productos",
    description: "Producto de proveedor con precio directo.",
    sortOrder: 1,
  },
  {
    code: "servicio_propio",
    name: "Servicios Propios",
    description: "Servicio propio con precio directo.",
    sortOrder: 2,
  },
  {
    code: "grupo_productos",
    name: "Bundle",
    description: "Item compuesto por otros productos o servicios activos.",
    sortOrder: 3,
  },
];

let ensureProductTypesPromise;
let productTypesCache = [];

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

async function ensureProductTypeReference({
  tableName,
  legacyCodeColumn,
  referenceColumn,
  constraintName,
  addColumnAfter,
}) {
  if (!(await columnExists(tableName, referenceColumn))) {
    await query(
      `ALTER TABLE ${tableName}
       ADD COLUMN ${referenceColumn} BIGINT UNSIGNED NULL AFTER ${addColumnAfter}`,
    );
  }

  await query(
    `UPDATE ${tableName} target
     INNER JOIN product_types pt ON pt.code = target.${legacyCodeColumn}
     SET target.${referenceColumn} = pt.id
     WHERE target.${referenceColumn} IS NULL`,
  );

  await query(
    `UPDATE ${tableName} target
     INNER JOIN product_types pt ON pt.id = target.${referenceColumn}
     SET target.${legacyCodeColumn} = pt.code
     WHERE target.${legacyCodeColumn} IS NULL
        OR target.${legacyCodeColumn} <> pt.code`,
  );

  await query(
    `ALTER TABLE ${tableName}
     MODIFY COLUMN ${referenceColumn} BIGINT UNSIGNED NOT NULL`,
  );

  if (!(await constraintExists(tableName, constraintName))) {
    await query(
      `ALTER TABLE ${tableName}
       ADD CONSTRAINT ${constraintName}
       FOREIGN KEY (${referenceColumn}) REFERENCES product_types(id)`,
    );
  }
}

export async function ensureProductTypesCatalog() {
  if (!ensureProductTypesPromise) {
    ensureProductTypesPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS product_types (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(60) NOT NULL,
          name VARCHAR(120) NOT NULL,
          description VARCHAR(255) NULL,
          sort_order INT UNSIGNED NOT NULL DEFAULT 0,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          CONSTRAINT uq_product_types_code UNIQUE (code),
          CONSTRAINT uq_product_types_name UNIQUE (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
      `);

      for (const productType of PRODUCT_TYPE_SEED) {
        await query(
          `INSERT INTO product_types
            (code, name, description, sort_order, is_active)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             description = VALUES(description),
             sort_order = VALUES(sort_order),
             is_active = VALUES(is_active)`,
          [
            productType.code,
            productType.name,
            productType.description,
            productType.sortOrder,
          ],
        );
      }

      await ensureProductTypeReference({
        tableName: "provider_price_lists",
        legacyCodeColumn: "item_type",
        referenceColumn: "product_type_id",
        constraintName: "fk_provider_price_lists_product_type",
        addColumnAfter: "currency_id",
      });

      await ensureProductTypeReference({
        tableName: "provider_price_list_items",
        legacyCodeColumn: "item_type",
        referenceColumn: "product_type_id",
        constraintName: "fk_provider_price_list_items_product_type",
        addColumnAfter: "description",
      });

      productTypesCache = await query(
        `SELECT id, code, name, description, sort_order, is_active
         FROM product_types
         ORDER BY sort_order ASC, id ASC`,
      );
    })().catch((error) => {
      ensureProductTypesPromise = undefined;
      throw error;
    });
  }

  await ensureProductTypesPromise;
}

export async function listProductTypes({ includeInactive = false } = {}) {
  await ensureProductTypesCatalog();
  return productTypesCache.filter(
    (productType) => includeInactive || Number(productType.is_active) === 1,
  );
}

export async function getProductTypeByCode(code) {
  const productTypes = await listProductTypes({ includeInactive: true });
  return (
    productTypes.find(
      (productType) => String(productType.code) === String(code),
    ) || null
  );
}

export async function getProductTypeIdByCode(code) {
  const productType = await getProductTypeByCode(code);
  return productType ? Number(productType.id) : null;
}

export function getProductTypeLabel(code) {
  const productType = productTypesCache.find(
    (entry) => String(entry.code) === String(code),
  );

  if (productType?.name) {
    return String(productType.name);
  }

  if (String(code) === "servicio_propio") {
    return "Servicios Propios";
  }

  if (String(code) === "grupo_productos") {
    return "Bundle";
  }

  return "Productos";
}
