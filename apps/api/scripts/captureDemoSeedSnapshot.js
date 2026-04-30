import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pool, query } from "../src/db.js";
import { config } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(__dirname, "demoSeedSnapshot.sql");
const MUTABLE_DEMO_TABLES = [
  "users",
  "user_roles",
  "accounts",
  "account_owners",
  "contacts",
  "opportunities",
  "opportunity_stage_question_answers",
  "providers",
  "provider_price_lists",
  "provider_price_list_items",
  "provider_price_list_item_components",
  "quotations",
  "quotation_versions",
  "quotation_sections",
  "quotation_section_items",
  "company_profile",
  "audit_log",
  "user_audit_log",
];

function buildMysqlDumpArgs() {
  const args = [
    "-h",
    config.db.host,
    "-P",
    String(config.db.port),
    "-u",
    config.db.user,
  ];

  if (config.db.password) {
    args.push(`-p${config.db.password}`);
  }

  return [
    ...args,
    "--single-transaction",
    "--no-create-info",
    "--skip-triggers",
    "--complete-insert",
    "--skip-comments",
    "--skip-dump-date",
    "--set-gtid-purged=OFF",
    config.db.database,
    ...MUTABLE_DEMO_TABLES,
  ];
}

function runDumpOrThrow() {
  const result = spawnSync("mysqldump", buildMysqlDumpArgs(), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 200,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

async function collectSnapshotSourceState() {
  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users_count,
       (SELECT COUNT(*) FROM accounts) AS accounts_count,
       (SELECT COUNT(*) FROM providers) AS providers_count,
       (SELECT COUNT(*) FROM quotations) AS quotations_count,
       (SELECT COUNT(*) FROM provider_price_list_items) AS provider_price_items_count`,
  );

  return (
    rows[0] || {
      users_count: 0,
      accounts_count: 0,
      providers_count: 0,
      quotations_count: 0,
      provider_price_list_items_count: 0,
    }
  );
}

function validateSnapshotSourceState(state) {
  const currentBusinessRows = [
    Number(state.users_count || 0),
    Number(state.accounts_count || 0),
    Number(state.providers_count || 0),
    Number(state.quotations_count || 0),
    Number(state.provider_price_list_items_count || 0),
  ].reduce((sum, count) => sum + count, 0);

  if (currentBusinessRows <= 0 || Number(state.users_count || 0) <= 0) {
    throw new Error(
      "La base actual no contiene datos demo utilizables. Aborta la captura para no sobrescribir demoSeedSnapshot.sql con un snapshot vacio.",
    );
  }
}

async function main() {
  const sourceState = await collectSnapshotSourceState();
  validateSnapshotSourceState(sourceState);

  const dumpSql = runDumpOrThrow();
  const snapshotSql = [
    "SET FOREIGN_KEY_CHECKS = 0;",
    `USE \`${config.db.database}\`;`,
    dumpSql.trim(),
    "SET FOREIGN_KEY_CHECKS = 1;",
    "",
  ].join("\n\n");

  writeFileSync(snapshotPath, snapshotSql, "utf8");

  console.log(`Snapshot demo generado en: ${snapshotPath}`);
  console.log(`Base capturada: ${config.db.database}`);
  console.log(`Tablas exportadas: ${MUTABLE_DEMO_TABLES.length}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
