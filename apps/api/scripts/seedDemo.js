import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pool, query } from "../src/db.js";
import { config } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_SNAPSHOT_PATH = resolve(__dirname, "demoSeedSnapshot.sql");

function printHelp() {
  console.log(`
Uso:
  npm run seed:demo --prefix apps/api
  npm run seed:demo --prefix apps/api -- --dry-run

Opciones:
  --dry-run    Valida precondiciones y muestra el snapshot objetivo sin importarlo.
  --help       Muestra esta ayuda.

Notas:
  - seed:demo restaura exclusivamente el snapshot en scripts/demoSeedSnapshot.sql.
  - Si el snapshot no existe, primero genera uno con npm run seed:demo:capture.
  - La importacion requiere una base vacia. Para recrearla desde cero usa npm run seed:demo:reset-db.
`);
}

function parseArgs(argv) {
  return argv.reduce(
    (options, arg) => {
      if (arg === "--help") {
        options.help = true;
      } else if (arg === "--dry-run") {
        options.dryRun = true;
      }

      return options;
    },
    {
      help: false,
      dryRun: false,
    },
  );
}

function buildMysqlArgs(extraArgs = []) {
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

  return [...args, ...extraArgs];
}

function runMysqlOrThrow(args, options = {}) {
  const result = spawnSync("mysql", args, {
    stdio: ["pipe", "inherit", "inherit"],
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function validateSnapshotSql(snapshotSql) {
  const hasUsersInsert = /INSERT INTO `users`/i.test(snapshotSql);
  const hasBusinessInsert =
    /INSERT INTO `(users|accounts|providers|quotations|provider_price_list_items)`/i.test(
      snapshotSql,
    );

  if (!hasUsersInsert || !hasBusinessInsert) {
    throw new Error(
      "El snapshot demo actual no contiene datos restaurables. Regenera scripts/demoSeedSnapshot.sql desde una base con datos antes de ejecutar seed:demo.",
    );
  }
}

async function collectSnapshotRestoreState() {
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
      provider_price_items_count: 0,
    }
  );
}

async function restoreDemoSnapshot({ dryRun }) {
  if (!existsSync(DEMO_SNAPSHOT_PATH)) {
    throw new Error(
      "No existe scripts/demoSeedSnapshot.sql. Genera el snapshot con npm run seed:demo:capture antes de restaurar la demo.",
    );
  }

  const restoreState = await collectSnapshotRestoreState();
  const currentBusinessRows = [
    Number(restoreState.users_count || 0),
    Number(restoreState.accounts_count || 0),
    Number(restoreState.providers_count || 0),
    Number(restoreState.quotations_count || 0),
    Number(restoreState.provider_price_items_count || 0),
  ].reduce((sum, count) => sum + count, 0);

  console.log(`Base objetivo: ${config.db.database}`);
  console.log(`Host DB: ${config.db.host}:${config.db.port}`);
  console.log("Modo: snapshot demo");
  console.log(`Archivo snapshot: ${DEMO_SNAPSHOT_PATH}`);

  if (dryRun) {
    console.log("Dry-run finalizado. No se importo el snapshot demo.");
    return;
  }

  if (currentBusinessRows > 0) {
    throw new Error(
      "La restauracion del snapshot demo requiere una base vacia. Usa npm run seed:demo:reset-db para recrearla antes de importar.",
    );
  }

  const snapshotSql = readFileSync(DEMO_SNAPSHOT_PATH, "utf8");
  validateSnapshotSql(snapshotSql);

  runMysqlOrThrow(buildMysqlArgs([config.db.database]), {
    input: snapshotSql,
  });

  console.log("Snapshot demo restaurado correctamente.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  await restoreDemoSnapshot({ dryRun: options.dryRun });
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
