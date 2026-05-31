import { query } from "../db.js";

let ensureContactSchemaPromise;

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

async function hasConstraint(tableName, constraintName) {
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

const CONTACT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS contact_hierarchy_levels (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_contact_hierarchy_levels_code UNIQUE (code),
    CONSTRAINT uq_contact_hierarchy_levels_name UNIQUE (name)
  )`,
  `CREATE TABLE IF NOT EXISTS contact_influence_levels (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    updated_at DATETIME(3) NOT NULL DEFAULT NOW(3),
    CONSTRAINT uq_contact_influence_levels_code UNIQUE (code),
    CONSTRAINT uq_contact_influence_levels_name UNIQUE (name)
  )`,
  `INSERT INTO contact_purchase_participations (code, name, is_active)
   VALUES
     ('ninguno', 'Ninguno', 1),
     ('recomienda', 'Recomienda', 1),
     ('decide_parcialmente', 'Decide parcialmente', 1),
     ('decide_final', 'Decide final', 1),
     ('puede_vetar', 'Puede vetar', 1)
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     is_active = VALUES(is_active)`,
  `UPDATE contact_purchase_participations
   SET is_active = 0
   WHERE code IN ('decisor', 'evaluador', 'recomendador')`,
  `INSERT INTO contact_relationship_types (code, name, is_active)
   VALUES
     ('debil', 'Débil', 1),
     ('media', 'Media', 1),
     ('fuerte', 'Fuerte', 1)
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     is_active = VALUES(is_active)`,
  `UPDATE contact_relationship_types
   SET is_active = 0
   WHERE code IN ('amigo', 'enemigo', 'neutral', 'ninguno')`,
  `INSERT INTO contact_hierarchy_levels (code, name, is_active)
   VALUES
     ('director', 'Director', 1),
     ('gerente', 'Gerente', 1),
     ('lider', 'Líder', 1),
     ('especialista', 'Especialista', 1),
     ('usuario', 'Usuario', 1),
     ('otro', 'Otro', 1)
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     is_active = VALUES(is_active)`,
  `INSERT INTO contact_influence_levels (code, name, is_active)
   VALUES
     ('baja', 'Baja', 1),
     ('media', 'Media', 1),
     ('alta', 'Alta', 1)
   ON DUPLICATE KEY UPDATE
     name = VALUES(name),
     is_active = VALUES(is_active)`,
];

export async function ensureContactSchema() {
  if (!ensureContactSchemaPromise) {
    ensureContactSchemaPromise = (async () => {
      for (const statement of CONTACT_SCHEMA_STATEMENTS) {
        await query(statement);
      }

      if (!(await hasColumn("contacts", "hierarchy_level_id"))) {
        await query(
          `ALTER TABLE contacts
           ADD COLUMN hierarchy_level_id BIGINT UNSIGNED NULL
           AFTER purchase_participation_id`,
        );
      }

      if (!(await hasColumn("contacts", "influence_level_id"))) {
        await query(
          `ALTER TABLE contacts
           ADD COLUMN influence_level_id BIGINT UNSIGNED NULL
           AFTER relationship_type_id`,
        );
      }

      await query(
        `UPDATE contacts c
         INNER JOIN contact_purchase_participations cpp_default ON cpp_default.code = 'ninguno'
         SET c.purchase_participation_id = cpp_default.id`,
      );

      await query(
        `UPDATE contacts c
         INNER JOIN contact_relationship_types crt_default ON crt_default.code = 'media'
         SET c.relationship_type_id = crt_default.id`,
      );

      await query(
        `UPDATE contacts c
         INNER JOIN contact_hierarchy_levels chl_default ON chl_default.code = 'usuario'
         SET c.hierarchy_level_id = chl_default.id
         WHERE c.hierarchy_level_id IS NULL`,
      );

      await query(
        `UPDATE contacts c
         INNER JOIN contact_influence_levels cil_default ON cil_default.code = 'media'
         SET c.influence_level_id = cil_default.id
         WHERE c.influence_level_id IS NULL`,
      );

      if (!(await hasConstraint("contacts", "fk_contacts_hierarchy_level"))) {
        await query(
          `ALTER TABLE contacts
           ADD CONSTRAINT fk_contacts_hierarchy_level
           FOREIGN KEY (hierarchy_level_id) REFERENCES contact_hierarchy_levels(id)`,
        );
      }

      if (!(await hasConstraint("contacts", "fk_contacts_influence_level"))) {
        await query(
          `ALTER TABLE contacts
           ADD CONSTRAINT fk_contacts_influence_level
           FOREIGN KEY (influence_level_id) REFERENCES contact_influence_levels(id)`,
        );
      }
    })().catch((error) => {
      ensureContactSchemaPromise = undefined;
      throw error;
    });
  }

  await ensureContactSchemaPromise;
}
