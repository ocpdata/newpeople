import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.test") });

const dbName = process.env.DB_NAME || "newpeople_crm_test";

if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  throw new Error(`Nombre de base invalido para pruebas: ${dbName}`);
}

if (dbName === "newpeople_crm") {
  throw new Error(
    "La base de pruebas no puede apuntar a newpeople_crm. Usa otra DB_NAME en .env.test.",
  );
}

async function main() {
  const schemaPath = resolve(__dirname, "../sql/schema.sql");
  const rawSchema = await fs.readFile(schemaPath, "utf8");
  const testSchema = rawSchema.replace(/newpeople_crm/g, dbName);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    multipleStatements: true,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await connection.query(testSchema);
    const now = new Date();
    await connection.query(
      `INSERT INTO countries (iso2, iso3, name, is_active, created_at, updated_at)
       VALUES ('MX', 'MEX', 'Mexico', 1, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [now, now],
    );
    await connection.query(
      `INSERT INTO currencies (code, name, symbol, decimals, is_active, created_at, updated_at)
       VALUES ('USD', 'Dolar estadounidense', '$', 2, 1, ?, ?),
              ('MXN', 'Peso mexicano', '$', 2, 1, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [now, now, now, now],
    );
    const seedCodeNames = async (table, values) => {
      for (const [code, name] of values) {
        await connection.query(
          `INSERT INTO ${table} (code, name, is_active) VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
          [code, name],
        );
      }
    };
    await seedCodeNames("account_types", [["empresa", "Empresa"]]);
    await seedCodeNames("economic_sectors", [["tecnologia", "Tecnologia"]]);
    await seedCodeNames("account_activation_statuses", [["activada", "Activada"], ["desactivada", "Desactivada"], ["pendiente_activacion", "Pendiente de activacion"]]);
    await seedCodeNames("contact_purchase_participations", [["ninguno", "Ninguno"]]);
    await seedCodeNames("contact_relationship_types", [["ninguno", "Ninguno"]]);
    await seedCodeNames("contact_hierarchy_levels", [["usuario", "Usuario"], ["directivo", "Directivo"]]);
    await seedCodeNames("contact_influence_levels", [["baja", "Baja"], ["media", "Media"], ["alta", "Alta"]]);
    await seedCodeNames("contact_employment_statuses", [["activo", "Activo"]]);
    await seedCodeNames("contact_activation_statuses", [["activado", "Activado"], ["desactivado", "Desactivado"], ["pendiente_activacion", "Pendiente de activacion"]]);
    await seedCodeNames("provider_activation_statuses", [["activado", "Activado"], ["desactivado", "Desactivado"]]);
    await seedCodeNames("provider_price_list_item_statuses", [["activo", "Activo"], ["inactivo", "Inactivo"]]);
    await seedCodeNames("opportunity_business_lines", [["general", "General"]]);
    for (const [code, name, stageOrder] of [["contacto_inicial", "Contacto inicial", 1], ["identificacion_oportunidad", "Identificacion de oportunidad", 2], ["waiting", "Waiting", 3], ["demostracion", "Demostracion", 4]]) {
      await connection.query(
        `INSERT INTO opportunity_sales_stages (code, name, stage_order, is_active)
         VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
        [code, name, stageOrder],
      );
    }
    await seedCodeNames("opportunity_activation_statuses", [["activada", "Activada"], ["desactivada", "Desactivada"], ["pendiente_activacion", "Pendiente de activacion"]]);
    await seedCodeNames("opportunity_commercial_statuses", [["en_proceso", "En proceso"], ["ganada", "Ganada"], ["perdida", "Perdida"], ["anulada", "Anulada"]]);
    await seedCodeNames("quotation_statuses", [["borrador", "Borrador"], ["aprobada", "Aprobada"]]);
    await seedCodeNames("quotation_activation_statuses", [["activada", "Activada"]]);
    await seedCodeNames("quotation_section_inclusion_types", [["incluida", "Incluida"]]);
    console.log(`Test DB ready: ${dbName}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});